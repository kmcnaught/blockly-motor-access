/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Shared block-insertion heuristic used by both
 * GridCodingModeController (keyboard W/A/D shortcuts) and
 * SwitchScanController (two-switch scanning). Extracted to one place so
 * the two input modes behave identically when adding a block to the
 * workspace.
 */

import * as Blockly from 'blockly/core';

/**
 * Default workspace coordinates for the very first block in an empty
 * workspace. Mirrors `STACK_ANCHOR_X` / `STACK_ANCHOR_Y` in
 * `index.ts`; duplicated as literal defaults here to avoid an import
 * cycle and because they're stable layout constants.
 */
const DEFAULT_STACK_ANCHOR_X = 25;
const DEFAULT_STACK_ANCHOR_Y = 60;

/**
 * Shared insertion heuristic used by both grid-coding-mode and
 * switch-scan-mode:
 *
 *  - If the Blockly FocusManager cursor sits on a workspace block,
 *    connect the new block AFTER it. If that block has no
 *    `nextConnection`, fall back to its parent's `nextConnection` (so
 *    inserting "after" a block embedded inside an `if`/`repeat`
 *    statement input still works).
 *  - Otherwise, walk to the END of the first top-block's nextConnection
 *    chain and connect there.
 *  - If the workspace is empty, drop the new block at the stack anchor
 *    coordinates (defaults match index.ts STACK_ANCHOR_X/Y).
 *
 * This file exposes two entry points on top of that heuristic:
 *
 *  - {@link insertBlockAfterCursor}: build a fresh block from a type
 *    name plus optional field preset map. Used by grid-coding-mode's
 *    action buttons, which already know the type and preset values.
 *  - {@link insertBlockCloneAfterCursor}: clone an existing block
 *    (typically a flyout block) via Blockly's serialization so the
 *    inserted block preserves fields, mutators, child/shadow blocks,
 *    and any extra state. Used by switch-scan's toolbox insert so
 *    toolbox variants that differ only by preset (e.g. `turn [left]`
 *    vs `turn [right]`) land as the selected variant — parity with
 *    the mouse-click flyout flow, which also goes through
 *    serialization under the hood.
 *
 * Neither entry point tracks undo history — that's a caller concern.
 */

/**
 * Insert a new block of the given type into the workspace.
 *
 * @param workspace The main workspace to insert into.
 * @param blockType The Blockly block type name (e.g. `maze_moveForward`).
 * @param fields    Optional map of field-name -> value to set on the
 *     newly created block before rendering.
 * @param anchorX   Workspace x for the first block in an empty workspace.
 * @param anchorY   Workspace y for the first block in an empty workspace.
 * @returns The inserted block.
 */
export function insertBlockAfterCursor(
  workspace: Blockly.WorkspaceSvg,
  blockType: string,
  fields?: Record<string, string | number>,
  anchorX: number = DEFAULT_STACK_ANCHOR_X,
  anchorY: number = DEFAULT_STACK_ANCHOR_Y,
): Blockly.Block {
  return insertWithEventGrouping(workspace, anchorX, anchorY, () => {
    const block = workspace.newBlock(blockType);
    if (fields) {
      for (const [name, value] of Object.entries(fields)) {
        block.setFieldValue(value, name);
      }
    }
    return block;
  });
}

/**
 * Insert a clone of {@link sourceBlock} into the workspace. Uses
 * Blockly's serialization so the clone carries over fields, mutations,
 * extraState, and attached shadow/child blocks — i.e. matches what the
 * flyout's own click handler produces.
 *
 * @param workspace    The main workspace to insert into.
 * @param sourceBlock  The block to clone (typically a flyout block).
 * @param anchorX      Workspace x for an empty-workspace drop.
 * @param anchorY      Workspace y for an empty-workspace drop.
 * @returns The inserted (cloned) block.
 */
export function insertBlockCloneAfterCursor(
  workspace: Blockly.WorkspaceSvg,
  sourceBlock: Blockly.Block,
  anchorX: number = DEFAULT_STACK_ANCHOR_X,
  anchorY: number = DEFAULT_STACK_ANCHOR_Y,
): Blockly.Block {
  // addCoordinates: the source is in the flyout workspace; its
  // coordinates there are meaningless on the main workspace, and we
  // position via `moveBy` or connection snap below.
  // addNextBlocks: deliberately diverges from Blockly's own flyout
  // flow (which uses the default `true`). Toolbox flyout blocks don't
  // normally carry next-chains, so this is defensive — but if a future
  // toolbox grows a stacked preset, we want only the HEAD block so the
  // insertion heuristic lands it on the user's chosen attach point
  // rather than appending the whole stack.
  const saved = Blockly.serialization.blocks.save(sourceBlock, {
    addCoordinates: false,
    addNextBlocks: false,
    doFullSerialization: true,
  });
  if (!saved) {
    throw new Error(
      `block-insertion: Blockly failed to serialize source block ` +
        `(type=${sourceBlock.type}).`,
    );
  }
  // Strip the source id so `append` assigns a fresh one — otherwise
  // the clone collides with the flyout block in the workspace's id map.
  delete (saved as {id?: string}).id;
  return insertWithEventGrouping(workspace, anchorX, anchorY, () => {
    return Blockly.serialization.blocks.append(saved, workspace, {
      recordUndo: true,
    });
  });
}

/**
 * Shared wrapper that bundles the pre/post work both entry points need:
 * resolving the target connection BEFORE the new block is created
 * (otherwise its own previousConnection could match the cursor search),
 * grouping Blockly events for a single undo step, initSvg + render, and
 * either snapping to the connection or dropping at the stack anchor.
 *
 * @param workspace Target workspace.
 * @param anchorX   Empty-workspace x drop coordinate.
 * @param anchorY   Empty-workspace y drop coordinate.
 * @param createBlock Callback that produces the (not-yet-rendered)
 *     block on `workspace`. May or may not have called `initSvg`
 *     already — we call it defensively below only when needed.
 * @returns The inserted block.
 */
function insertWithEventGrouping(
  workspace: Blockly.WorkspaceSvg,
  anchorX: number,
  anchorY: number,
  createBlock: () => Blockly.Block,
): Blockly.Block {
  const connectionTarget = findInsertionConnection(workspace);

  const existingGroup = Blockly.Events.getGroup();
  if (!existingGroup) {
    Blockly.Events.setGroup(true);
  }

  try {
    const block = createBlock();

    // `workspace.newBlock` returns a block that still needs initSvg +
    // render; `serialization.blocks.append` already did both. Both
    // calls are idempotent (initSvg self-guards on `initialized`,
    // render on a rendered block is a no-op reflow), so we always run
    // them — relying on `BlockSvg.rendered` as a guard doesn't work:
    // it's `readonly rendered = true` from the BlockSvg constructor.
    const blockSvg = block as Blockly.BlockSvg;
    blockSvg.initSvg();
    blockSvg.render();

    if (connectionTarget && block.previousConnection) {
      connectionTarget.connect(block.previousConnection);
    } else if (!connectionTarget) {
      blockSvg.moveBy(anchorX, anchorY);
    }

    return block;
  } finally {
    if (!existingGroup) {
      Blockly.Events.setGroup(false);
    }
  }
}

/**
 * Resolve the connection the next inserted block should attach to.
 *
 * Priority:
 * 1. Cursor block's `nextConnection`, if the FocusManager points at a
 * block on the given workspace and that block exposes one.
 * 2. Cursor block's parent's `nextConnection`, if the cursor block is
 * a tail-only block (e.g. some control blocks have no next slot).
 * 3. The end of the first top-block's `nextConnection` chain.
 *
 * Returns `null` when the workspace has no blocks at all (the caller
 * places the new block at the stack anchor in that case).
 *
 * @param workspace
 */
function findInsertionConnection(
  workspace: Blockly.WorkspaceSvg,
): Blockly.Connection | null {
  // Try the FocusManager cursor first.
  const focused = Blockly.getFocusManager().getFocusedNode();
  if (focused instanceof Blockly.BlockSvg && focused.workspace === workspace) {
    if (focused.nextConnection) {
      return focused.nextConnection;
    }
    // Block has no next connection (rare for stackable blocks) — try
    // its parent so we still insert "after" something meaningful.
    const parent = focused.getParent();
    if (parent && parent.nextConnection) {
      return parent.nextConnection;
    }
    // Fall through to chain walk.
  }

  // Walk the first top-block's chain to its tail.
  const topBlocks = workspace.getTopBlocks(true);
  if (topBlocks.length === 0) return null;

  let lastBlock = topBlocks[0];
  while (lastBlock.nextConnection?.targetBlock()) {
    lastBlock = lastBlock.nextConnection.targetBlock()!;
  }
  return lastBlock.nextConnection ?? null;
}
