/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the switch-scan strategy registry's `groupRect`
 * methods and the module-level `applySentinelChip` placement helper.
 * Both surfaces are exposed via `__testOnly` on `switch-scan-mode.ts`;
 * see that export's JSDoc for the testing contract.
 *
 * Rationale: `groupRect` and `applySentinelChip` together implement
 * the "sentinel chip anchored on its group" visual policy. Each
 * strategy owns its own group definition, so a single wrong rect in
 * one strategy would silently mis-anchor the chip for that frame kind
 * only — exactly the kind of regression a cross-cutting integration
 * test would miss.
 */

import 'jsdom-global/register';
import * as chai from 'chai';

// jsdom-global/register copies most `window.*` keys onto `global`, but
// `DOMRect` isn't in its allow-list. Rebind it here so the module-level
// `new DOMRect(...)` calls in `switch-scan-mode.ts` resolve.
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

const {STRATEGIES, unionRects, applySentinelChip} = __testOnly;
const {expect} = chai;

// Build a plain DOMRect with the four edges given.
function rect(left, top, width, height) {
  return new DOMRect(left, top, width, height);
}

// Stub HTMLElement-ish that returns `r` from `getBoundingClientRect`.
// Everything else is left undefined — the strategies under test don't
// read anything else.
function stubItem(r) {
  return {getBoundingClientRect: () => r};
}

// Stub for `ctx.actionMenuEl` / `ctx.dropdownMenuEl` — same shape as
// stubItem but named for the call-site that reads it. The strategies
// read these fields off `ctx` and then call `getBoundingClientRect()`.
function stubMenuEl(r) {
  return {getBoundingClientRect: () => r};
}

suite('switch-scan: unionRects', function () {
  test('returns null when every input is zero-area', function () {
    const r = unionRects([rect(0, 0, 0, 0), rect(5, 5, 0, 10)]);
    expect(r).to.equal(null);
  });

  test('unions two non-overlapping rects into their bounding box', function () {
    const r = unionRects([rect(10, 20, 30, 40), rect(100, 200, 50, 60)]);
    // left=10, top=20, right=max(40,150)=150, bottom=max(60,260)=260
    expect(r.left).to.equal(10);
    expect(r.top).to.equal(20);
    expect(r.right).to.equal(150);
    expect(r.bottom).to.equal(260);
  });

  test('drops zero-area rects from the union', function () {
    const r = unionRects([rect(10, 10, 20, 20), rect(0, 0, 0, 0)]);
    expect(r.left).to.equal(10);
    expect(r.right).to.equal(30);
  });
});

suite("switch-scan: strategy groupRect — 'top'", function () {
  test('returns null (top frame has no sentinel to anchor)', function () {
    const frame = {kind: 'top', index: 0};
    const result = STRATEGIES['top'].groupRect(frame, {});
    expect(result).to.equal(null);
  });
});

suite("switch-scan: strategy groupRect — 'dom-items'", function () {
  test('returns the union of every item rect', function () {
    const frame = {
      kind: 'dom-items',
      parentRegionName: 'header',
      items: [
        stubItem(rect(10, 10, 20, 20)),
        stubItem(rect(100, 100, 20, 20)),
      ],
      index: 2,
      topLevelIndex: 0,
    };
    const r = STRATEGIES['dom-items'].groupRect(frame, {});
    expect(r.left).to.equal(10);
    expect(r.top).to.equal(10);
    expect(r.right).to.equal(120);
    expect(r.bottom).to.equal(120);
  });

  test('returns null when the item list is empty', function () {
    const frame = {
      kind: 'dom-items',
      parentRegionName: 'header',
      items: [],
      index: 0,
      topLevelIndex: 0,
    };
    const r = STRATEGIES['dom-items'].groupRect(frame, {});
    expect(r).to.equal(null);
  });
});

suite("switch-scan: strategy groupRect — 'blocks'", function () {
  test('workspace region: unions ctx.getSingleBlockViewportRect per block', function () {
    const blockA = {}; // only identity matters — ctx stub maps it to a rect
    const blockB = {};
    const map = new Map([
      [blockA, rect(50, 50, 100, 100)],
      [blockB, rect(200, 60, 100, 100)],
    ]);
    const frame = {
      kind: 'blocks',
      regionName: 'workspace',
      blocks: [blockA, blockB],
      index: 2,
      topLevelIndex: 1,
    };
    const ctx = {
      getSingleBlockViewportRect: (b) => map.get(b) || null,
    };
    const r = STRATEGIES['blocks'].groupRect(frame, ctx);
    expect(r.left).to.equal(50);
    expect(r.top).to.equal(50);
    expect(r.right).to.equal(300);
    expect(r.bottom).to.equal(160);
  });

  test('toolbox region: unions block.getSvgRoot().getBoundingClientRect()', function () {
    const makeBlock = (r) => ({getSvgRoot: () => ({getBoundingClientRect: () => r})});
    const frame = {
      kind: 'blocks',
      regionName: 'toolbox',
      blocks: [makeBlock(rect(0, 0, 40, 40)), makeBlock(rect(0, 50, 40, 40))],
      index: 2,
      topLevelIndex: 0,
    };
    const r = STRATEGIES['blocks'].groupRect(frame, {});
    expect(r.left).to.equal(0);
    expect(r.top).to.equal(0);
    expect(r.right).to.equal(40);
    expect(r.bottom).to.equal(90);
  });
});

suite("switch-scan: strategy groupRect — 'action-menu'", function () {
  test('returns the menu element bounding rect', function () {
    const menuRect = rect(300, 150, 200, 120);
    const frame = {
      kind: 'action-menu',
      block: {},
      items: [{key: 'select', label: 'Select'}],
      index: 1,
      topLevelIndex: 2,
    };
    const ctx = {actionMenuEl: stubMenuEl(menuRect)};
    const r = STRATEGIES['action-menu'].groupRect(frame, ctx);
    expect(r.left).to.equal(300);
    expect(r.top).to.equal(150);
    expect(r.right).to.equal(500);
    expect(r.bottom).to.equal(270);
  });

  test('returns null when the action menu element is absent', function () {
    const frame = {
      kind: 'action-menu',
      block: {},
      items: [],
      index: 0,
      topLevelIndex: 2,
    };
    const r = STRATEGIES['action-menu'].groupRect(frame, {actionMenuEl: null});
    expect(r).to.equal(null);
  });
});

suite("switch-scan: strategy groupRect — 'dropdown-values'", function () {
  test('returns the dropdown element bounding rect', function () {
    const menuRect = rect(400, 250, 160, 90);
    const frame = {
      kind: 'dropdown-values',
      block: null,
      field: null,
      anchor: {},
      options: [],
      index: 0,
      topLevelIndex: 2,
    };
    const ctx = {dropdownMenuEl: stubMenuEl(menuRect)};
    const r = STRATEGIES['dropdown-values'].groupRect(frame, ctx);
    expect(r.left).to.equal(400);
    expect(r.top).to.equal(250);
    expect(r.right).to.equal(560);
    expect(r.bottom).to.equal(340);
  });

  test('returns null when the dropdown element is absent', function () {
    const frame = {
      kind: 'dropdown-values',
      block: null,
      field: null,
      anchor: {},
      options: [],
      index: 0,
      topLevelIndex: 2,
    };
    const r = STRATEGIES['dropdown-values'].groupRect(frame, {dropdownMenuEl: null});
    expect(r).to.equal(null);
  });
});

// The 'move-candidates' strategy's groupRect calls the module-imported
// `getConnectionViewportRect` on each candidate's target connection,
// not a method on `ctx`. Stubbing that import would require either a
// webpack alias or a module-level DI hook; neither is justified for a
// single branch, so the move-candidates groupRect path is covered end-
// to-end via wdio instead.

suite('switch-scan: applySentinelChip — null groupRect (fixed-slot fallback)', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    mask = doc.createElement('div');
    mask.style.display = 'block';
  });

  test('parks the chip in the bottom-right fixed slot and hides the mask', function () {
    applySentinelChip(chip, mask, null, 1000, 800);
    expect(mask.style.display).to.equal('none');
    expect(chip.style.display).to.equal('block');
    expect(chip.style.bottom).to.equal('16px');
    expect(chip.style.right).to.equal('16px');
    expect(chip.style.top).to.equal('');
    expect(chip.style.left).to.equal('');
    expect(chip.style.transform).to.equal('none');
  });
});

suite('switch-scan: applySentinelChip — horizontal group (primary: to the right)', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    mask = doc.createElement('div');
  });

  test('info-bar-sized stripe → mask + chip to the right of the group', function () {
    // 400x50 group at x=100, y=20 in a 1000x800 viewport. Horizontal
    // (width > height); primary placement fits.
    const group = rect(100, 20, 400, 50);
    applySentinelChip(chip, mask, group, 1000, 800);
    expect(mask.style.display).to.equal('block');
    expect(mask.style.width).to.equal('400px');
    expect(chip.style.display).to.equal('block');
    // left = right(500) + gap(8) = 508; top = group.top = 20
    expect(chip.style.left).to.equal('508px');
    expect(chip.style.top).to.equal('20px');
    expect(chip.style.transform).to.equal('none');
    expect(chip.style.bottom).to.equal('');
    expect(chip.style.right).to.equal('');
  });
});

suite('switch-scan: applySentinelChip — horizontal group with no right-side space (wrap below)', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    mask = doc.createElement('div');
  });

  test('header-sized stripe → mask + chip wraps below the group', function () {
    // 950x50 group at x=25, y=10 in a 1000x800 viewport. Horizontal;
    // primary (right of group, left=983) overflows width (983 + 200 > 1000).
    // Wrap: below the group, left aligned.
    const group = rect(25, 10, 950, 50);
    applySentinelChip(chip, mask, group, 1000, 800);
    expect(mask.style.display).to.equal('block');
    expect(chip.style.display).to.equal('block');
    // Wrap: left = group.left = 25; top = group.bottom(60) + gap(8) = 68
    expect(chip.style.left).to.equal('25px');
    expect(chip.style.top).to.equal('68px');
    expect(chip.style.transform).to.equal('none');
  });
});

suite('switch-scan: applySentinelChip — vertical group (primary: below)', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    mask = doc.createElement('div');
  });

  test('toolbox-sized column → mask + chip below the group', function () {
    // 80x400 group at x=20, y=100 in a 1000x800 viewport. Vertical
    // (height > width); primary (below) fits.
    const group = rect(20, 100, 80, 400);
    applySentinelChip(chip, mask, group, 1000, 800);
    expect(mask.style.display).to.equal('block');
    expect(chip.style.display).to.equal('block');
    // left = group.left = 20; top = bottom(500) + gap(8) = 508
    expect(chip.style.left).to.equal('20px');
    expect(chip.style.top).to.equal('508px');
    expect(chip.style.transform).to.equal('none');
  });
});

suite('switch-scan: applySentinelChip — vertical group with no space below (wrap right)', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    mask = doc.createElement('div');
  });

  test('tall column at viewport bottom → mask + chip wraps to the right', function () {
    // 80x700 column at x=20, y=80 in a 1000x800 viewport. Vertical;
    // primary (below, top=788) would overflow height (788 + 50 > 800).
    // Wrap: to the right of the group.
    const group = rect(20, 80, 80, 700);
    applySentinelChip(chip, mask, group, 1000, 800);
    expect(mask.style.display).to.equal('block');
    expect(chip.style.display).to.equal('block');
    // Wrap: left = right(100) + gap(8) = 108; top = group.top = 80
    expect(chip.style.left).to.equal('108px');
    expect(chip.style.top).to.equal('80px');
    expect(chip.style.transform).to.equal('none');
  });
});

suite('switch-scan: applySentinelChip — group too big in both axes (inside-group fallback)', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    mask = doc.createElement('div');
  });

  test('both primary and wrap overflow → chip anchors to group top-centre inside the bbox', function () {
    // 950x750 group filling most of a 1000x800 viewport. Horizontal
    // (barely wider than tall). Primary (to the right, left=963) and
    // wrap (below, top=768) both overflow — fall back to inside the
    // group's top-centre.
    const group = rect(25, 25, 950, 750);
    applySentinelChip(chip, mask, group, 1000, 800);
    expect(mask.style.display).to.equal('block');
    expect(chip.style.display).to.equal('block');
    // left = centreX = 25 + 475 = 500; top = group.top(25) + inset(24) = 49
    expect(chip.style.left).to.equal('500px');
    expect(chip.style.top).to.equal('49px');
    expect(chip.style.transform).to.equal('translateX(-50%)');
  });
});

suite('switch-scan: applySentinelChip — leak check', function () {
  let chip;
  let mask;

  setup(function () {
    const doc = ensureDom();
    chip = doc.createElement('div');
    chip.className = 'switch-scan-sentinel';
    chip.style.bottom = '16px';
    chip.style.right = '16px';
    mask = doc.createElement('div');
  });

  test('placing on a group clears prior fixed-slot bottom/right', function () {
    const group = rect(100, 200, 400, 50);
    applySentinelChip(chip, mask, group, 1000, 800);
    expect(chip.style.bottom).to.equal('');
    expect(chip.style.right).to.equal('');
  });
});
