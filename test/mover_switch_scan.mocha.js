/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Regression tests for the Mover handoff the switch-scan
 * "move-candidates" sub-scan relies on. Exercises the three transition
 * points patched into the production code:
 *
 *   1. `Mover.startMove(..., switchScanMode=true)` — the drag strategy
 *      enumerates connections but suppresses the keyboard-mode preview
 *      (`connectionCandidate` stays `null`, no initial preview jump).
 *   2. Commit path — the switch-scan controller seeds the chosen
 *      `(local, target)` pair as the strategy's `connectionCandidate`,
 *      then `finishMove` reads it and attaches the block to the target.
 *   3. Abort path — the switch-scan controller's `teardownPoppedFrame`
 *      calls `abortMove`, which clears the candidate and reverts the
 *      block to its origin.
 *
 * The test calls Mover directly rather than driving `SwitchScanController`
 * end-to-end: the handoff seam IS the production API the controller
 * uses, and testing it at this level avoids standing up the full scan
 * state machine (region discovery, overlay DOM, keybindings, MazeGame
 * stub). The pinned-outline suite in `test/maze-game/test/` covers the
 * controller's DOM plumbing separately.
 */

import 'jsdom-global/register';
import * as chai from 'chai';
import * as Blockly from 'blockly';
import {KeyboardNavigation} from '../src/index';
import {MoveType} from '../src/actions/mover';
import {registerFlyoutCursor} from '../src/flyout_cursor';
import {registerNavigationDeferringToolbox} from '../src/navigation_deferring_toolbox';

/**
 * Mirror the module-private `setConnectionCandidate` helper from
 * `test/maze-game/switch-scan-mode.ts`. Kept inline here so the test
 * doesn't require exporting a module-private detail just for test
 * visibility — the production copy stays authoritative. The access
 * pattern (private-field poke via an `any` cast) matches
 * `mover.ts`'s own `dragStrategy.connectionCandidate` accesses in
 * `finishMove` / `abortMove`.
 *
 * @param block The block being moved; its drag strategy carries the
 *     private `connectionCandidate` field that `finishMove` reads.
 * @param pair The `(local, target)` connection pair the test wants
 *     to commit the move onto.
 */
function seedConnectionCandidate(block, pair) {
  const dragStrategy = block.dragStrategy;
  if (!dragStrategy) return;
  dragStrategy.connectionCandidate = {
    local: pair.local,
    neighbour: pair.target,
    distance: 0,
  };
}

/**
 * Enumerate `(local, target)` pairs between `block` and every other
 * workspace block. Mirrors the production
 * `SwitchScanController.enumerateValidConnectionTargets` logic
 * (direction filter + `connectionChecker.canConnect`) but kept here
 * so the test doesn't reach into the controller's privates.
 *
 * @param workspace The workspace that owns both the moving block
 *     and the candidate target connections.
 * @param block The block whose local connections we're pairing
 *     against every other block's connections.
 * @returns Array of `{local, target}` pairs the move could commit to.
 */
function enumerateCandidatePairs(workspace, block) {
  const pairs = [];
  const localConnections = block.getConnections_(false);
  if (!localConnections.length) return pairs;
  const movingSet = new Set(block.getDescendants(true));
  const otherConnections = [];
  for (const b of workspace.getAllBlocks(false)) {
    if (movingSet.has(b)) continue;
    otherConnections.push(...b.getConnections_(false));
  }
  const checker = workspace.connectionChecker;
  for (const local of localConnections) {
    for (const other of otherConnections) {
      const validDirection =
        (local.type === Blockly.ConnectionType.OUTPUT_VALUE &&
          other.type === Blockly.ConnectionType.INPUT_VALUE) ||
        (local.type === Blockly.ConnectionType.PREVIOUS_STATEMENT &&
          other.type === Blockly.ConnectionType.NEXT_STATEMENT) ||
        (local.type === Blockly.ConnectionType.NEXT_STATEMENT &&
          other.type === Blockly.ConnectionType.PREVIOUS_STATEMENT);
      if (!validDirection) continue;
      if (checker.canConnect(local, other, true, Infinity)) {
        pairs.push({local, target: other});
      }
    }
  }
  return pairs;
}

suite('Mover switch-scan handoff', function () {
  // Shared block definitions registered once per suite; defineBlocks is
  // idempotent-safe because Blockly.Blocks is a plain record (overwrite
  // on re-register), but we define outside setup() to avoid the churn.
  suiteSetup(function () {
    // Simple stackable blocks with previous + next statement connections,
    // which produces a `(previous, next)` candidate pair when two
    // instances exist in a workspace. No field inputs — keeps rendering
    // in jsdom cheap.
    Blockly.defineBlocksWithJsonArray([
      {
        type: 'test_stackable',
        message0: 'stackable %1',
        args0: [{type: 'field_label', text: 'A'}],
        previousStatement: null,
        nextStatement: null,
        colour: 160,
      },
    ]);
  });

  setup(function () {
    this.jsdomCleanup = require('jsdom-global')(
      '<!DOCTYPE html><div id="blocklyDiv" style="height:480px;width:600px"></div>',
      {pretendToBeVisual: true},
    );
    // jsdom-global doesn't copy SVGElement onto the Node global by
    // default, but Blockly's FocusManager does `instanceof SVGElement`
    // checks on dispose and on focusNode. Pull it off window so those
    // paths work without crashing.
    if (typeof global.SVGElement === 'undefined') {
      global.SVGElement = window.SVGElement;
    }
    // jsdom ships MouseEvent but not PointerEvent. Mover's
    // `fakePointerEvent` constructs a PointerEvent directly — provide a
    // MouseEvent-based shim that accepts the same init keys so the
    // dragger receives something usable without the test having to patch
    // production code.
    if (typeof global.PointerEvent === 'undefined') {
      global.PointerEvent = class PointerEvent extends window.MouseEvent {
        constructor(type, init) {
          super(type, init);
          this.pointerId = init?.pointerId ?? 1;
          this.tiltX = init?.tiltX ?? 0;
          this.tiltY = init?.tiltY ?? 0;
          this.pointerType = init?.pointerType ?? 'mouse';
        }
      };
      window.PointerEvent = global.PointerEvent;
    }
    // jsdom's `pretendToBeVisual` provides rAF on `window` but not on
    // `global`. Mover.postDragEndCleanup calls it unqualified, so
    // expose it (and cancelAnimationFrame) at module scope.
    if (typeof global.requestAnimationFrame === 'undefined') {
      global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
      global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    }

    // Reset registries to their initial state so Mover.startMove's
    // `commitMove` shortcut registration (and prior-test leftovers)
    // doesn't collide.
    Blockly.ShortcutRegistry.registry.reset();
    Blockly.ShortcutItems.registerDefaultShortcuts();
    Blockly.ContextMenuRegistry.registry.reset();
    Blockly.ContextMenuItems.registerDefaultOptions();

    registerFlyoutCursor();
    registerNavigationDeferringToolbox();
    this.workspace = Blockly.inject('blocklyDiv');
    this.keyboardNav = new KeyboardNavigation(this.workspace);
    this.mover = this.keyboardNav.getMover();

    // Two stackable blocks: `source` is what we're going to move;
    // `target` is a separate stack top. Their connections form a single
    // valid candidate pair (source.previous ↔ target.next).
    this.sourceBlock = this.workspace.newBlock('test_stackable');
    this.sourceBlock.initSvg();
    this.sourceBlock.render();
    this.sourceBlock.moveBy(50, 50);

    this.targetBlock = this.workspace.newBlock('test_stackable');
    this.targetBlock.initSvg();
    this.targetBlock.render();
    this.targetBlock.moveBy(250, 250);
  });

  teardown(function (done) {
    this.keyboardNav.dispose();
    this.workspace.dispose();
    // Blockly's FocusManager schedules a deferred focusTree() restore
    // on dispose via setTimeout(0). In jsdom that fires AFTER our
    // teardown runs and throws "Attempted to focus unregistered tree"
    // because we've already unregistered. Install a one-shot swallow
    // for that specific error so it doesn't surface as a mocha uncaught
    // exception. Any OTHER uncaught error during the drain is re-raised.
    const originalHandler = process.listeners('uncaughtException').slice();
    process.removeAllListeners('uncaughtException');
    const swallow = (err) => {
      if (
        err &&
        err.message &&
        err.message.includes('Attempted to focus unregistered tree')
      ) {
        return;
      }
      // Re-raise anything else.
      throw err;
    };
    process.on('uncaughtException', swallow);
    setTimeout(() => {
      process.removeListener('uncaughtException', swallow);
      for (const l of originalHandler) {
        process.on('uncaughtException', l);
      }
      this.jsdomCleanup();
      done();
    }, 10);
  });

  test('startMove(switchScanMode=true) begins a move with no initial candidate', function () {
    // Mover.canMove is the production gate but it depends on focus
    // state, which is awkward to drive deterministically in jsdom.
    // The test is scoped to what happens AFTER canMove returns true —
    // i.e. the private-field handoff that Step 1 patched — so we call
    // startMove directly.
    const started = this.mover.startMove(
      this.workspace,
      this.sourceBlock,
      MoveType.Move,
      null,
      undefined,
      false,
      true, // switchScanMode
    );
    chai.assert.isTrue(started, 'startMove should succeed');
    chai.assert.isTrue(
      this.mover.isMoving(this.workspace),
      'isMoving should be true after startMove',
    );

    // The patched drag strategy is a KeyboardDragStrategy. Under
    // switchScanMode the strategy still enumerates connections but
    // skips createInitialCandidate / forceShowPreview, so the private
    // `connectionCandidate` field stays null.
    const dragStrategy = this.sourceBlock.dragStrategy;
    chai.assert.isNotNull(dragStrategy, 'drag strategy should be patched');
    chai.assert.isNull(
      dragStrategy.connectionCandidate ?? null,
      'connectionCandidate should be null — switch-scan suppresses the keyboard-mode preview jump',
    );

    // Clean up so other tests don't see a lingering move.
    this.mover.abortMove(this.workspace);
  });

  test('abort path: abortMove clears move state and leaves the block disconnected', function () {
    this.mover.startMove(
      this.workspace,
      this.sourceBlock,
      MoveType.Move,
      null,
      undefined,
      false,
      true,
    );
    chai.assert.isTrue(this.mover.isMoving(this.workspace));

    // Simulates what SwitchScanController.teardownPoppedFrame does on
    // cancel-sentinel select / back-switch / outside-pointerdown while
    // a move is still in progress.
    const aborted = this.mover.abortMove(this.workspace);
    chai.assert.isTrue(aborted, 'abortMove should report success');
    chai.assert.isFalse(
      this.mover.isMoving(this.workspace),
      'isMoving should be false after abortMove',
    );
    chai.assert.isNull(
      this.sourceBlock.previousConnection.targetConnection,
      'source should not be connected to anything after abort',
    );
    // The drag strategy's seeded candidate (if any) is cleared.
    chai.assert.isNull(
      this.sourceBlock.dragStrategy?.connectionCandidate ?? null,
      'connectionCandidate should be null after abort',
    );
  });

  test('commit path: seeded connectionCandidate drives finishMove to attach the block', function () {
    this.mover.startMove(
      this.workspace,
      this.sourceBlock,
      MoveType.Move,
      null,
      undefined,
      false,
      true,
    );

    const pairs = enumerateCandidatePairs(this.workspace, this.sourceBlock);
    chai.assert.isAtLeast(
      pairs.length,
      1,
      'expected at least one valid candidate pair between the two stackable blocks',
    );
    // Pick the specific `(source.previous, target.next)` pair so the
    // post-commit assertion can check the exact connection shape.
    const pair = pairs.find(
      (p) =>
        p.local === this.sourceBlock.previousConnection &&
        p.target === this.targetBlock.nextConnection,
    );
    chai.assert.isDefined(
      pair,
      'expected a (source.previous, target.next) candidate pair',
    );

    // The seam under test: switch-scan sets the strategy's
    // connectionCandidate directly, then finishMove reads it.
    seedConnectionCandidate(this.sourceBlock, pair);
    const dragStrategy = this.sourceBlock.dragStrategy;
    chai.assert.isNotNull(
      dragStrategy.connectionCandidate,
      'candidate should be seeded before finishMove',
    );
    chai.assert.strictEqual(
      dragStrategy.connectionCandidate.local,
      pair.local,
    );
    chai.assert.strictEqual(
      dragStrategy.connectionCandidate.neighbour,
      pair.target,
    );

    this.mover.finishMove(this.workspace);
    chai.assert.isFalse(
      this.mover.isMoving(this.workspace),
      'move should be complete after finishMove',
    );
    chai.assert.strictEqual(
      this.sourceBlock.previousConnection.targetConnection,
      this.targetBlock.nextConnection,
      'source.previous should now be connected to target.next',
    );
  });
});
