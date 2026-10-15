/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the switch-scan strategy registry's `preferredDirection`
 * methods and the module-level `applySentinelChip` placement helper.
 * Both surfaces are exposed via `__testOnly` on `switch-scan-mode.ts`.
 *
 * Rationale: `preferredDirection` + `applySentinelChip` + each strategy's
 * `rectAt` together position the "Back" chip relative to the last
 * preceding item of the active group. A regression in any one piece
 * would silently mis-place the chip for one frame kind only — the kind
 * a cross-cutting integration test would miss.
 */

import 'jsdom-global/register';
import * as chai from 'chai';

// jsdom-global/register copies most `window.*` keys onto `global`, but
// `DOMRect` isn't in its allow-list. Rebind it here so test fixtures
// can construct DOMRects.
global.DOMRect = window.DOMRect;

import {__testOnly} from './maze-game/switch-scan-mode';

// Earlier mocha files (e.g. `controller_test.mocha.js`) tear down their
// own jsdom instance per test, and that teardown deletes
// `global.document` / `global.window`. The `jsdom-global/register`
// side-effect import is cached by Node's module loader so re-requiring
// it is a no-op; we invoke the underlying factory directly instead,
// which re-populates the globals. Called from each suite's setup hook.
function ensureDom() {
  if (!global.document) {
    require('jsdom-global')();
    global.DOMRect = global.window.DOMRect;
  }
  return global.document;
}

const {STRATEGIES, applySentinelChip} = __testOnly;
const {expect} = chai;

function rect(left, top, width, height) {
  return new DOMRect(left, top, width, height);
}

// Stub HTMLElement-ish that returns `r` from `getBoundingClientRect`.
function stubItem(r) {
  return {getBoundingClientRect: () => r};
}

suite('switch-scan: strategy preferredDirection — static strategies', function () {
  test('blocks → vertical (stack is a column)', function () {
    const frame = {kind: 'blocks', regionName: 'workspace'};
    expect(STRATEGIES.blocks.preferredDirection(frame, {})).to.equal('vertical');
  });

  test('action-menu → vertical (popup rows stacked)', function () {
    expect(STRATEGIES['action-menu'].preferredDirection({}, {})).to.equal('vertical');
  });

  test('dropdown-values → vertical (popup options stacked)', function () {
    expect(STRATEGIES['dropdown-values'].preferredDirection({}, {})).to.equal('vertical');
  });

  test('move-candidates → vertical (default)', function () {
    expect(STRATEGIES['move-candidates'].preferredDirection({}, {})).to.equal('vertical');
  });
});

suite('switch-scan: strategy preferredDirection — dom-items (DOM-derived)', function () {
  test('horizontal row of items → horizontal', function () {
    // Three items in a row: Y stays at 10, X moves from 0 to 400.
    const items = [
      stubItem(rect(0, 10, 100, 40)),
      stubItem(rect(200, 10, 100, 40)),
      stubItem(rect(400, 10, 100, 40)),
    ];
    const frame = {kind: 'dom-items', items};
    expect(STRATEGIES['dom-items'].preferredDirection(frame, {})).to.equal('horizontal');
  });

  test('vertical column of items → vertical', function () {
    // Three items in a column: X stays at 50, Y moves from 10 to 410.
    const items = [
      stubItem(rect(50, 10, 100, 40)),
      stubItem(rect(50, 210, 100, 40)),
      stubItem(rect(50, 410, 100, 40)),
    ];
    const frame = {kind: 'dom-items', items};
    expect(STRATEGIES['dom-items'].preferredDirection(frame, {})).to.equal('vertical');
  });

  test('single-item or empty group → vertical (safe default)', function () {
    const one = {kind: 'dom-items', items: [stubItem(rect(0, 0, 10, 10))]};
    expect(STRATEGIES['dom-items'].preferredDirection(one, {})).to.equal('vertical');
    const none = {kind: 'dom-items', items: []};
    expect(STRATEGIES['dom-items'].preferredDirection(none, {})).to.equal('vertical');
  });
});

suite('switch-scan: applySentinelChip — null lastItemRect (fixed-slot fallback)', function () {
  let chip;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
  });

  test('horizontal direction with null rect → chip parks in bottom-right', function () {
    applySentinelChip(chip, null, true, 1000, 800);
    expect(chip.style.display).to.equal('block');
    expect(chip.style.bottom).to.equal('16px');
    expect(chip.style.right).to.equal('16px');
    expect(chip.style.top).to.equal('');
    expect(chip.style.left).to.equal('');
  });

  test('vertical direction with null rect → chip parks in bottom-right', function () {
    applySentinelChip(chip, null, false, 1000, 800);
    expect(chip.style.bottom).to.equal('16px');
    expect(chip.style.right).to.equal('16px');
  });
});

suite('switch-scan: applySentinelChip — horizontal flow (primary: right of last item)', function () {
  let chip;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
  });

  test('last item has room to its right → chip adjacent-right', function () {
    // Last item: 100x40 at (200, 20). Right edge = 300, well short of
    // viewport width 1000.
    const lastItem = rect(200, 20, 100, 40);
    applySentinelChip(chip, lastItem, true, 1000, 800);
    expect(chip.style.display).to.equal('block');
    // left = right(300) + gap(8) = 308; top = lastItem.top = 20
    expect(chip.style.left).to.equal('308px');
    expect(chip.style.top).to.equal('20px');
    expect(chip.style.bottom).to.equal('');
    expect(chip.style.right).to.equal('');
  });

  test('last item at the right edge → chip wraps below, clamped to viewport', function () {
    // Last item: 100x40 at (820, 10). Primary (right-of) overflows
    // width → wrap below. Wrap anchor left=820 + chip width 200 =
    // 1020 > viewport 1000, so clamp left to viewportWidth - chipWidth
    // = 800. The chip still sits under / overlapping Language's slot.
    const lastItem = rect(820, 10, 100, 40);
    applySentinelChip(chip, lastItem, true, 1000, 800);
    expect(chip.style.left).to.equal('800px');
    expect(chip.style.top).to.equal('58px');
  });
});

suite('switch-scan: applySentinelChip — vertical flow (primary: below last item)', function () {
  let chip;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
  });

  test('last item has room below → chip adjacent-below', function () {
    // Last item: 150x40 at (30, 300). Below slot (top=348) has viewport
    // room (348 + 50 = 398 < 800).
    const lastItem = rect(30, 300, 150, 40);
    applySentinelChip(chip, lastItem, false, 1000, 800);
    expect(chip.style.display).to.equal('block');
    // left = lastItem.left = 30; top = bottom(340) + gap(8) = 348
    expect(chip.style.left).to.equal('30px');
    expect(chip.style.top).to.equal('348px');
  });

  test('last item near the bottom → chip wraps right, clamped to viewport', function () {
    // Last item: 80x40 at (20, 760). Primary (below) overflows height
    // → wrap right-of. Wrap anchor top=760 + chip height 50 = 810 >
    // viewport 800, so clamp top to viewportHeight - chipHeight = 750.
    const lastItem = rect(20, 760, 80, 40);
    applySentinelChip(chip, lastItem, false, 1000, 800);
    expect(chip.style.left).to.equal('108px');
    expect(chip.style.top).to.equal('750px');
  });
});

suite('switch-scan: applySentinelChip — last item in a corner (clamp into viewport)', function () {
  let chip;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
  });

  test('last item in the bottom-right corner → chip clamps to viewport edges', function () {
    // Last item: 100x40 at (870, 760). Primary (right-of) overflows →
    // wrap below. Wrap anchor (870, 808) overflows both axes → clamp:
    // left = min(870, 1000-200) = 800; top = min(808, 800-50) = 750.
    const lastItem = rect(870, 760, 100, 40);
    applySentinelChip(chip, lastItem, true, 1000, 800);
    expect(chip.style.left).to.equal('800px');
    expect(chip.style.top).to.equal('750px');
  });
});

suite('switch-scan: applySentinelChip — leak check', function () {
  let chip;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    chip.style.bottom = '16px';
    chip.style.right = '16px';
  });

  test('placing adjacent to a last item clears stale bottom/right', function () {
    const lastItem = rect(100, 100, 100, 40);
    applySentinelChip(chip, lastItem, true, 1000, 800);
    expect(chip.style.bottom).to.equal('');
    expect(chip.style.right).to.equal('');
    expect(chip.style.left).to.equal('208px');
  });
});
