/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the switch-scan auto-mode timer: the two-phase
 * setTimeout → setInterval schedule, the first-tick bonus applied on
 * wake and on frame transitions, and the opt-out contract that keeps
 * repaint-only renders from re-arming the timer. These guarantees sit
 * across several call sites in `switch-scan-mode.ts`, so a focused
 * timer test is the pragmatic guard against someone later threading a
 * different render option (or dropping the `advance()` opt-out) and
 * silently deadlocking the scan.
 *
 * The tests use a hand-rolled fake clock that monkey-patches
 * `window.setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`
 * and advances via a `tick(ms)` helper. No real time passes; each test
 * drives the schedule explicitly so the assertions can target exact tick
 * counts and timing boundaries.
 */

import 'jsdom-global/register';
import * as chai from 'chai';

// `jsdom-global/register` copies most `window.*` keys onto `global`,
// but some tests in this file construct DOMRects.
global.DOMRect = window.DOMRect;

import {__testOnly} from './maze-game/switch-scan-mode';

const {SwitchScanController, DEFAULT_FIRST_TICK_BONUS_FACTOR} = __testOnly;
const {expect} = chai;

// Earlier mocha files (e.g. `controller_test.mocha.js`) tear down their
// own jsdom instance per test, and that teardown deletes
// `global.document` / `global.window`. The `jsdom-global/register`
// side-effect import is cached by Node's module loader so re-requiring
// it is a no-op; we invoke the underlying factory directly instead,
// which re-populates the globals. Called from each suite's setup hook.
function ensureDom() {
  if (!global.document || !global.window) {
    require('jsdom-global')();
    global.DOMRect = global.window.DOMRect;
  }
  return global.window;
}

/**
 * Install a hand-rolled fake clock over `window.setTimeout`,
 * `setInterval`, `clearTimeout`, `clearInterval`. Returns a controller
 * with:
 *   - `now()`           — current virtual time (ms since install).
 *   - `tick(ms)`        — advance virtual time by `ms`, firing any
 *                         scheduled callbacks whose due time falls
 *                         within the window (in due-time order).
 *   - `pendingCount()`  — number of still-scheduled callbacks (both
 *                         timeouts and intervals).
 *   - `restore()`       — restore the original timer functions.
 *
 * `setInterval` fires callbacks repeatedly at `delay` ms; `setTimeout`
 * fires once. Both return unique numeric handles; `clearTimeout` and
 * `clearInterval` accept the same handles and are interchangeable
 * (matches browser behavior for cross-type clears).
 */
function installFakeClock() {
  const originals = {
    setTimeout: window.setTimeout,
    setInterval: window.setInterval,
    clearTimeout: window.clearTimeout,
    clearInterval: window.clearInterval,
  };
  let virtualNow = 0;
  let nextId = 1;
  // Keyed by id; each entry: {due, delay, cb, repeat}.
  const scheduled = new Map();

  function schedule(cb, delay, repeat) {
    const id = nextId++;
    scheduled.set(id, {due: virtualNow + delay, delay, cb, repeat});
    return id;
  }

  window.setTimeout = (cb, delay) => schedule(cb, delay ?? 0, false);
  window.setInterval = (cb, delay) => schedule(cb, delay ?? 0, true);
  window.clearTimeout = (id) => {
    scheduled.delete(id);
  };
  window.clearInterval = (id) => {
    scheduled.delete(id);
  };

  function tick(ms) {
    const target = virtualNow + ms;
    // Fire callbacks in due-time order until we've consumed the window.
    // Each iteration pulls the earliest-due entry; re-arming an
    // interval mutates the map mid-loop, so we re-scan every pass
    // rather than snapshotting.
    while (true) {
      let earliest = null;
      let earliestId = null;
      for (const [id, entry] of scheduled) {
        if (entry.due > target) continue;
        if (earliest === null || entry.due < earliest.due) {
          earliest = entry;
          earliestId = id;
        }
      }
      if (earliest === null) break;
      virtualNow = earliest.due;
      if (earliest.repeat) {
        earliest.due = virtualNow + earliest.delay;
      } else {
        scheduled.delete(earliestId);
      }
      earliest.cb();
    }
    virtualNow = target;
  }

  return {
    now: () => virtualNow,
    tick,
    pendingCount: () => scheduled.size,
    restore: () => {
      window.setTimeout = originals.setTimeout;
      window.setInterval = originals.setInterval;
      window.clearTimeout = originals.clearTimeout;
      window.clearInterval = originals.clearInterval;
    },
  };
}

/**
 * Minimal MazeGame-shaped stub. The controller only touches three
 * methods during the paths these tests drive; `isExecuting` returns
 * false so `enable()` would not go down the "paused" branch, and the
 * on/off hooks are no-ops because we never actually call `enable()`.
 */
function makeMazeGameStub() {
  return {
    isExecuting: () => false,
    onExecutionStateChange: () => {},
    offExecutionStateChange: () => {},
  };
}

/**
 * Create a controller pre-configured for auto mode and poke it into a
 * state that mirrors a post-`enable()` scanner: `enabled = true`, a
 * single `top` frame, three stub regions (so `cycleLen(top) === 3` and
 * `advance()` can wrap safely), and freshly-created overlay DOM so
 * `renderHighlight` runs to completion rather than short-circuiting at
 * the "no overlays" early return.
 *
 * We bypass `enable()` because it would subscribe to the real
 * `discoverRegions` DOM probe. Driving the fields directly keeps the
 * fixture lean while still exercising the real `renderHighlight` →
 * `restartAutoTimerIfScanning` → `startAutoTimer` chain under test.
 *
 * @param scanSpeedMs The auto-scan interval. Defaults to 1000 ms so
 *     the bonus (`1200 ms`) sits at a clearly-distinct boundary from
 *     the steady cadence.
 */
function makeController(scanSpeedMs = 1000) {
  const ctrl = new SwitchScanController({}, makeMazeGameStub(), {
    scanMode: 'auto',
    scanSpeedMs,
  });
  // The controller's own `createOverlayElements` call lives inside
  // `enable()`; invoke it directly so `renderHighlight` has the
  // elements it short-circuits on.
  ctrl.createOverlayElements();
  ctrl.enabled = true;
  ctrl.frameStack = [{kind: 'top', index: 0}];
  // Stub three regions with null-returning rect thunks. `renderHighlight`
  // tolerates a null rect (hides the ring, still re-arms the timer),
  // which is exactly the path we want to exercise without needing to
  // measure anything in jsdom.
  ctrl.regions = [
    {name: 'header', getRect: () => null},
    {name: 'instruction-bar', getRect: () => null},
    {name: 'workspace', getRect: () => null},
  ];
  return ctrl;
}

suite('switch-scan: auto-scan timer — wake path', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
  });

  teardown(function () {
    clock.restore();
  });

  test('wake via handleKeyDown fires first tick at scanSpeedMs * DEFAULT_FIRST_TICK_BONUS_FACTOR', function () {
    // Pre-wake sanity: scanner is idle, no timers scheduled.
    expect(ctrl.autoState).to.equal('idle');
    expect(clock.pendingCount()).to.equal(0);

    // Dispatch the advance key (Space is the default `switchAdvance`).
    // Capture-phase listener on `document` picks it up and transitions
    // idle → scanning via `startAutoTimer(scanSpeedMs * BONUS)`.
    document.addEventListener('keydown', ctrl.boundKeyHandler, true);
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', {key: ' ', bubbles: true}),
    );
    document.removeEventListener('keydown', ctrl.boundKeyHandler, true);

    expect(ctrl.autoState).to.equal('scanning');
    expect(ctrl.autoFirstTickHandle).to.not.equal(null);
    expect(ctrl.autoIntervalHandle).to.equal(null);

    // Just-before the bonus boundary: no tick yet.
    const bonusMs = 1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR;
    clock.tick(bonusMs - 1);
    expect(ctrl.frameStack[0].index).to.equal(0);

    // Crossing the boundary fires the first tick (and advances to 1).
    clock.tick(1);
    expect(ctrl.frameStack[0].index).to.equal(1);
    // Handoff: setTimeout cleared, setInterval armed.
    expect(ctrl.autoFirstTickHandle).to.equal(null);
    expect(ctrl.autoIntervalHandle).to.not.equal(null);
  });

  test('raw scanSpeedMs would be too early — no tick before bonus boundary', function () {
    // Direct call to `startAutoTimer` with the bonus delay — mirrors
    // what `handleKeyDown` does on idle → scanning. Keeps the assertion
    // narrowly on the "did the bonus actually extend the first tick"
    // question without routing through the whole key dispatch.
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    // At raw scanSpeedMs we should NOT have ticked (the bonus is 200 ms
    // further out than that boundary).
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(0);
    // At the bonus boundary, the first tick fires.
    clock.tick(200);
    expect(ctrl.frameStack[0].index).to.equal(1);
  });
});

suite('switch-scan: auto-scan timer — steady cadence', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
  });

  teardown(function () {
    clock.restore();
  });

  test('subsequent ticks fire every scanSpeedMs after the first', function () {
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);

    // Advance past the bonus — first tick fires.
    clock.tick(1200);
    expect(ctrl.frameStack[0].index).to.equal(1);

    // Each subsequent 1000 ms advances by one slot (modulo 3 regions).
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(2);
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(0);
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(1);
  });

  test('999 ms after first tick is NOT enough to fire a second (no bonus on steady ticks)', function () {
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    clock.tick(1200); // Fire first tick.
    expect(ctrl.frameStack[0].index).to.equal(1);
    clock.tick(999);
    expect(ctrl.frameStack[0].index).to.equal(1);
    clock.tick(1);
    expect(ctrl.frameStack[0].index).to.equal(2);
  });
});

suite('switch-scan: auto-scan timer — push transition applies bonus', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
    // Register a region wrapper with a scannable item in the DOM so
    // `enterDomRegionSubScan('header', 0)` finds at least one item
    // and pushes a `dom-items` frame rather than falling through to
    // `popToNextRegion`. The item needs a non-zero bounding rect to
    // pass `discoverDomRegionItems`'s visibility filter; jsdom returns
    // zero-size rects by default, so we override the method directly
    // on the element.
    const regionEl = document.createElement('div');
    regionEl.setAttribute('data-scan-region', 'header');
    const itemEl = document.createElement('button');
    itemEl.setAttribute('data-scan-item', '');
    // jsdom's `offsetParent` reads a layout-tree-attached parent; the
    // simplest trick is to override it to a truthy value directly.
    Object.defineProperty(itemEl, 'offsetParent', {
      get: () => regionEl,
    });
    itemEl.getBoundingClientRect = () =>
      new DOMRect(0, 0, 100, 40);
    regionEl.appendChild(itemEl);
    document.body.appendChild(regionEl);
  });

  teardown(function () {
    clock.restore();
    document.querySelectorAll('[data-scan-region]').forEach((el) => el.remove());
  });

  test('entering a sub-scan while scanning restarts timer with bonus-length first tick', function () {
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    // Advance partway into the cycle — 700 ms into the 1200 ms bonus.
    clock.tick(700);
    expect(ctrl.frameStack[0].index).to.equal(0);

    // Push a sub-scan. The default-restart on `renderHighlight` must
    // tear down the pending first-tick setTimeout and schedule a new
    // one at `scanSpeedMs * BONUS` from NOW, not keep the original
    // 500 ms-remaining schedule.
    ctrl.enterDomRegionSubScan('header', 0);
    expect(ctrl.frameStack).to.have.lengthOf(2);
    expect(ctrl.frameStack[1].kind).to.equal('dom-items');

    // Just past raw scanSpeedMs from the push (1000 ms). If the bonus
    // weren't applied, the first tick would have already fired by now.
    clock.tick(1050);
    expect(ctrl.frameStack[1].index).to.equal(0);
    // Crossing the bonus boundary (1200 ms from push) fires the first
    // tick within the dom-items frame.
    clock.tick(150);
    expect(ctrl.frameStack[1].index).to.equal(1);
  });
});

suite('switch-scan: auto-scan timer — setFirstTickBonusFactor live update', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
    // Mirror the push-transition fixture: a scan-region wrapper with one
    // visible item so `enterDomRegionSubScan('header', 0)` pushes a
    // `dom-items` frame rather than falling through to `popToNextRegion`.
    const regionEl = document.createElement('div');
    regionEl.setAttribute('data-scan-region', 'header');
    const itemEl = document.createElement('button');
    itemEl.setAttribute('data-scan-item', '');
    Object.defineProperty(itemEl, 'offsetParent', {
      get: () => regionEl,
    });
    itemEl.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
    regionEl.appendChild(itemEl);
    document.body.appendChild(regionEl);
  });

  teardown(function () {
    clock.restore();
    document.querySelectorAll('[data-scan-region]').forEach((el) => el.remove());
  });

  test('next transition uses the updated factor instead of the default', function () {
    // Drive into scanning state at the default 1.2× factor.
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);

    // Live-tune to 1.5×. The push below should re-arm the first tick
    // at `scanSpeedMs * 1.5` (= 1500 ms), not at `scanSpeedMs * 1.2`
    // (= 1200 ms).
    ctrl.setFirstTickBonusFactor(1.5);

    ctrl.enterDomRegionSubScan('header', 0);
    expect(ctrl.frameStack).to.have.lengthOf(2);
    expect(ctrl.frameStack[1].kind).to.equal('dom-items');

    // Just past the OLD bonus boundary — if the setter hadn't taken
    // effect the first tick would have already fired.
    clock.tick(1250);
    expect(ctrl.frameStack[1].index).to.equal(0);
    // Crossing the NEW bonus boundary (1500 ms from push) fires the
    // first tick within the dom-items frame.
    clock.tick(250);
    expect(ctrl.frameStack[1].index).to.equal(1);
  });
});

suite('switch-scan: auto-scan timer — pop transition applies bonus', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
  });

  teardown(function () {
    clock.restore();
  });

  test('pop({target: parent}) while scanning restarts timer with bonus-length first tick', function () {
    // Seed a sub-scan frame directly so `pop({target: 'parent'})` has
    // something to pop. Skips the enter-DOM-item fixture because the
    // pop path only needs a non-top frame on the stack.
    ctrl.frameStack.push({
      kind: 'dom-items',
      parentRegionName: 'header',
      items: [],
      index: 0,
      topLevelIndex: 0,
    });

    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    // 800 ms into the bonus — close to the original first tick.
    clock.tick(800);

    // Pop back up — `renderHighlight` default-restart re-arms the
    // timer at `scanSpeedMs * BONUS` from NOW.
    ctrl.pop({target: 'parent'});
    expect(ctrl.frameStack).to.have.lengthOf(1);
    expect(ctrl.frameStack[0].kind).to.equal('top');

    // Just past raw scanSpeedMs from the pop (1000 ms). Without the
    // bonus, the restart would have fired by now.
    clock.tick(1050);
    expect(ctrl.frameStack[0].index).to.equal(0);
    // Crossing the bonus boundary (1200 ms from pop) fires the tick.
    clock.tick(150);
    expect(ctrl.frameStack[0].index).to.equal(1);
  });
});

suite('switch-scan: auto-scan timer — advance() does NOT reset', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
  });

  teardown(function () {
    clock.restore();
  });

  test('advance ticks keep the setInterval alive at steady cadence', function () {
    // This is the most important negative test: if someone drops
    // `advance()`'s `renderHighlight({restartTimer: false})` opt-out,
    // every tick would clear the interval and schedule a fresh bonus
    // first-tick, deadlocking the scan at a one-step-then-wait pattern
    // that would be subtle to spot in a live app.
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    clock.tick(1200); // First tick.
    expect(ctrl.frameStack[0].index).to.equal(1);
    expect(ctrl.autoIntervalHandle).to.not.equal(null);
    const intervalHandle = ctrl.autoIntervalHandle;

    // Pump the clock for several steady-cadence ticks.
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(2);
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(0);
    clock.tick(1000);
    expect(ctrl.frameStack[0].index).to.equal(1);

    // The same interval handle must still be alive — no tear-and-re-arm.
    expect(ctrl.autoIntervalHandle).to.equal(intervalHandle);
    expect(ctrl.autoFirstTickHandle).to.equal(null);
  });

  test('direct advance() call does not disturb the pending interval', function () {
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    clock.tick(1200); // First tick → index 1, interval armed.
    const intervalHandle = ctrl.autoIntervalHandle;
    expect(intervalHandle).to.not.equal(null);

    // Direct advance (simulating e.g. a manual bump).
    ctrl.advance();
    expect(ctrl.frameStack[0].index).to.equal(2);
    // The interval handle survives — advance() opted out of the restart.
    expect(ctrl.autoIntervalHandle).to.equal(intervalHandle);
    expect(ctrl.autoFirstTickHandle).to.equal(null);
  });
});

suite('switch-scan: auto-scan timer — setMode live speed change', function () {
  let clock;
  let ctrl;

  setup(function () {
    ensureDom();
    clock = installFakeClock();
    ctrl = makeController(1000);
  });

  teardown(function () {
    clock.restore();
  });

  test('setMode(auto, newSpeed) while scanning restarts WITHOUT bonus', function () {
    ctrl.startAutoTimer(1000 * DEFAULT_FIRST_TICK_BONUS_FACTOR);
    clock.tick(1200); // First tick — now at steady cadence.
    expect(ctrl.frameStack[0].index).to.equal(1);

    // Live speed change — mid-scan user tweaks the setting. The design
    // is "take effect cleanly at the new period", NOT "give the user a
    // 20% breathing-room re-orientation" — they're already oriented.
    ctrl.setMode('auto', 500);
    expect(ctrl.autoFirstTickHandle).to.not.equal(null);
    expect(ctrl.autoIntervalHandle).to.equal(null);

    // At raw 500 ms the first tick fires (no bonus multiplier). If
    // `setMode` had applied the bonus, we'd need 600 ms.
    clock.tick(499);
    expect(ctrl.frameStack[0].index).to.equal(1);
    clock.tick(1);
    expect(ctrl.frameStack[0].index).to.equal(2);
    // From here on, 500 ms steady cadence.
    clock.tick(500);
    expect(ctrl.frameStack[0].index).to.equal(0);
  });
});
