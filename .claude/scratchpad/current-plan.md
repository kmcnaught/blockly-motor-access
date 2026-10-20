# Plan: Reset auto-scan timer on frame transitions + first-tick bonus

## Context

Switch-scan auto mode uses a single `window.setInterval(advance, scanSpeedMs)` armed by `startAutoTimer()` at `test/maze-game/switch-scan-mode.ts:2541`. The interval runs on an absolute schedule from the moment of the user's first "wake" press and is only cleared/re-armed in three places: `clearAutoTimer()` (disable / run start / teardown), `setMode()` (live speed change), and `startAutoTimer()` itself (idle→scanning transition).

Every frame transition — pushes into sub-scans, pops back out, modal close, action commit — mutates `frameStack` and calls `renderHighlight()` but **does not** touch the timer. So after any transition the next tick fires at whatever remains of the current absolute interval: anywhere between ~0 ms and the full `scanSpeedMs`. The user has reported this as "sometimes advances quicker than expected" after popping up a level.

Beyond fixing the timing variance, we also want to add a **first-tick bonus**: the first tick after a transition (and after initial wake) sits for `scanSpeedMs * FIRST_TICK_BONUS_FACTOR` — default `1.2`, i.e. +20%. Rationale: the user is re-orienting at a new frame and benefits from a bit of extra breathing room before the scan starts moving. Only the first tick is lengthened; subsequent ticks run at the normal `scanSpeedMs`.

**Architectural implication**: a pure `setInterval` can't give per-tick variable delays. The timer shape becomes two-phase — a `setTimeout` for the first (possibly-longer) tick, which upon firing starts the steady `setInterval` for subsequent ticks. This is a one-time structural change; the base-fix hook and the first-tick-bonus mechanism share the same `startAutoTimer(firstTickMs?)` entry point.

**Fix direction**: shift `renderHighlight` to default-restart the auto timer with the bonus, and explicitly opt out at the handful of call sites that are mere repaints rather than state transitions. "State transition" is the common case (every enter* and pop), so making it the default minimizes the risk that a future contributor adds a new push site and forgets to re-arm.

**Key files**:
- `test/maze-game/switch-scan-mode.ts` — all timer + render logic lives here
- `test/maze-game/test/` — unit tests (mocha + jsdom pattern already established)

**Call sites inventory** (verified against current `HEAD`):

| Line | Caller | Type | Default behavior |
|------|---------|------|------------------|
| 1396 | `enable()` initial render | state-change | restart (no-op: `autoState==='idle'`) |
| 1507 | `enable()` final render | state-change | restart (no-op: `autoState==='idle'`) |
| 1750 | `enterModalSubScan` push | **state-change** | **restart (BUG FIX)** |
| 2240 | `handleRunEnd` reset | state-change | restart (no-op: `autoState==='idle'`) |
| 2366 | `scheduleReflow` layout | **repaint** | **opt out** |
| 2522 | `advance()` tick | **repaint** | **opt out (critical)** |
| 2553 | `startAutoTimer` initial paint | **repaint** | **opt out (avoid re-arm loop)** |
| 2632 | `enterDomRegionSubScan` push | **state-change** | **restart (BUG FIX)** |
| 2804 | `pop()` end | **state-change** | **restart (BUG FIX)** |
| 2841 | `enterToolboxSubScan` push | **state-change** | **restart (BUG FIX)** |
| 2875 | `enterWorkspaceSubScan` push | **state-change** | **restart (BUG FIX)** |
| 2939 | `enterActionMenu` push | **state-change** | **restart (BUG FIX)** |
| 3025 | `enterDropdownValues` push | **state-change** | **restart (BUG FIX)** |
| 3088 | `enterHeaderDropdownValues` push | **state-change** | **restart (BUG FIX)** |
| 3299 | move settle `changeListener` | **repaint** | **opt out** |
| 3314 | `enterMoveCandidates` push | **state-change** | **restart (BUG FIX)** |

Nine fix-the-bug sites, four explicit opt-outs, four no-op (idle) sites. Explicit opt-outs all pair naturally with the existing `{speak: false}` option already on repaint callers.

**Policy decisions baked into this plan**:
- **Wake path gets the bonus too**: the initial `startAutoTimer()` call from `handleKeyDown`'s idle→scanning transition (line 2479) is the "first tick of the first group" — the user is orienting at wake just as they orient at a pop/push. Consistent application.
- **`setMode` live speed change does NOT get the bonus**: the user is mid-scan, already knows where they are, and expects the new speed to take effect cleanly. Pass `firstTickMs = scanSpeedMs` (no bonus).
- **Constant, not setting**: `FIRST_TICK_BONUS_FACTOR = 1.2` as a module-level `const` for now. If user feedback later motivates a tunable, promote to a settings-panel field in a separate change — not in-scope for this plan.

## Step 1: Two-phase timer shape (`setTimeout` → `setInterval`)

**Goal**: Rework `startAutoTimer()` to accept an optional `firstTickMs?: number` argument. The method schedules a `setTimeout` for `firstTickMs` (defaulting to `scanSpeedMs` when omitted), which upon firing calls `advance()` and arms the steady `setInterval(advance, scanSpeedMs)`. `clearAutoTimer()` tears down both the pending `setTimeout` (if first tick hasn't fired yet) and the active `setInterval` (if it has).

**Why first**: the architectural change is foundational — everything in later steps (transition hook, bonus, tests) depends on `startAutoTimer` being parameterizable. Isolating it to its own step gives a clean review surface: "did we correctly replace one handle with two, and did the behavior match before any new callers?"

**Implementation sketch**:
```ts
private autoFirstTickHandle: number | null = null;
private autoIntervalHandle: number | null = null;

private startAutoTimer(firstTickMs?: number): void {
  this.clearAutoTimer();
  this.autoState = 'scanning';
  const first = firstTickMs ?? this.scanSpeedMs;
  this.autoFirstTickHandle = window.setTimeout(() => {
    this.autoFirstTickHandle = null;
    this.advance();
    this.autoIntervalHandle = window.setInterval(
      () => this.advance(),
      this.scanSpeedMs,
    );
  }, first);
  this.renderHighlight({speak: false});
}

private clearAutoTimer(): void {
  if (this.autoFirstTickHandle !== null) {
    window.clearTimeout(this.autoFirstTickHandle);
    this.autoFirstTickHandle = null;
  }
  if (this.autoIntervalHandle !== null) {
    window.clearInterval(this.autoIntervalHandle);
    this.autoIntervalHandle = null;
  }
}
```

Rename the existing `autoTimerHandle` field across the file (currently referenced at lines 1202, 2544, 2565-2567) — split into the two handles above.

**Behavior parity check**: with the default `firstTickMs === scanSpeedMs`, this is observationally identical to the current `setInterval`-only path. The first tick fires at `scanSpeedMs`, subsequent ticks fire every `scanSpeedMs`. No visible change yet.

**Files**:
- `test/maze-game/switch-scan-mode.ts` — field rename, `startAutoTimer` + `clearAutoTimer` rework.

**Verify**:
- `npm run build` passes.
- Launch maze game with auto mode; confirm wake-and-cycle still works exactly as before (same cadence, same tick count over a given window).
- Toggle switch-scan off → confirm both handles cleared (no setTimeout leaks: can test by checking `autoFirstTickHandle === null && autoIntervalHandle === null` in devtools after disable).

## Step 2: Thread `restartTimer` through `renderHighlight`

**Goal**: Add `restartTimer?: boolean` to the `options` type on `renderHighlight` (default `true`), and have `renderHighlight` call a new private `restartAutoTimerIfScanning()` helper at the end when the option is truthy. The helper is a one-liner: if `autoState === 'scanning'`, call `startAutoTimer(this.scanSpeedMs * FIRST_TICK_BONUS_FACTOR)`.

**Why do it as a `renderHighlight` option rather than inline at each push site**: the goal is to make "restart on transition" the *default* so the next contributor who adds an `enter*` method inherits correct behavior without needing to remember. Repaint callers are a smaller, enumerable set and already pass explicit options (`{speak: false}`); adding `restartTimer: false` next to them is a natural pairing.

**Add module-level constant**:
```ts
/** Multiplier applied to the first auto-scan tick after a frame
 * transition (push or pop) and on initial wake. Gives the user a
 * brief re-orientation window before the scan starts moving at the
 * configured steady cadence. */
const FIRST_TICK_BONUS_FACTOR = 1.2;
```

**Also update the wake path**: `handleKeyDown` at line 2479 currently calls `this.startAutoTimer()` with no argument. Change to `this.startAutoTimer(this.scanSpeedMs * FIRST_TICK_BONUS_FACTOR)` so wake gets the same first-tick bonus as transitions.

**Leave `setMode` alone**: the live-speed-change call at line 1623 keeps calling `startAutoTimer()` with no argument → defaults to `scanSpeedMs` → no bonus. User is mid-scan, speed-change is not a re-orientation moment.

**Files**:
- `test/maze-game/switch-scan-mode.ts` — expand the `options` parameter on `renderHighlight` (line 2003); add `restartAutoTimerIfScanning` private method near `startAutoTimer`/`clearAutoTimer` (around line 2560); add `FIRST_TICK_BONUS_FACTOR` constant near the top of the module; update `handleKeyDown` wake call at line 2479.

**Verify**:
- `npm run build` passes with no TS errors.
- **IMPORTANT: step 2 is not safe to merge standalone** — restarting from `advance()` would prevent any auto-tick from ever firing because every tick calls `renderHighlight()` which would re-arm the two-phase timer. Steps 2 and 3 must land together.

## Step 3: Opt out at repaint-only call sites

**Goal**: Add `restartTimer: false` to the four repaint sites so the default-restart behavior applies cleanly:
- `advance()` tick at line 2522 (**critical** — without this the timer never fires)
- `startAutoTimer()` initial paint at line 2553 (avoids immediate re-arm)
- `scheduleReflow()` at line 2366 (resize/scroll should not reset scan timing)
- Move-candidates settle `changeListener` at line 3299 (fires repeatedly during move; must not reset)

**Why these four specifically**: these are the only `renderHighlight` callers where the frame stack has *not* just changed — they are either per-tick repaints or layout-settle repaints. Every other caller is a state change where restart is the fix.

**Files**:
- `test/maze-game/switch-scan-mode.ts` — four one-line edits as per table above.

**Verify**:
- `npm run build` passes.
- Auto-scan still cycles correctly on default speed (confirms `advance()` opt-out works).
- Resizing the window during an active scan does not jump the scan timing (confirms `scheduleReflow` opt-out).
- Entering move mode and watching the Blockly post-detach settle does not accelerate the scan (confirms `changeListener` opt-out).

## Step 4: Comment hygiene

**Goal**: Update the comment blocks that currently describe the pre-fix behavior now that the semantics have shifted:
- `startAutoTimer()` docstring at line 2524 — explain the two-phase shape (setTimeout first tick → setInterval steady cadence), the optional `firstTickMs` arg, and that frame transitions re-arm with the bonus.
- `clearAutoTimer()` docstring at line 2556 — note it tears down both handles.
- `advance()` docstring at line 2506 — note it calls `renderHighlight({restartTimer: false})` and explain why (would prevent any tick from firing).
- `renderHighlight()` docstring at line 2003 — document the `restartTimer` option and the "state-change vs repaint" default policy.
- `FIRST_TICK_BONUS_FACTOR` — short docstring on the constant explaining what it is and why (as sketched in step 2).

Per global CLAUDE.md: describe code as it *is*, not the history of the change — no "previously", "now", "this used to", or reference to this fix.

**Files**:
- `test/maze-game/switch-scan-mode.ts` — comment-only edits.

**Verify**:
- `git diff` on this step shows only comment lines changed.
- Each comment reads as if it were always the current code; no breadcrumb language.

## Step 5: Unit test — timer restarts + first-tick bonus

**Goal**: Add a mocha test (jsdom-based, matching the existing `switch_scan_strategies_test.mocha.js` pattern) that uses `sinon`'s fake timers to assert:
1. **Baseline**: after the user wakes the scanner, the first tick fires at `scanSpeedMs * FIRST_TICK_BONUS_FACTOR` (not just `scanSpeedMs`) — confirms the wake-bonus policy.
2. **Steady cadence after first tick**: subsequent ticks fire every `scanSpeedMs`, no bonus — confirms the setTimeout → setInterval handoff.
3. **Transition push**: after a programmatic `enter*SubScan` call at some arbitrary time offset into the cycle, the next tick fires at `scanSpeedMs * FIRST_TICK_BONUS_FACTOR` from the push moment (not from the original schedule, not at the raw `scanSpeedMs`).
4. **Transition pop**: after a `pop({target: 'parent'})` at some arbitrary offset, same bonus-delayed first tick from the pop.
5. **`advance()` does not reset**: calling `advance()` directly (the tick's own callback) does NOT reset the timer — the next tick still fires at the originally-scheduled interval boundary.
6. **`setMode` live-change does not get the bonus**: calling `setMode('auto', newSpeed)` while scanning re-arms with first tick at `newSpeed` (no multiplier).

**Why**: this is the kind of regression that silently reappears if someone later refactors the enter* methods and threads a different render option, or hardcodes a wrong first-tick-delay source. Compile-time safety isn't achievable here; a focused timer test is the pragmatic guard. The existing `mover_switch_scan.mocha.js` test file already demonstrates driving the controller directly under jsdom.

**Test harness note**: constructing a `SwitchScanController` from scratch requires a workspace + mover + maze-game stub. If the setup proves heavier than ~30 lines of fixture, prefer a narrower test that exercises `renderHighlight`'s `restartTimer` option against a controller stubbed enough to have `autoState`, `scanSpeedMs`, `autoFirstTickHandle`, and `autoIntervalHandle` — the actual timer behavior is what's under test, not the surrounding frame logic.

**Files**:
- `test/switch_scan_autoscan_timer_test.mocha.js` (new file, following existing mocha naming) — or extend `switch_scan_strategies_test.mocha.js` if the setup overlap is high enough.
- May need to add `sinon` to devDependencies if not already present — check first (`grep sinon package.json`).

**Verify**:
- `npm test` (or project equivalent) passes.
- Deliberately revert the opt-out on `advance()` → test 5 fails (timer never actually ticks).
- Deliberately set `FIRST_TICK_BONUS_FACTOR = 1.0` → tests 1, 3, 4 fail; test 2 still passes. Revert.
- Deliberately remove the bonus from the wake path at line 2479 → test 1 fails; tests 3, 4 still pass (restart hook is independent). Revert.

## Step 6: Manual browser verification in auto mode

**Goal**: Confirm the fix feels right under live auto-scan use — not just that timers reset, but that the perceived cadence is now even across transitions AND that the first-tick bonus feels like a helpful breathing room rather than a stutter.

**Why**: this is the user-reported symptom. Automated tests confirm the mechanical behavior; the user complained about perceived timing, so the verification needs to match their original experience. The bonus is a UX tuning; its effect is only visible in a real browser.

**Steps**:
- Launch maze game (`npm run start:maze`) and open in a browser on a port from `ports.txt`.
- Open switch-scan settings → set mode to auto, set a slow enough speed to see the effect clearly (e.g. 1500 ms, giving a 300 ms bonus → 1800 ms first-of-group). Save.
- Press Switch A to wake the scanner. The first top-level highlight should sit for ~1800 ms, then subsequent top-level highlights for ~1500 ms each. Confirm this is perceptible but not jarring.
- Let the top-level cycle run for a few iterations — confirm the steady cadence is a consistent ~1500 ms.
- At the moment just *before* the next scheduled tick, press Switch A to select workspace. Confirm the first workspace-block highlight sits for ~1800 ms (bonus), subsequent blocks for ~1500 ms.
- Open an action menu on a block. On the "Back to top" sentinel, press Switch A. Confirm the top-level resumption highlight sits for ~1800 ms.
- If a Back switch is configured, press Back from a sub-scan at various cycle offsets. Confirm every resumption gets the bonus first-tick.
- Open the settings modal from the scan (modal sub-scan push + close). Confirm pre-modal and post-modal first-tick cadence is the bonus length.
- Trigger a Move → candidate scan. Confirm the move-candidates cycle: first candidate sits for ~1800 ms, subsequent for ~1500 ms. Regression check for the `changeListener` opt-out (the layout settle must NOT reset the timer; without the opt-out it would re-arm the bonus every settle event, chaining to effectively "never advance").
- Open settings while scanning and change speed. Confirm the new speed takes effect immediately and the next tick is `newSpeed` (NOT `newSpeed * 1.2`) — this is the `setMode` policy.

**Verify**:
- Record outcome in `.claude/scratchpad/step-6-status.txt`. Call out:
  - Whether cadence feels even across transitions.
  - Whether the bonus feels right at 20%, too subtle, or too long. If it feels wrong, note the suggested factor to try next (0.15, 0.25, 0.3). This may motivate a follow-up to make `FIRST_TICK_BONUS_FACTOR` a user setting.

## Risk notes

- **Step 2+3 coupling**: Step 2 alone would prevent any auto tick from firing. Keep the two steps bundled in review; if landing them separately for commit hygiene, do it as a single PR / contiguous commit sequence that is never merged partway.
- **Two-handle teardown**: the new `clearAutoTimer` tears down two handles. Any new code path that creates a timer must set the right handle (first-tick setTimeout vs steady setInterval), not reuse the old `autoTimerHandle` name. Grep for `autoTimerHandle` and ensure no stragglers.
- **Settings modal captures**: the capture-mode short-circuit at `handleKeyDown` line 2415 doesn't call `renderHighlight`, so there's no accidental timer restart during a key-capture-in-progress. Verified.
- **Move abort during unplug `changeListener`**: the opt-out on line 3299 is correct — resetting the timer every settle step during an active move would push the first candidate's visibility to full bonus-length AFTER every settle event, chaining into effectively "never advance." Current fix preserves the existing settle behavior cleanly.
- **TTS speak timing**: the pinned-outline work doesn't interact with this (it uses `pinnedEl` with no transitions). TTS still fires via `renderHighlight`'s existing `speak` option; this plan does not change that path.
- **Tab backgrounding**: `setTimeout`/`setInterval` in background tabs are throttled by the browser (min 1 s intervals typically). This affects both the base-fix behavior and the bonus but is pre-existing — the scan has always been subject to tab throttling. Not in-scope.
- **Bonus policy may need tuning**: 20% is a guess informed by typical switch-user re-orientation needs but hasn't been user-tested. Step 6 verification explicitly asks whether the number feels right; a follow-up may tune it or promote to a setting.
