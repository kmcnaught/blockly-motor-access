/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Controller for Maze game (Phase 1 complete).
 *
 * Drives a two-switch step-scanning input mode for users with severe
 * motor impairments who access the page via two physical switches (or
 * two assigned keys, e.g. via Grid 3 sending keyboard events). One key
 * advances a visible highlight across scannable regions/items; the
 * other selects the currently highlighted target.
 *
 * Activation + key bindings come from URL params (read in `index.ts`,
 * forwarded to the constructor via {@link SwitchScanOptions}):
 *  - `inputMode=switch-scan` — activate the controller. When unset,
 *    the controller is NEVER instantiated and binds NO listeners — the
 *    default-mode page behaves exactly as before.
 *  - `switchAdvance` — advance key, as either a `KeyboardEvent.key`
 *    value (`' '`) or the alias `'Space'`. Default `' '` (Space).
 *  - `switchSelect` — select key, as a `KeyboardEvent.key` value.
 *    Default `'Enter'`.
 *
 * Mutual exclusion: this controller is mutually exclusive with grid
 * coding mode (`?grid=1`). `index.ts` will not instantiate
 * `GridCodingModeController` when `inputMode=switch-scan` is set —
 * only one input-augmentation controller runs at a time.
 *
 * Full design / phased plan: see `PLAN_switch_scanning.md` at the
 * repository root and `.claude/scratchpad/current-plan.md`.
 *
 * Behavior summary (Phase 1, completed): top-level scan loop across
 * four regions (header / toolbox / workspace / maze-actions) plus a
 * "back to top" sentinel; generic DOM-item sub-scan for header /
 * maze-actions; a Blockly-block sub-scan for the toolbox flyout
 * (selecting inserts a new instance via the shared
 * {@link insertBlockAfterCursor} helper); a Blockly-block sub-scan
 * for the workspace itself in tree order; and — when the user selects
 * a workspace block — an inline ACTION MENU (Select / Edit / Delete)
 * anchored next to the block. Edit opens a nested dropdown-values
 * sub-scan over the FIRST editable `Blockly.FieldDropdown` on the
 * block (v1 limitation — multi-dropdown blocks would need a
 * field-picker step, deferred). All three actions pop straight back
 * to the top-level frame for consistency: even Select/Edit, where the
 * underlying workspace frame is still valid, pops to top so the
 * cursor-commit / value-change reads as a clean transition rather
 * than dropping the user back into the middle of a workspace scan.
 * Scanning is paused while the maze program runs (highlight, sentinel,
 * and any open menus are torn down; key input short-circuits) and
 * resumes on a clean top-level frame (header, index 0) when the run
 * finishes via any path — success, failure, timeout, error, or reset
 * interrupt — all of which surface through a single
 * `MazeGame.onExecutionStateChange` subscription.
 *
 * Out of scope for Phase 1 (deferred to later phases — see the design
 * doc for the planned rollout):
 *  - No in-page settings UI: keys are URL params only.
 *  - No Move action in the block action menu (Select / Edit / Delete
 *    only).
 *  - No header dropdown sub-scans (level picker etc. — the existing
 *    pegman dropdown is reachable via the header sub-scan but its
 *    sub-menu items aren't yet scannable as a nested region).
 *  - No single-switch auto-scan mode — two-switch step scan only.
 *
 * Phase 5 (TTS) is live: when wired via {@link SwitchScanController#setTts},
 * each advance / sub-scan-entry speaks the current item's label via
 * the Web Speech API. The TTS helper owns the enabled flag (off by
 * default; toggled via the settings modal or the `?scanAudio=on` URL
 * param) and the cancel-and-replace contract; this controller just
 * derives the label and forwards it on every interactive render.
 */

import * as Blockly from 'blockly/core';
import {MazeGame} from './maze';
import {insertBlockAfterCursor} from './block-insertion';

/**
 * Minimal contract the controller needs from the settings panel. Kept
 * as a structural type (rather than importing `SwitchScanSettings`
 * directly) so the two modules don't get a hard cyclic dependency —
 * the controller doesn't care about the rest of the settings API, only
 * whether a live key-capture is currently in flight (Step D).
 */
interface SwitchScanSettingsLike {
  isCapturing(): boolean;
}

/**
 * Minimal contract the controller needs from the TTS helper (Phase 5).
 * Kept as a structural type so the controller doesn't pull in
 * `SpeechSynthesisUtterance` types or care about the feature-detect
 * branch — it just speaks / cancels and lets the helper figure out
 * whether to actually emit sound.
 */
interface SwitchScanTtsLike {
  speak(label: string): void;
  cancel(): void;
  isEnabled(): boolean;
}

/**
 * Options for configuring the switch scan controller.
 * Keys use `KeyboardEvent.key` string values (e.g. `' '` for Space,
 * `'Enter'` for Enter). Human-readable aliases like `'Space'` are also
 * accepted (see {@link normalizeKey}).
 *
 * Phase 4: `scanMode` toggles between two-switch step scan (the default)
 * and single-switch auto scan. In auto mode only the advance key is
 * consulted — the first press starts a self-paced timer that advances
 * the highlight every `scanSpeedMs` milliseconds; subsequent presses
 * select the currently highlighted item. The select key is ignored
 * entirely under `scanMode === 'auto'` (Switch B is hidden in the
 * settings panel and unused in this flow).
 */
export interface SwitchScanOptions {
  switchAdvance?: string;
  switchSelect?: string;
  scanMode?: 'step' | 'auto';
  scanSpeedMs?: number;
}

/**
 * Map of human-readable key names (as a user would type in a URL param)
 * to their `KeyboardEvent.key` equivalents. The browser reports the
 * spacebar as `' '`, not `'Space'`, so we accept both spellings.
 */
const KEY_ALIASES: Record<string, string> = {
  'Space': ' ',
  'space': ' ',
  'SPACE': ' ',
};

/**
 * Normalize a configured key string to its `KeyboardEvent.key` form so
 * `event.key === normalized` works regardless of whether the user wrote
 * `?switchAdvance=Space` or `?switchAdvance=+` in the URL.
 *
 * @param key
 */
function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

/**
 * A discoverable top-level scan region. `getRect` is a thunk because
 * Blockly's flyout / workspace DOM may not be measurable at the moment
 * `enable()` runs (e.g. before first layout) — deferring keeps things
 * robust to lazy sizing and to later resizes.
 */
interface ScanRegion {
  name: string;
  getRect: () => DOMRect | null;
}

/**
 * One frame in the scan stack. The active (top) frame owns the cursor
 * and dictates what the highlight is positioned over.
 *
 *  - `top`: cycles {@link SwitchScanController.regions} plus a sentinel
 *    slot at index === regions.length.
 *  - `dom-items`: cycles a concrete list of DOM elements (e.g. the
 *    buttons inside the header region) plus a sentinel at
 *    index === items.length. `topLevelIndex` is the index of the
 *    top-level region the user entered THIS sub-scan from — pop helpers
 *    derive the resume index from it (same region for sentinel pops, the
 *    NEXT region for action-completed pops). See {@link popToSameRegion}
 *    and {@link popToNextRegion}.
 *  - `parentRegionName` is informational only (used for logging /
 *    future diagnostics) — frame routing is purely positional.
 */
type ScanFrame =
  | {kind: 'top'; index: number}
  | {
      kind: 'dom-items';
      parentRegionName: string;
      items: HTMLElement[];
      index: number;
      topLevelIndex: number;
    }
  | {
      kind: 'blocks';
      regionName: 'toolbox' | 'workspace';
      blocks: Blockly.BlockSvg[];
      index: number;
      topLevelIndex: number;
    }
  | {
      kind: 'action-menu';
      block: Blockly.BlockSvg;
      items: ActionItem[];
      index: number;
      topLevelIndex: number;
    }
  | {
      kind: 'dropdown-values';
      block: Blockly.BlockSvg;
      field: Blockly.FieldDropdown;
      options: Array<
        [string | {src: string; width: number; height: number; alt: string}, string]
      >;
      index: number;
      topLevelIndex: number;
    }
  | {
      // Phase 3 Step 1: switch-scan during Blockly's move mode. The
      // visible CANDIDATE highlight is owned by Blockly (its
      // connection-preview indicator) — we deliberately don't draw
      // our switch-scan outline on top of it. We render a small
      // inline menu next to the moving block with two explicit
      // actions ("Next", "Place") plus the standard "Back to top"
      // sentinel which aborts the move. Select on "Next" steps Blockly
      // forward one candidate (via `move_down_constrained` shortcut);
      // select on "Place" commits (via `finish_move`); select on
      // sentinel aborts (via `abort_move`).
      //
      // `block` is the block we asked Blockly to start moving so a
      // stuck move can be cleaned up via {@link cancelActiveMoveIfAny}
      // during pause-during-run.
      kind: 'move-candidates';
      block: Blockly.BlockSvg;
      items: MoveCandidatesItem[];
      index: number;
      topLevelIndex: number;
    };

/**
 * One row in the inline action menu shown when the user selects a
 * workspace block. `key` drives behavior in {@link handleSelect}; the
 * human-readable `label` is what we render in the overlay.
 */
interface ActionItem {
  key: 'select' | 'edit' | 'move' | 'delete';
  label: string;
}

/**
 * One row in the inline overlay shown during a move-candidates
 * sub-scan. `key === 'next'` steps Blockly to the next candidate
 * connection (without committing); `key === 'place'` commits the move
 * at the currently-previewed candidate. Aborting is handled via the
 * standard sentinel slot, NOT a third explicit row, so the user only
 * ever sees these two real actions plus the familiar "back to top"
 * chip.
 */
interface MoveCandidatesItem {
  key: 'next' | 'place';
  label: string;
}

/**
 * Controller for two-switch step-scanning input mode.
 * See file-level docstring for design notes.
 */
export class SwitchScanController {
  private workspace: Blockly.WorkspaceSvg;
  private mazeGame: MazeGame;
  private enabled = false;
  // True while the maze is running a user program. Set by the
  // execution-state subscription; gates key input and overlay rendering
  // so the highlight isn't competing with the maze animation for the
  // user's attention. Independent from `enabled` — a disabled
  // controller doesn't care about run state, but an enabled controller
  // that's `executing` ignores advance/select keys and shows no
  // overlays until the run ends.
  private executing = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;
  private boundReflow: () => void;
  // Subscription registered with mazeGame.onExecutionStateChange.
  // Stored so disable() can null its inner reference (the maze callback
  // list itself is owned by MazeGame and we don't have an unsubscribe
  // API; the no-op closure pattern is the cheapest safe equivalent).
  private boundExecutionStateHandler: (isExecuting: boolean) => void;
  // Set to true once we've registered the execution-state subscription
  // so re-enable doesn't double-register on the maze's callback list.
  private executionStateSubscribed = false;

  // Key bindings (KeyboardEvent.key values). Defaults: Space / Enter.
  private switchAdvance = ' ';
  private switchSelect = 'Enter';

  // Phase 4 — single-switch auto-scan state.
  //
  // `scanMode === 'step'` is the original two-switch flow: advance key
  // bumps the highlight, select key acts on the current item. Behavior
  // is byte-identical to pre-Phase-4 for step-mode users.
  //
  // `scanMode === 'auto'` is the single-switch flow described in
  // PLAN_switch_scanning.md §"Auto-Scan Behavior (one-switch mode)":
  //  - on enable() the scanner is idle (no timer running);
  //  - the first advance press transitions to `'scanning'` and starts
  //    the auto-advance timer;
  //  - subsequent advance presses act as select against the currently
  //    highlighted item (same `handleSelect` dispatch step mode uses);
  //  - a run-start clears the timer and returns to `'idle'`;
  //  - a run-end leaves us in `'idle'` (per the design doc, the user
  //    presses their switch to restart scanning after Reset).
  //
  // The select key is ignored in auto mode — Switch B is hidden in
  // the settings panel and has no role in the one-switch flow.
  private scanMode: 'step' | 'auto' = 'step';
  private scanSpeedMs = 1500;
  private autoState: 'idle' | 'scanning' = 'idle';
  // Window.setInterval returns `number` in browsers; node typings
  // disagree (NodeJS.Timeout). We're DOM-only, so `number | null`.
  private autoTimerHandle: number | null = null;

  // Settings panel reference (Step D). Optional: only wired up when
  // switch-scan mode is active AND the settings module is constructed.
  // Used purely to consult `isCapturing()` so the controller can stand
  // down while the modal's live key-capture is reading the next press.
  private settings: SwitchScanSettingsLike | null = null;

  // TTS helper (Phase 5). Optional: when null, the controller never
  // emits speak calls. When set, every renderHighlight() will derive
  // a label for the current item and ask the helper to speak it; the
  // helper itself decides whether to emit based on its enabled flag.
  // Cancel-and-replace is owned by the helper, so the controller
  // doesn't need to worry about queueing.
  private tts: SwitchScanTtsLike | null = null;

  // Top-level regions, discovered on enable(). Index === regions.length
  // represents the synthetic "back to top" sentinel.
  private regions: ScanRegion[] = [];

  // Stack of active scan frames. The last entry is the active frame.
  // Always non-empty while enabled (seeded with a `top` frame in
  // `enable()` and reset on `disable()`).
  private frameStack: ScanFrame[] = [];

  // DOM overlay elements; created once per enable, removed on disable.
  private highlightEl: HTMLDivElement | null = null;
  private sentinelChip: HTMLDivElement | null = null;

  // Inline action / dropdown menus shown next to a workspace block when
  // the user enters the action sub-scan. Lazily created on first use and
  // removed when the corresponding frame is popped.
  private actionMenuEl: HTMLDivElement | null = null;
  private dropdownMenuEl: HTMLDivElement | null = null;
  // Phase 3 Step 1: inline "Next / Place" menu shown while Blockly's
  // move mode is active. Anchored next to the moving block; tracked
  // here so we can tear it down when the move-candidates frame is
  // popped or during pause-during-run.
  private moveMenuEl: HTMLDivElement | null = null;

  // rAF handle for throttled reflow on resize/scroll, so we don't
  // re-render on every wheel tick.
  private reflowRafHandle: number | null = null;

  constructor(
    workspace: Blockly.WorkspaceSvg,
    mazeGame: MazeGame,
    options: SwitchScanOptions = {},
  ) {
    this.workspace = workspace;
    this.mazeGame = mazeGame;

    if (options.switchAdvance !== undefined) {
      this.switchAdvance = normalizeKey(options.switchAdvance);
    }
    if (options.switchSelect !== undefined) {
      this.switchSelect = normalizeKey(options.switchSelect);
    }
    if (options.scanMode !== undefined) {
      this.scanMode = options.scanMode;
    }
    if (options.scanSpeedMs !== undefined) {
      this.scanSpeedMs = options.scanSpeedMs;
    }

    // Bind handlers so add/removeEventListener get matching references.
    // setKeyBindings() relies on this being a stable reference so it can
    // detach the listener and re-attach it cleanly during live rebind.
    this.boundKeyHandler = this.handleKeyDown.bind(this);
    this.boundReflow = this.scheduleReflow.bind(this);
    // Wrap with an `enabled` guard so a late-firing callback after a
    // disable() (e.g. user toggled modes mid-run) is a no-op rather
    // than a crash on torn-down state.
    this.boundExecutionStateHandler = (isExecuting: boolean) => {
      if (!this.enabled) return;
      if (isExecuting) {
        this.handleRunStart();
      } else {
        this.handleRunEnd();
      }
    };
  }

  /**
   * Enable switch scan mode.
   *
   * Phase 4: in auto mode the scanner enters in `autoState === 'idle'`
   * — no timer is started. The highlight is rendered at the initial
   * frame so the user sees WHERE they'll be when scanning begins, but
   * nothing cycles until the user's first switch press transitions to
   * `'scanning'`. This matches the design doc: "App load: scanner is
   * idle."
   */
  enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Discover regions and create overlay DOM.
    this.regions = this.discoverRegions();
    // Seed the stack with a fresh top-level frame at index 0.
    this.frameStack = [{kind: 'top', index: 0}];
    this.createOverlayElements();

    // Bind keyboard + viewport-change events.
    // Capture-phase keydown so we run BEFORE Blockly's container-level
    // shortcut handler. Required during Phase 3 Move mode: if the
    // user's Advance switch happens to be Space or Enter, those keys
    // are ALSO bound to Blockly's `finish_move` / `enter` shortcuts.
    // Without capture-phase intercept, pressing Advance during a move
    // would prematurely commit it via Blockly's handler before our
    // own `move_down_constrained` step ever fired. We only stop
    // propagation while a move-candidates frame is on top — every
    // other frame leaves the event to flow normally, preserving
    // pre-existing behavior for the action-menu / dropdown-values /
    // toolbox / workspace sub-scans.
    document.addEventListener('keydown', this.boundKeyHandler, true);
    window.addEventListener('resize', this.boundReflow);
    window.addEventListener('scroll', this.boundReflow, true);

    // Subscribe to maze execution state ONCE — MazeGame stores
    // callbacks in a list with no unsubscribe API, so re-enabling
    // would otherwise duplicate our handler. The `enabled` guard in
    // boundExecutionStateHandler makes re-subscription unnecessary
    // anyway: a no-op fires when disabled, and the handler fires
    // correctly again on next enable.
    if (!this.executionStateSubscribed) {
      this.mazeGame.onExecutionStateChange(this.boundExecutionStateHandler);
      this.executionStateSubscribed = true;
    }

    // If a run is somehow already in flight at enable() time (rare —
    // user toggled into switch-scan during a running program), reflect
    // that state immediately so we don't render a highlight on top of
    // the animation.
    if (this.mazeGame.isExecuting()) {
      this.executing = true;
      this.tearDownOverlaysForRun();
    } else {
      // Initial render so the user sees the highlight immediately.
      // Phase 5: don't speak here — there's been no user gesture yet,
      // so the browser would either silently swallow the utterance or
      // (worse) start talking the moment the page loads. The first
      // real speak happens on the user's first advance/select press.
      this.renderHighlight({speak: false});
    }
  }

  /**
   * Disable switch scan mode.
   */
  disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Unbind events.
    // Capture-phase flag must match `enable()` so removal cleans up
    // the right listener slot.
    document.removeEventListener('keydown', this.boundKeyHandler, true);
    window.removeEventListener('resize', this.boundReflow);
    window.removeEventListener('scroll', this.boundReflow, true);

    // Cancel any pending reflow frame.
    if (this.reflowRafHandle !== null) {
      cancelAnimationFrame(this.reflowRafHandle);
      this.reflowRafHandle = null;
    }

    // Phase 4: clear any auto-scan timer so a `disable()` mid-scanning
    // doesn't leave the interval firing into a torn-down controller.
    // Reset autoState so a subsequent enable() starts idle again
    // (matches `enable()`'s contract — fresh idle scanner per session).
    this.clearAutoTimer();
    this.autoState = 'idle';

    // Phase 5: silence any in-progress utterance so a disable doesn't
    // leave the voice talking over a now-hidden highlight.
    this.tts?.cancel();

    // Tear down overlay DOM.
    // If a Blockly move is in flight (move-candidates frame on the
    // stack) abort it BEFORE removing our overlay so Blockly's own
    // teardown can clean up its highlight layer, connection-preview
    // node, and click-stick listeners.
    this.cancelActiveMoveIfAny();
    this.highlightEl?.remove();
    this.sentinelChip?.remove();
    this.actionMenuEl?.remove();
    this.dropdownMenuEl?.remove();
    this.moveMenuEl?.remove();
    this.highlightEl = null;
    this.sentinelChip = null;
    this.actionMenuEl = null;
    this.dropdownMenuEl = null;
    this.moveMenuEl = null;

    this.regions = [];
    this.frameStack = [];
    // Clear executing — if we re-enable later we'll resync from
    // mazeGame.isExecuting() in enable(). NB: we deliberately don't
    // attempt to unsubscribe the execution-state callback (MazeGame
    // has no removal API); boundExecutionStateHandler's `enabled`
    // guard makes any late-firing callback a safe no-op.
    this.executing = false;
  }

  /**
   * Check if switch scan mode is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the MazeGame reference (called when level changes).
   *
   * @param mazeGame
   */
  setMazeGame(mazeGame: MazeGame): void {
    this.mazeGame = mazeGame;
  }

  /**
   * Update the advance / select key bindings.
   * Keys use `KeyboardEvent.key` string values; aliases like `'Space'`
   * are normalized.
   *
   * @param switchAdvance
   * @param switchSelect
   */
  setKeys(switchAdvance: string, switchSelect: string): void {
    this.setKeyBindings(switchAdvance, switchSelect);
  }

  /**
   * Live re-bind the advance / select keys without tearing down scan
   * state. Used by the settings panel's Save handler so the user sees
   * their new bindings take effect immediately, no reload required.
   *
   * Even though `handleKeyDown` reads `this.switchAdvance` /
   * `this.switchSelect` at event time (so mutating the fields would be
   * enough), we explicitly detach + re-attach the listener here. That
   * keeps the contract obvious to future readers ("re-bind" really
   * means re-bind) and gives us a clean hook if we ever want to swap
   * the handler shape (e.g. capture-phase vs bubble).
   *
   * Scan state — the frame stack, cursor index, highlight overlay —
   * is left untouched so the user resumes exactly where they were.
   *
   * Accepts either a raw `KeyboardEvent.key` value (`' '`) or the
   * friendly alias `'Space'`; the same `normalizeKey` helper used at
   * construction time handles both.
   *
   * @param switchAdvance New advance key (raw or alias).
   * @param switchSelect New select key (raw or alias).
   */
  setKeyBindings(switchAdvance: string, switchSelect: string): void {
    this.switchAdvance = normalizeKey(switchAdvance);
    this.switchSelect = normalizeKey(switchSelect);

    // Re-attach the keydown listener so the rebind is explicit even
    // though the handler reads `this.switchAdvance` / `this.switchSelect`
    // dynamically. Only do this when we're actually listening — a
    // disabled controller has no listener to swap.
    if (this.enabled) {
      // Capture flag must match `enable()` — see the docstring there
      // for why we're at capture phase.
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      document.addEventListener('keydown', this.boundKeyHandler, true);
    }
  }

  /**
   * Phase 4 — update the scan mode (and optionally the auto-scan
   * speed) without tearing down scan state.
   *
   * Called by the settings panel's Save handler so a mode toggle takes
   * effect mid-session without requiring a reload. Scan position —
   * frame stack, cursor index, highlight overlay — is left untouched
   * so the user resumes exactly where they were; ONLY the timer +
   * autoState are reset.
   *
   * Transition rules:
   *  - any → step: clear the auto timer (it might be running) and
   *    reset `autoState` to idle. Switch B is now active again.
   *  - any → auto: clear the timer and drop to idle. We deliberately
   *    do NOT auto-start the timer here — the design contract is "the
   *    user's first press wakes the scanner up", and starting it from
   *    a settings-Save would surprise the user mid-modal-close.
   *  - same mode, new scanSpeedMs: if the timer is currently running,
   *    restart it with the new period so the change takes effect
   *    immediately. If idle, the new value will be picked up on the
   *    user's next start.
   *
   * @param mode The new scan mode.
   * @param scanSpeedMs Optional new auto-scan period in milliseconds.
   *     When omitted, the existing `scanSpeedMs` is preserved.
   */
  setMode(mode: 'step' | 'auto', scanSpeedMs?: number): void {
    const wasScanning =
      this.scanMode === 'auto' && this.autoState === 'scanning';
    const prevMode = this.scanMode;

    this.scanMode = mode;
    if (scanSpeedMs !== undefined) {
      this.scanSpeedMs = scanSpeedMs;
    }

    // Always clear the existing timer — both mode transitions and
    // mid-session speed changes need a clean restart. We re-arm below
    // only in the "still auto + still scanning + speed-only change"
    // case so the user's in-progress scan picks up the new period
    // without skipping a beat.
    this.clearAutoTimer();

    if (mode === 'auto' && prevMode === 'auto' && wasScanning) {
      // Live scanSpeedMs change (or no change) while already scanning —
      // re-arm at the new period so the user sees their setting take
      // effect immediately. autoState stays 'scanning'.
      this.startAutoTimer();
    } else {
      // Mode transition (step↔auto) or starting fresh in auto mode —
      // drop back to idle so the user's next press re-arms the timer
      // on their terms. In step mode `autoState` is a no-op but we
      // keep it tidy.
      this.autoState = 'idle';
    }
  }

  /**
   * Wire the controller to the Settings panel (Step D).
   *
   * The controller only needs the {@link SwitchScanSettingsLike#isCapturing}
   * getter — when it's `true`, the modal has attached its own capture
   * keydown listener at `capture: true` to grab the user's NEXT switch
   * press as the new binding, and the controller must stand down so it
   * doesn't ALSO interpret that press as an advance/select. We can't
   * just rely on the modal's `stopImmediatePropagation()` because both
   * listeners are at the document level and the order isn't guaranteed
   * across browsers — making `handleKeyDown` short-circuit on
   * `isCapturing()` is the belt-and-braces version.
   *
   * Settings is also our hook for push/pop modal sub-scan — index.ts
   * calls `pushModalSubScan` on open, the modal's Dialog onClose calls
   * `popModalSubScan`. Both are exposed below.
   *
   * @param settings The settings panel (or any object with `isCapturing`).
   */
  setSettings(settings: SwitchScanSettingsLike | null): void {
    this.settings = settings;
  }

  /**
   * Wire the controller to the TTS helper (Phase 5).
   *
   * Same structural-type pattern as {@link setSettings} — the
   * controller doesn't import {@link SwitchScanTts} directly so the
   * dependency graph stays one-way (host page → controller; host page
   * → tts). When the helper is unset OR its own `isEnabled()` returns
   * false, speak calls degrade to no-ops; callers don't branch.
   *
   * @param tts The TTS helper, or `null` to clear.
   */
  setTts(tts: SwitchScanTtsLike | null): void {
    this.tts = tts;
  }

  /**
   * Speak the label for the currently-highlighted item (Phase 5).
   *
   * Exposed publicly so the host page can confirm a settings toggle
   * by speaking the current label as soon as audio is enabled — the
   * common "did the toggle work?" feedback case. Internal callers
   * don't need this — `renderHighlight` already speaks on every
   * highlight move.
   */
  speakCurrentItemLabel(): void {
    if (!this.tts) return;
    const label = this.currentItemLabel();
    if (label) this.tts.speak(label);
  }

  /**
   * Push a `dom-items` frame for the named region (Step D entry point).
   *
   * The modal scan flow needs the same sub-scan plumbing the header /
   * maze-actions buttons already use — discover `[data-scan-item]`
   * descendants of the `[data-scan-region="<regionName>"]` wrapper,
   * push a frame, render the highlight inside the modal — but it's
   * driven by the modal's open/close lifecycle rather than a user
   * select. Hence this public entry point: index.ts calls it when the
   * settings modal opens, the controller treats the modal as a top-
   * level sub-scan target until {@link popModalSubScan} undoes it.
   *
   * Chose Option A from the plan: programmatically open a `dom-items`
   * sub-scan over the modal's region. The frame stack already supports
   * `dom-items`; we just bootstrap it from outside the normal `select`
   * path. The `topLevelIndex` we record is the user's current top-level
   * index — so the natural pop helper lands them where they came from
   * (typically header / settings button) if the modal closes via
   * sentinel-style bail.
   *
   * Idempotent: if the modal is already pushed (e.g. an open call
   * arrives while one is already active), no-op rather than stacking
   * duplicate frames.
   *
   * @param regionName The modal's `data-scan-region` value.
   */
  pushModalSubScan(regionName: string): void {
    if (!this.enabled) return;
    // Don't double-push: if there's already a dom-items frame for this
    // region on top, leave it alone. Avoids a stale frame if the modal
    // fires `open` twice during a race (e.g. open click + focus-trap
    // bounce).
    const active = this.activeFrame();
    if (
      active?.kind === 'dom-items' &&
      active.parentRegionName === regionName
    ) {
      return;
    }

    const items = this.discoverDomRegionItems(regionName);
    if (items.length === 0) {
      // No scannable controls inside the modal: nothing to push. We
      // deliberately don't error — the modal still works via mouse /
      // tab focus; the scanner just has nothing useful to do here.
      return;
    }

    // Anchor on whichever top-level index the user is currently on,
    // falling back to 0 if we somehow have no top frame. This is the
    // index pop helpers use for "resume here" — for the modal we want
    // the user to land back on the originating region (e.g. header
    // where the settings button lives) after close.
    const topFrame = this.frameStack[0];
    const topLevelIndex =
      topFrame && topFrame.kind === 'top' ? topFrame.index : 0;

    this.frameStack.push({
      kind: 'dom-items',
      parentRegionName: regionName,
      items,
      index: 0,
      topLevelIndex,
    });
    this.renderHighlight();
  }

  /**
   * Pop the modal sub-scan frame and resume top-level scanning (Step D).
   *
   * Called by index.ts from the Dialog's `onClose` hook, which fires
   * for every close path the modal supports (Cancel button, Save
   * button, ESC, backdrop click). We pop every non-`top` frame on the
   * stack — the same approach {@link popSubScan} uses — so any nested
   * frame we accidentally accumulated underneath is also cleared.
   *
   * Idempotent: a no-op if the stack is already at a clean top frame
   * (e.g. close fired without a corresponding open, or close fired
   * twice).
   */
  popModalSubScan(): void {
    if (!this.enabled) return;
    // Nothing to do if we're already at the top frame.
    if (this.frameStack.length <= 1) return;
    // Land back on whichever top-level index the modal-frame recorded
    // (typically header — that's where the settings button lives).
    let resumeIndex = 0;
    for (let i = this.frameStack.length - 1; i >= 0; i--) {
      const f = this.frameStack[i];
      if (f.kind === 'dom-items' || f.kind === 'blocks' ||
          f.kind === 'action-menu' || f.kind === 'dropdown-values') {
        resumeIndex = f.topLevelIndex;
        break;
      }
    }
    this.popSubScan(resumeIndex);
  }

  /**
   * Discover the four top-level scan regions in fixed order:
   * header → toolbox → workspace → maze-actions.
   *
   * Each region is exposed as a `{name, getRect}` pair so that callers
   * always get a fresh bounding rect (toolbox / workspace dimensions
   * change with window resize and panel collapse).
   *
   * Regions whose backing element can't be found are skipped (with a
   * console warning) rather than crashing — keeps the controller usable
   * even on level configurations that lack, say, a toolbox.
   */
  private discoverRegions(): ScanRegion[] {
    const regions: ScanRegion[] = [];

    // Header — plain DOM region tagged in Step 2.
    const headerEl = document.querySelector<HTMLElement>(
      '[data-scan-region="header"]',
    );
    if (headerEl) {
      regions.push({
        name: 'header',
        getRect: () => headerEl.getBoundingClientRect(),
      });
    } else {
      console.warn('[switch-scan] header region not found');
    }

    // Toolbox — prefer Blockly's flyout SVG group, fall back to the
    // toolbox HtmlDiv if a category-style Toolbox is in use. Both are
    // private-ish APIs; the cast pattern matches `src/index.ts:157`.
    const flyout = this.workspace.getFlyout();
    const toolbox = this.workspace.getToolbox();
    let toolboxRectFn: (() => DOMRect | null) | null = null;
    if (flyout) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svgGroup = (flyout as any).svgGroup_ as SVGElement | undefined;
      if (svgGroup) {
        toolboxRectFn = () => svgGroup.getBoundingClientRect();
      }
    }
    if (!toolboxRectFn && toolbox) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const htmlDiv = (toolbox as any).HtmlDiv as HTMLElement | undefined;
      if (htmlDiv) {
        toolboxRectFn = () => htmlDiv.getBoundingClientRect();
      }
    }
    if (toolboxRectFn) {
      // We deliberately don't sample the rect here — Blockly's flyout
      // may not be measured yet at `enable()` time (e.g. if discovery
      // runs before first layout / on a hidden tab). The thunk re-reads
      // on every render, and `renderHighlight()` already hides the
      // outline for a 0x0 rect, so a transiently-unmeasurable toolbox
      // self-recovers on the next cycle instead of being permanently
      // dropped.
      regions.push({name: 'toolbox', getRect: toolboxRectFn});
    } else {
      console.warn('[switch-scan] toolbox region not found');
    }

    // Workspace — the visible workspace area MINUS the toolbox/flyout.
    // The injectionDiv contains both the toolbox/flyout AND the main
    // workspace SVG, so its raw bounding rect would over-cover the
    // region and visually overlap the toolbox region's outline.
    // Instead, use Blockly's own metrics: viewWidth/viewHeight describe
    // the visible workspace (flyout excluded), and absoluteLeft/
    // absoluteTop give that view's offset within the injection div.
    // Translate to viewport coords by anchoring to the injection div's
    // bounding rect. This matches the workspace focus ring used by
    // src/index.ts:resizeFocusRingInternal.
    //
    // Visual nudge: shift the outline LEFT by `toolbox_width / 10` and
    // narrow it by `toolbox_width / 6` so the rect doesn't visually
    // hug the full available width. Toolbox width is read from
    // `toolboxRectFn` (captured above) at render time so it tracks
    // resizes; if the toolbox isn't measurable yet (null rect or zero
    // width), fall through to the unmodified workspace rect.
    const injectionDiv = this.workspace.getInjectionDiv();
    const capturedToolboxRectFn = toolboxRectFn;
    if (injectionDiv) {
      regions.push({
        name: 'workspace',
        getRect: () => {
          const base = this.getWorkspaceViewportRect(injectionDiv);
          if (!base) return null;
          const toolboxRect = capturedToolboxRectFn?.() ?? null;
          const toolboxWidth = toolboxRect?.width ?? 0;
          if (!toolboxWidth) return base;
          const leftShift = toolboxWidth / 10;
          const widthReduction = toolboxWidth / 6;
          return new DOMRect(
            base.left - leftShift,
            base.top,
            base.width - widthReduction,
            base.height,
          );
        },
      });
    } else {
      console.warn('[switch-scan] workspace region not found');
    }

    // Maze actions — plain DOM region tagged in Step 2.
    const mazeActionsEl = document.querySelector<HTMLElement>(
      '[data-scan-region="maze-actions"]',
    );
    if (mazeActionsEl) {
      regions.push({
        name: 'maze-actions',
        getRect: () => mazeActionsEl.getBoundingClientRect(),
      });
    } else {
      console.warn('[switch-scan] maze-actions region not found');
    }

    return regions;
  }

  /**
   * Compute the viewport-coordinate rect of the main workspace view
   * area, excluding the toolbox/flyout. Used by the `workspace` top-
   * level region so its outline hugs the workspace and doesn't bleed
   * into the toolbox region (which already has its own highlight).
   *
   * Combines:
   *  - `injectionDiv.getBoundingClientRect()` for viewport anchoring,
   *  - `workspace.getMetrics()` `absoluteLeft`/`absoluteTop` for the
   *    offset of the visible workspace within the injection div,
   *  - `viewWidth`/`viewHeight` for the visible workspace's size.
   *
   * Returns `null` if metrics aren't yet measurable (rare — defends
   * against an unrendered workspace; the renderer hides the outline
   * for null rects).
   *
   * @param injectionDiv
   */
  private getWorkspaceViewportRect(injectionDiv: Element): DOMRect | null {
    const m = this.workspace.getMetrics();
    if (!m) return null;
    const divRect = injectionDiv.getBoundingClientRect();
    return new DOMRect(
      divRect.left + m.absoluteLeft,
      divRect.top + m.absoluteTop,
      m.viewWidth,
      m.viewHeight,
    );
  }

  /**
   * Compute the viewport-coordinate rect of a SINGLE workspace block,
   * excluding any blocks connected via `nextConnection` or nested in its
   * statement inputs.
   *
   * Why not `block.getSvgRoot().getBoundingClientRect()`: a block's SVG
   * `<g>` element visually contains every descendant block (the next-
   * block stack, children of value/statement inputs), so its DOM
   * bounding rect over-covers — the outline would wrap the whole stack
   * instead of the one block being scanned.
   *
   * Approach: Blockly's `BlockSvg.getBoundingRectangleWithoutChildren()`
   * returns a {@link Blockly.utils.Rect} in WORKSPACE coordinates that
   * uses the block's own `height`/`width` only (no descendants). We
   * convert each corner to viewport (screen) coordinates via the public
   * `Blockly.utils.svgMath.wsToScreenCoordinates` helper — same path
   * Blockly itself uses for context-menu placement — which folds in
   * workspace scale, scroll, the injection div's viewport offset, and
   * the workspace origin offset in one call.
   *
   * Returns `null` if the block has no rendered SVG root (the renderer
   * already skips these elsewhere; this is just defensive).
   *
   * Reusable: also the right rect to anchor the per-block action menu
   * to (Step 4) — anchoring off the SVG-root rect drops the menu below
   * the entire stack instead of below the current block.
   *
   * @param block
   */
  private getSingleBlockViewportRect(
    block: Blockly.BlockSvg,
  ): DOMRect | null {
    if (!block.getSvgRoot?.()) return null;
    const wsRect = block.getBoundingRectangleWithoutChildren();
    const topLeft = Blockly.utils.svgMath.wsToScreenCoordinates(
      this.workspace,
      new Blockly.utils.Coordinate(wsRect.left, wsRect.top),
    );
    const bottomRight = Blockly.utils.svgMath.wsToScreenCoordinates(
      this.workspace,
      new Blockly.utils.Coordinate(wsRect.right, wsRect.bottom),
    );
    // RTL: workspace `left` may be > `right` numerically, but converting
    // both corners and re-normalising via min/max keeps the DOMRect's
    // width/height positive without us caring which direction is which.
    const left = Math.min(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const width = Math.abs(bottomRight.x - topLeft.x);
    const height = Math.abs(bottomRight.y - topLeft.y);
    return new DOMRect(left, top, width, height);
  }

  /**
   * Create the highlight outline + sentinel chip and attach them to
   * the document body. Both elements stay in the DOM for the life of
   * the enabled controller; we just toggle visibility / position.
   */
  private createOverlayElements(): void {
    this.highlightEl = document.createElement('div');
    this.highlightEl.className = 'switch-scan-highlight';
    this.highlightEl.style.display = 'none';
    document.body.appendChild(this.highlightEl);

    this.sentinelChip = document.createElement('div');
    this.sentinelChip.className = 'switch-scan-sentinel';
    this.sentinelChip.textContent = '↺ Back to top';
    this.sentinelChip.style.display = 'none';
    document.body.appendChild(this.sentinelChip);
  }

  /**
   * Return the active (top of stack) frame, or `null` if disabled. Used
   * by every render / input path so the controller is purely a function
   * of which frame is on top.
   */
  private activeFrame(): ScanFrame | null {
    return this.frameStack.length > 0
      ? this.frameStack[this.frameStack.length - 1]
      : null;
  }

  /**
   * Cycle length for a given frame (real slots + 1 sentinel slot).
   *
   * @param frame
   */
  private cycleLen(frame: ScanFrame): number {
    if (frame.kind === 'top') return this.regions.length + 1;
    if (frame.kind === 'dom-items') return frame.items.length + 1;
    if (frame.kind === 'blocks') return frame.blocks.length + 1;
    if (frame.kind === 'action-menu') return frame.items.length + 1;
    if (frame.kind === 'dropdown-values') return frame.options.length + 1;
    // 'move-candidates': fixed 2-item menu + sentinel = 3.
    return frame.items.length + 1;
  }

  /**
   * `true` iff the frame's index points at its sentinel slot.
   *
   * @param frame
   */
  private atSentinel(frame: ScanFrame): boolean {
    if (frame.kind === 'top') return frame.index === this.regions.length;
    if (frame.kind === 'dom-items') return frame.index === frame.items.length;
    if (frame.kind === 'blocks') return frame.index === frame.blocks.length;
    if (frame.kind === 'action-menu') return frame.index === frame.items.length;
    if (frame.kind === 'dropdown-values') return frame.index === frame.options.length;
    // 'move-candidates'
    return frame.index === frame.items.length;
  }

  /**
   * Derive a human-readable label for the currently-highlighted item
   * (Phase 5 TTS). Returns `null` when there's no meaningful string to
   * read (e.g. defensive cases where the active frame is missing).
   *
   * Label source by frame kind:
   *  - sentinel slot of any frame → "Back to top" (mirrors the chip's
   *    on-screen text so the audio + visual cues match).
   *  - `top` at a real region → the region's `name` ("header",
   *    "toolbox", "workspace", "maze-actions"). The names are
   *    intentionally terse and machine-flavored — there's no
   *    region-friendly map yet, and these strings happen to read fine
   *    out loud.
   *  - `dom-items` → the item's `aria-label`, falling back to its
   *    `textContent`. The settings modal's controls already carry
   *    sensible aria-labels via the existing markup; bare buttons
   *    fall back to their visible text.
   *  - `blocks` → `block.toString()` (Blockly's built-in
   *    structurally-renders the block to "move forward", "turn left",
   *    "repeat 5 times do", etc., respecting the message strings
   *    loaded from `messages.ts`). Falls back to `block.type` if
   *    toString returns empty.
   *  - `action-menu` / `move-candidates` → the item's explicit
   *    `label` field, which was set when the menu was constructed.
   *  - `dropdown-values` → the string form of the option label
   *    (image-labels use their `alt` text, matching how Blockly
   *    itself reads them).
   */
  private currentItemLabel(): string | null {
    const frame = this.activeFrame();
    if (!frame) return null;

    if (this.atSentinel(frame)) {
      // Mirror the chip's visible text. The "↺" is a decorative glyph
      // we deliberately drop here — it doesn't read sensibly aloud.
      return 'Back to top';
    }

    if (frame.kind === 'top') {
      const region = this.regions[frame.index];
      return region?.name ?? null;
    }

    if (frame.kind === 'dom-items') {
      const item = frame.items[frame.index];
      if (!item) return null;
      const aria = item.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const text = item.textContent?.trim();
      return text || null;
    }

    if (frame.kind === 'blocks') {
      const block = frame.blocks[frame.index];
      if (!block) return null;
      try {
        // Blockly's `toString` walks the block's message + fields and
        // produces a sentence-shaped string (e.g. "move forward",
        // "turn left", "repeat 5 times do") that respects the
        // localized messages already loaded into `Blockly.Msg`. If a
        // block has connected children, toString includes their text
        // too — fine for a scan label since the highlight visually
        // hugs only the head block; the audio identifies the block
        // and the visual identifies its scope.
        const s = block.toString?.();
        if (s && s.trim()) return s.trim();
      } catch (e) {
        // Defensive — toString shouldn't throw, but if it does we fall
        // through to the type-based fallback below.
      }
      return block.type || null;
    }

    if (frame.kind === 'action-menu' || frame.kind === 'move-candidates') {
      // The menu rows carry their human-readable label directly. No
      // i18n today (matches the visual rendering — Phase 5 doesn't
      // localize menu chrome).
      const item = frame.items[frame.index];
      return item?.label ?? null;
    }

    if (frame.kind === 'dropdown-values') {
      const option = frame.options[frame.index];
      if (!option) return null;
      const label = option[0];
      if (typeof label === 'string') return label;
      // Image-labels: use `alt` (the same text Blockly's accessibility
      // path falls back to). If alt is missing, the option's `value`
      // string is the next best thing — at least the user hears
      // something distinguishable.
      return label.alt || option[1] || null;
    }

    return null;
  }

  /**
   * Reposition / show / hide the highlight + sentinel chip based on
   * the active frame's current index. Safe to call any number of times.
   *
   * Highlight target by frame kind:
   *  - `top` at a real region → region's `getRect()` outline.
   *  - `top` at sentinel       → sentinel chip.
   *  - `dom-items` at an item  → item's `getBoundingClientRect()`.
   *  - `dom-items` at sentinel → sentinel chip (same "Back to top"
   *    affordance — pops the frame instead of resetting index).
   *  - `blocks` at a block     → block SVG root's bounding rect
   *    (viewport coordinates work with our `position: fixed` outline).
   *  - `blocks` at sentinel    → sentinel chip.
   *
   * Phase 5: after positioning the highlight, also asks the TTS helper
   * to speak the current item's label (if non-null). The helper handles
   * the cancel-and-replace contract internally so rapid advances don't
   * queue a backlog. The `speak` option is set to `false` by the
   * resize/scroll reflow path so the user doesn't hear the same label
   * re-spoken just because they resized the window.
   *
   * @param options Render flags.
   * @param options.speak Whether to announce the current item via the
   *     TTS helper. Pass `false` to suppress (used by the resize /
   *     scroll reflow path). Defaults to true — every interactive
   *     render speaks.
   */
  private renderHighlight(options?: {speak?: boolean}): void {
    if (!this.highlightEl || !this.sentinelChip) return;
    const frame = this.activeFrame();
    if (!frame) {
      this.highlightEl.style.display = 'none';
      this.sentinelChip.style.display = 'none';
      return;
    }

    // Phase 5: speak the current label, unless this render was
    // triggered by a non-user reflow (resize/scroll) where re-speaking
    // would be noisy. The helper handles cancel-and-replace and the
    // disabled-state no-op, so we don't branch on those here.
    const shouldSpeak = options?.speak !== false;

    if (this.atSentinel(frame)) {
      this.highlightEl.style.display = 'none';
      this.sentinelChip.style.display = 'block';
      if (shouldSpeak) this.speakCurrentLabel();
      return;
    }

    // Pointing at a concrete target — hide chip, position outline.
    this.sentinelChip.style.display = 'none';

    let rect: DOMRect | null = null;
    if (frame.kind === 'top') {
      rect = this.regions[frame.index]?.getRect() ?? null;
    } else if (frame.kind === 'dom-items') {
      rect = frame.items[frame.index]?.getBoundingClientRect() ?? null;
    } else if (frame.kind === 'blocks') {
      const block = frame.blocks[frame.index];
      if (frame.regionName === 'workspace' && block) {
        // For workspace blocks we want the outline to hug ONLY the
        // current block, not the connected stack below it. The block's
        // SVG root visually contains all descendants/next-blocks, so
        // its raw bounding rect over-covers. See
        // {@link getSingleBlockViewportRect} for the conversion.
        rect = this.getSingleBlockViewportRect(block);
      } else {
        // Toolbox flyout blocks aren't stacked, so the SVG root rect
        // already hugs just the one block.
        const svgRoot = block?.getSvgRoot();
        rect = svgRoot?.getBoundingClientRect() ?? null;
      }
    } else if (frame.kind === 'action-menu') {
      // Highlight the currently-focused menu row inside the overlay.
      // The block underneath is implicitly the subject of every action,
      // identifiable by the menu's anchor position next to it — so we
      // intentionally don't outline the block here.
      const itemEl = this.actionMenuEl?.querySelector<HTMLElement>(
        `[data-scan-action-item="${frame.index}"]`,
      );
      rect = itemEl?.getBoundingClientRect() ?? null;
    } else if (frame.kind === 'dropdown-values') {
      const itemEl = this.dropdownMenuEl?.querySelector<HTMLElement>(
        `[data-scan-dropdown-item="${frame.index}"]`,
      );
      rect = itemEl?.getBoundingClientRect() ?? null;
    } else {
      // 'move-candidates': highlight the Next/Place menu row. The
      // candidate-connection itself is highlighted by Blockly's own
      // move-mode preview (connection-highlight layer), so we never
      // outline the block here.
      const itemEl = this.moveMenuEl?.querySelector<HTMLElement>(
        `[data-scan-move-item="${frame.index}"]`,
      );
      rect = itemEl?.getBoundingClientRect() ?? null;
    }

    if (!rect || rect.width === 0 || rect.height === 0) {
      // Defensive: rect may briefly be unmeasurable (e.g. element
      // hidden mid-cycle); hide rather than splat a 0x0 outline at
      // (0,0). The next reflow / advance recovers.
      this.highlightEl.style.display = 'none';
      return;
    }

    this.highlightEl.style.display = 'block';
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;

    if (shouldSpeak) this.speakCurrentLabel();
  }

  /**
   * Internal helper — derive the current item's label and forward it
   * to the TTS helper. Public {@link speakCurrentItemLabel} is the
   * external API; this is the variant `renderHighlight` calls so the
   * speak path doesn't have to re-resolve `tts` defensively.
   */
  private speakCurrentLabel(): void {
    if (!this.tts) return;
    const label = this.currentItemLabel();
    if (label) this.tts.speak(label);
  }

  /**
   * Pause the scanner while a maze run is in flight. Hides every
   * overlay (highlight, sentinel chip, action menu, dropdown menu) so
   * the maze animation reads cleanly, and flips `executing` so
   * `handleKeyDown` early-returns. The {@link frameStack} is left
   * untouched here — we don't reset until run-end so the bookkeeping
   * stays simple, and the user can never observe an intermediate state
   * because we hide everything while paused anyway.
   *
   * Note: action / dropdown overlays are torn down (not just hidden)
   * to match the existing lifecycle — they're recreated on demand by
   * `renderActionMenu` / `renderDropdownMenu`, and tearing them down
   * here means we don't have to remember they exist when resetting
   * the frameStack on run-end.
   */
  private handleRunStart(): void {
    this.executing = true;
    // Phase 5: cut off any in-progress utterance so the speech voice
    // doesn't keep talking over the maze animation. The TTS helper's
    // own no-op-when-disabled behavior makes this safe to call
    // unconditionally.
    this.tts?.cancel();
    // Phase 4: pause the auto-scan timer and drop back to idle. The
    // scanner has no business cycling while the user watches their
    // program execute; `handleRunEnd` leaves us idle so the user
    // re-arms scanning with a fresh switch press, matching the design
    // doc's "resumes idle after Reset" semantics.
    this.clearAutoTimer();
    this.autoState = 'idle';
    this.tearDownOverlaysForRun();
  }

  /**
   * Resume the scanner after a maze run finishes (success, failure,
   * timeout, error, or reset interrupt — MazeGame's start/cancel/
   * showResult/reset paths all fire the same `false` notification).
   *
   * Restores the user to a clean top-level frame at index 0 (header)
   * — chosen over "resume where they were" so it's predictable: after
   * a run, the highlight is always back at the top, ready for the
   * next interaction.
   *
   * Phase 4: in auto mode we leave `autoState === 'idle'` (handleRunStart
   * already cleared the timer). The user's next switch press re-arms
   * the timer, matching the design doc's "resumes idle after Reset" —
   * we interpret that as "the scanner becomes idle after any run end,
   * waiting for the user to press to restart" so a switch user doesn't
   * find their highlight cycling under them the moment the run banner
   * disappears.
   */
  private handleRunEnd(): void {
    this.executing = false;
    // Fresh top frame so the user always restarts at the header.
    this.frameStack = [{kind: 'top', index: 0}];
    this.renderHighlight();
  }

  /**
   * Hide overlays during a run. Highlight + sentinel are just set to
   * `display: none` (kept in the DOM, cheap to re-show); the action
   * and dropdown menus are removed entirely since their lifecycle is
   * "exists while the corresponding frame is on top." `handleRunEnd`
   * resets the frameStack to a fresh top, so any frames that owned
   * those overlays are gone anyway.
   */
  private tearDownOverlaysForRun(): void {
    if (this.highlightEl) this.highlightEl.style.display = 'none';
    if (this.sentinelChip) this.sentinelChip.style.display = 'none';
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;
    this.dropdownMenuEl?.remove();
    this.dropdownMenuEl = null;
    // Phase 3 Step 1: a move could be in flight when a run starts
    // (rare — user has to advance through "Move → Next → Run" in a
    // very specific order). Abort it cleanly before tearing down our
    // overlay so Blockly's own move-mode bookkeeping (drag strategy
    // patch, connection highlights, shortcut registration) gets
    // unwound. handleRunEnd resets the frame stack to a fresh top.
    this.cancelActiveMoveIfAny();
    this.moveMenuEl?.remove();
    this.moveMenuEl = null;
  }

  /**
   * Coalesce resize/scroll bursts into a single rAF-paced re-render so
   * we don't thrash layout while the user drags the window or scrolls.
   */
  private scheduleReflow(): void {
    if (this.reflowRafHandle !== null) return;
    this.reflowRafHandle = requestAnimationFrame(() => {
      this.reflowRafHandle = null;
      // Don't re-show overlays during a run: the run-end handler will
      // re-render on a clean top-frame anyway, and resizing mid-run
      // shouldn't pop the scanner back on top of the animation.
      if (this.executing) return;
      // Phase 5: reflow renders shouldn't re-speak the current item —
      // the scan position hasn't changed, only the geometry has.
      this.renderHighlight({speak: false});
    });
  }

  /**
   * Keydown handler. Routes both advance and select through whichever
   * frame is currently on top of the stack.
   *
   * Advance: increments the active frame's index modulo its cycle
   * length (real slots + sentinel).
   *
   * Select:
   * - `top` at sentinel    → reset to index 0 (wrap).
   * - `top` at any region  → push the appropriate sub-scan frame for
   * that region (DOM-item, toolbox-blocks, workspace-blocks).
   * - sub-scan at item     → commit the action (click button / insert
   * block / pick value / Select / Delete / Edit) and pop via
   * {@link popToNextRegion} so the user advances to the next top
   * region.
   * - sub-scan at sentinel → pop via {@link popToSameRegion} so the
   * user lands back on the SAME top-level region they entered the
   * sub-scan from, ready to re-enter it. (Action-completed pops go
   * to the NEXT region; sentinel pops stay on the same region.)
   *
   * Defensive: bails if disabled (the listener is removed on disable,
   * but the guard keeps state and listener-binding decoupled) and skips
   * events from text inputs so the keys remain usable in dialogs / form
   * fields once those land in later phases.
   *
   * @param e
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    // While the maze is running a program, advance/select are dead.
    // The user should be watching the animation, not driving the
    // scanner; resuming happens automatically via handleRunEnd.
    if (this.executing) return;

    // Step D: while the settings modal has a live key-capture in
    // flight, every press belongs to the capture handler (it's reading
    // the user's NEXT switch press as the new binding). Stand down so
    // the controller doesn't ALSO interpret that press as advance /
    // select — otherwise the user would simultaneously rebind Switch A
    // AND fire an advance, drifting the scan position invisibly.
    // We can't rely solely on the modal's capture-phase listener +
    // stopImmediatePropagation, because listener ordering across
    // browsers at the document level isn't strictly guaranteed; the
    // explicit short-circuit is the belt-and-braces version.
    if (this.settings?.isCapturing()) return;

    // Ignore if user is typing in an input field.
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const frame = this.activeFrame();
    if (!frame) return;

    const isAdvance = e.key === this.switchAdvance;
    const isSelect = e.key === this.switchSelect;
    if (!isAdvance && !isSelect) return;

    // While a move is in flight (move-candidates frame), our switch
    // keys collide with Blockly's own move-mode bindings — Space/Enter
    // are `finish_move`, arrow keys are constrained candidate steps.
    // Stop propagation here (capture phase) so Blockly's container-
    // level handler never sees the press and doesn't commit/abort
    // independently of us. Other frames intentionally do NOT stop
    // propagation — pre-existing flows assume Blockly continues to
    // receive non-switch keys, and we don't want to regress anything.
    if (frame.kind === 'move-candidates') {
      e.stopPropagation();
      e.preventDefault();
    }

    if (this.scanMode === 'auto') {
      // Phase 4: single-switch auto-scan. The advance key is the ONLY
      // input — its meaning depends on `autoState`:
      //  - `idle`  → start the timer (no other side effect; the user's
      //              press is consumed as the "wake up" gesture, NOT a
      //              select).
      //  - `scanning` → act on the currently highlighted item (same
      //              `handleSelect` dispatch step mode uses for its
      //              Switch B). The timer keeps running so the highlight
      //              continues to auto-cycle on whatever frame the
      //              select transitioned us into (e.g. a sub-scan that
      //              was just pushed).
      // The select key is intentionally ignored — Switch B is hidden in
      // the settings panel when scanMode === 'auto' and has no role.
      if (!isAdvance) return;
      if (this.autoState === 'idle') {
        this.startAutoTimer();
        return;
      }
      // autoState === 'scanning' → select.
      this.handleSelect(frame);
      return;
    }

    if (isAdvance) {
      this.advance();
      return;
    }

    // isSelect
    this.handleSelect(frame);
  }

  /**
   * Advance the current frame's highlight by one slot and re-render.
   *
   * Shared between step mode (driven by the user's advance keypress) and
   * auto mode (driven by the internal interval timer). Extracted from
   * the original inline body in {@link handleKeyDown} so both paths
   * cycle identically — including the modulo over `cycleLen` (real
   * slots + 1 sentinel) and the TTS speak triggered by
   * {@link renderHighlight}.
   */
  private advance(): void {
    const frame = this.activeFrame();
    if (!frame) return;
    const len = this.cycleLen(frame);
    if (len <= 0) return;
    frame.index = (frame.index + 1) % len;
    this.renderHighlight();
  }

  /**
   * Phase 4 — start the auto-advance interval timer.
   *
   * Idempotent: if a timer is already running, the existing one is
   * cleared first so we never end up with two intervals racing. The
   * caller is expected to have just transitioned `autoState` from
   * `'idle'` to `'scanning'` (or to be re-entering scanning after a
   * settings-driven scanSpeedMs change).
   *
   * Note we do NOT call `advance()` immediately — the user's
   * first press is intentionally a "wake up" gesture that just starts
   * the timer; the highlight stays parked on the initial frame until
   * the first tick fires `scanSpeedMs` later. This matches the design
   * doc: "First switch press: scanner starts at top level, highlights
   * cycle on `scanSpeedMs` interval, looping."
   */
  private startAutoTimer(): void {
    this.clearAutoTimer();
    this.autoState = 'scanning';
    this.autoTimerHandle = window.setInterval(
      () => this.advance(),
      this.scanSpeedMs,
    );
  }

  /**
   * Phase 4 — stop the auto-advance interval timer if one is running.
   *
   * Does NOT flip `autoState` — the caller owns that decision. Used by
   * `handleRunStart` (run pauses scanning), `handleRunEnd` (back to
   * idle), `disable()` (teardown), and {@link setMode} (mode/speed
   * change). Safe to call when no timer is running.
   */
  private clearAutoTimer(): void {
    if (this.autoTimerHandle !== null) {
      window.clearInterval(this.autoTimerHandle);
      this.autoTimerHandle = null;
    }
  }

  /**
   * Resolve a select keypress against the active frame.
   * Kept separate from {@link handleKeyDown} so the routing reads as a
   * flat dispatch table rather than nested conditionals.
   *
   * @param frame
   */
  private handleSelect(frame: ScanFrame): void {
    if (frame.kind === 'top') {
      if (this.atSentinel(frame)) {
        console.log('[switch-scan] selected sentinel: back to top');
        frame.index = 0;
        this.renderHighlight();
        return;
      }
      const region = this.regions[frame.index];
      if (!region) return;
      if (region.name === 'header' || region.name === 'maze-actions') {
        this.enterDomRegionSubScan(region.name, frame.index);
      } else if (region.name === 'toolbox') {
        this.enterToolboxSubScan(frame.index);
      } else if (region.name === 'workspace') {
        this.enterWorkspaceSubScan(frame.index);
      } else {
        // Unknown region — keep the Step-3 log behavior so any future
        // region added to `discoverRegions` without a routing branch
        // surfaces in the console rather than silently no-op'ing.
        console.log('[switch-scan] selected region:', region.name);
      }
      return;
    }

    if (frame.kind === 'dom-items') {
      if (this.atSentinel(frame)) {
        // Sentinel: bail out of the sub-scan without firing anything.
        // Land on the SAME region the user just left so they can re-enter
        // it (matches user's mental model of "back to top = let me try
        // again from where I was").
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      // Click first, then pop — if click() throws we still escape the
      // sub-scan rather than getting stuck on a broken item.
      try {
        item?.click();
      } finally {
        // Action completed: advance to the next top-level region so the
        // user keeps moving forward through the scan cycle.
        this.popToNextRegion(frame.topLevelIndex);
      }
      return;
    }

    if (frame.kind === 'blocks') {
      if (this.atSentinel(frame)) {
        // Sentinel pop → stay on the same region for re-entry.
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const block = frame.blocks[frame.index];
      if (frame.regionName === 'toolbox') {
        // Insert a new block of the same type into the MAIN workspace
        // (not the flyout workspace) via the shared heuristic. We do
        // not clone or move the flyout block itself — `block.type` plus
        // the insertion helper produces a fresh, properly-connected
        // instance.
        try {
          if (block) {
            insertBlockAfterCursor(this.workspace, block.type);
          }
        } finally {
          // Toolbox insert is the ONE action-commit exception that pops
          // to the SAME top-level region instead of advancing: users
          // building a program typically chain inserts (turn → move →
          // turn → ...), and advancing to workspace after every insert
          // forces them to cycle all the way back through workspace +
          // maze-actions + sentinel + header just to insert again.
          // Staying on toolbox lets them re-enter the flyout sub-scan
          // immediately for the next insert. Every other action-commit
          // site (header button click, action-menu Select/Delete/Edit
          // commit, maze-actions click, dropdown-values pick) still
          // uses popToNextRegion — only the chain-insert ergonomics
          // here warrant the override.
          this.popToSameRegion(frame.topLevelIndex);
        }
        return;
      }
      // Workspace block frame: open the action sub-scan menu anchored
      // next to this block. The action-menu frame inherits this frame's
      // `topLevelIndex` (the workspace top-level index) so its own pop
      // helpers compute the correct same/next resume index.
      if (block) {
        this.enterActionMenu(block, frame.topLevelIndex);
      }
      return;
    }

    if (frame.kind === 'action-menu') {
      if (this.atSentinel(frame)) {
        // "Back to top" sentinel — bail out without acting on the block,
        // stay on the same top region (workspace) so the user can pick a
        // different block.
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      const block = frame.block;
      if (!item) {
        // Defensive fallback — treat as a sentinel-style bail.
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      if (item.key === 'select') {
        // Commit Blockly's FocusManager to this block so the shared
        // `insertBlockAfterCursor` heuristic places subsequent toolbox
        // insertions after it.
        try {
          Blockly.getFocusManager().focusNode(block);
        } catch (err) {
          // Defensive: focusNode can throw if the block was disposed
          // out from under us between menu open and selection. Pop
          // anyway so the user isn't stranded.
          console.warn('[switch-scan] focusNode failed:', err);
        }
        // Action committed → next region.
        this.popToNextRegion(frame.topLevelIndex);
        return;
      }
      if (item.key === 'delete') {
        // Group disposal so undo treats it as a single step. Pop to top
        // unconditionally — even if dispose throws, the workspace frame
        // beneath us is stale (its block list is built from
        // pre-disposal state), so returning to it would be incorrect.
        try {
          Blockly.Events.setGroup(true);
          try {
            block.dispose(true, true);
          } finally {
            Blockly.Events.setGroup(false);
          }
        } catch (err) {
          console.warn('[switch-scan] block.dispose failed:', err);
        }
        // Action committed → next region.
        this.popToNextRegion(frame.topLevelIndex);
        return;
      }
      if (item.key === 'edit') {
        // Push a nested dropdown-values frame. The Edit option is only
        // present when there's at least one editable FieldDropdown, so
        // this lookup should succeed; defensively fall back to pop-to-
        // top if it doesn't (treat as a bail → same region).
        const field = this.findFirstEditableDropdown(block);
        if (!field) {
          this.popToSameRegion(frame.topLevelIndex);
          return;
        }
        // Pre-focus the block via Blockly's FocusManager (same call the
        // Select handler uses) so the block visibly highlights during the
        // dropdown-values sub-scan. Without this, the action menu closes
        // and the dropdown opens with no indication of WHICH block is
        // being edited — confusing in a chain of similar blocks. Wrapped
        // in try/catch defensively: focusNode can throw if the block was
        // disposed between menu open and selection, but we still want to
        // proceed into the dropdown-values frame.
        try {
          Blockly.getFocusManager().focusNode(block);
        } catch (err) {
          console.warn('[switch-scan] focusNode failed:', err);
        }
        // Dropdown frame inherits the same top-level index so its own
        // pop helpers compute correctly.
        this.enterDropdownValues(block, field, frame.topLevelIndex);
        return;
      }
      if (item.key === 'move') {
        // Hand off to Blockly's keyboard-move mode and push our own
        // move-candidates frame to translate switch input into move-mode
        // shortcut invocations. {@link enterMoveCandidates} encapsulates
        // the focus / cursor priming and the start_move dispatch; if
        // anything fails it'll pop us back to the same region rather
        // than leaving the user stuck.
        this.enterMoveCandidates(block, frame.topLevelIndex);
        return;
      }
      return;
    }

    if (frame.kind === 'move-candidates') {
      if (this.atSentinel(frame)) {
        // Sentinel ("Back to top") aborts the in-flight move. Revert
        // the block to its original position and pop back to the same
        // top-level region (workspace), matching the other sentinel
        // bails so the user can immediately pick a different block.
        this.cancelActiveMoveIfAny();
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      if (!item) {
        // Defensive fallback — abort cleanly.
        this.cancelActiveMoveIfAny();
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      if (item.key === 'next') {
        // Step Blockly's move mode forward one candidate connection,
        // then re-render so our Next/Place menu highlight stays on
        // "Next" (the most common follow-up is another "Next"). The
        // candidate-preview highlight is drawn by Blockly itself.
        this.stepMoveCandidate();
        this.renderHighlight();
        return;
      }
      if (item.key === 'place') {
        // Commit the move at whatever candidate Blockly is currently
        // previewing. If commit succeeds (or fails defensively), pop
        // to the next top-level region — Move counts as a committed
        // action just like Select / Delete / Edit-commit.
        this.commitMoveAtCurrentCandidate();
        this.popToNextRegion(frame.topLevelIndex);
        return;
      }
      return;
    }

    if (frame.kind === 'dropdown-values') {
      if (this.atSentinel(frame)) {
        // Bail without changing the field's value. Pop both the
        // dropdown-values frame AND the action-menu frame beneath it;
        // stay on the same top region so the user can re-enter the
        // workspace sub-scan and try editing again.
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const option = frame.options[frame.index];
      if (option) {
        try {
          frame.field.setValue(option[1]);
        } catch (err) {
          console.warn('[switch-scan] field.setValue failed:', err);
        }
      }
      // Edit committed → advance to next region (v1 design: treat the
      // whole edit flow as a single committed action that lands the user
      // past the workspace region, not back inside it).
      this.popToNextRegion(frame.topLevelIndex);
      return;
    }
  }

  /**
   * Enter a DOM region's item sub-scan.
   *
   * Generic over any region whose buttons are tagged with
   * `data-scan-item` inside a `[data-scan-region="..."]` wrapper.
   * Currently used for `header` and `maze-actions`; the same plumbing
   * will serve any future plain-DOM region.
   *
   * Items are discovered fresh every entry (not cached) so that
   * buttons which become visible later — e.g. `#ghostRunButton` once
   * its `.hidden` class is removed on the right level — get picked up
   * without any cache invalidation logic.
   *
   * If discovery yields zero visible items (degenerate / fully hidden
   * region), we treat select as a no-op and just advance past the
   * region: skipping forward keeps the cycle progressing instead of
   * leaving the user stuck on an unactionable region.
   *
   * @param regionName     The region's `data-scan-region` value.
   * @param topLevelIndex  Top-level index of the region the user entered
   *     from. Stored on the frame so the pop helpers can derive the
   *     correct resume index (same region for sentinel pops, next region
   *     for action-completed pops — see {@link popToSameRegion} /
   *     {@link popToNextRegion}).
   */
  private enterDomRegionSubScan(
    regionName: string,
    topLevelIndex: number,
  ): void {
    const items = this.discoverDomRegionItems(regionName);

    if (items.length === 0) {
      // Nothing to scan — advance past the region so the user isn't
      // stuck. Treat the empty sub-scan as a no-op "action" and advance
      // to the next top-level region (matches what a successful item
      // click would have done). For maze-actions this still correctly
      // lands on the top-level sentinel via the modulo inside
      // popToNextRegion.
      this.popToNextRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'dom-items',
      parentRegionName: regionName,
      items,
      index: 0,
      topLevelIndex,
    });
    this.renderHighlight();
  }

  /**
   * Pop every non-`top` frame off the stack and resume the top frame at
   * the SAME top-level region the user entered the sub-scan from.
   *
   * Used for sentinel-driven pops ("Back to top"): the user is
   * explicitly bailing out of the sub-scan and wants to land back on the
   * region they were on, so they can re-enter it (e.g. re-open the
   * toolbox if they entered it by mistake, or pick a different workspace
   * block after backing out of the action menu).
   *
   * @param topLevelIndex Top-level region the sub-scan was entered from.
   */
  private popToSameRegion(topLevelIndex: number): void {
    this.popSubScan(topLevelIndex);
  }

  /**
   * Pop every non-`top` frame off the stack and resume the top frame at
   * the NEXT top-level region (wrapping past the sentinel, modulo cycle
   * length).
   *
   * Used after an action commits — a clicked DOM button, a toolbox
   * block insertion, a workspace block action (Select / Delete / Edit
   * value chosen). Moving forward keeps the scan cycle progressing
   * rather than parking the user on a region they just finished with.
   *
   * For the last real region (maze-actions) the next index lands on the
   * top-level sentinel, which is the desired "you reached the end, now
   * wrap" affordance.
   *
   * @param topLevelIndex Top-level region the sub-scan was entered from.
   */
  private popToNextRegion(topLevelIndex: number): void {
    const topCycleLen = this.regions.length + 1;
    const nextIndex = topCycleLen > 0 ? (topLevelIndex + 1) % topCycleLen : 0;
    this.popSubScan(nextIndex);
  }

  /**
   * Pop sub-scan frames off the stack until only the top-level `top`
   * frame remains, then set that frame's index to `resumeIndex`.
   *
   * Popping all non-`top` frames (rather than just the immediate
   * caller) matters for the action-menu flow: a Select/Delete/sentinel
   * from `action-menu` lands us back at top, skipping past the
   * workspace blocks frame underneath. Post-delete the workspace
   * frame's `blocks[]` holds a stale reference, so resuming it would be
   * incorrect; and post-select/edit we deliberately pop to top too, for
   * consistency. Tear down any owned overlay DOM as we go.
   *
   * For the simpler dom-items / blocks-from-toolbox case, this is still
   * a single pop because there's only one non-top frame on the stack.
   *
   * Prefer the named helpers {@link popToSameRegion} /
   * {@link popToNextRegion} at call sites — they encode the semantic
   * intent (sentinel bail vs action commit) and compute the right
   * resume index from the entry top-level index.
   *
   * @param resumeIndex
   */
  private popSubScan(resumeIndex: number): void {
    while (
      this.frameStack.length > 0 &&
      this.frameStack[this.frameStack.length - 1].kind !== 'top'
    ) {
      const popped = this.frameStack.pop();
      // Tear down any DOM that belonged to the popped frame.
      if (popped?.kind === 'action-menu') {
        this.actionMenuEl?.remove();
        this.actionMenuEl = null;
      } else if (popped?.kind === 'dropdown-values') {
        this.dropdownMenuEl?.remove();
        this.dropdownMenuEl = null;
      } else if (popped?.kind === 'move-candidates') {
        // Just remove the overlay here — caller has already invoked
        // either finish_move (commit) or abort_move (sentinel) BEFORE
        // calling pop, so Blockly's own move-mode state is already
        // cleaned up by this point. If pop is reached without one of
        // those (defensive paths only — e.g. surprise frame stack
        // reset), `cancelActiveMoveIfAny` will catch the stuck move.
        this.moveMenuEl?.remove();
        this.moveMenuEl = null;
      }
    }
    const topFrame = this.frameStack[0];
    if (topFrame && topFrame.kind === 'top') {
      const topCycleLen = this.regions.length + 1;
      topFrame.index =
        topCycleLen > 0 ? ((resumeIndex % topCycleLen) + topCycleLen) % topCycleLen : 0;
    }
    this.renderHighlight();
  }

  /**
   * Enter the toolbox region's flyout-block sub-scan.
   *
   * Discovers the flyout's top blocks via Blockly's flyout API
   * (`workspace.getFlyout().getWorkspace().getTopBlocks(true)`) rather
   * than via DOM tagging, since flyout blocks are SVG elements not
   * tagged with `data-scan-item`. Filters out blocks that aren't
   * currently rendered / measurable (defensive against transiently
   * unrendered flyout state on first enable).
   *
   * If discovery yields zero blocks, advance past toolbox the same way
   * `enterDomRegionSubScan` advances past an empty DOM region.
   *
   * @param topLevelIndex  Top-level index of the toolbox region. Stored
   *     on the pushed frame so the pop helpers can resume at the same
   *     region (sentinel bail — user re-enters toolbox) or the next
   *     region (block-inserted — user moves on to workspace).
   */
  private enterToolboxSubScan(topLevelIndex: number): void {
    const blocks = this.discoverFlyoutBlocks();

    if (blocks.length === 0) {
      // Empty toolbox is a degenerate "action complete" → advance.
      this.popToNextRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'blocks',
      regionName: 'toolbox',
      blocks,
      index: 0,
      topLevelIndex,
    });
    this.renderHighlight();
  }

  /**
   * Discover the flyout's currently-visible top-level blocks, in
   * flyout order. Returns `[]` if there's no flyout or its workspace
   * isn't reachable.
   *
   * "Visible" filter: block must have a rendered SVG root with a
   * non-zero bounding rect. Flyout categories or labels (non-block
   * elements) are naturally excluded because `getTopBlocks` only
   * returns Block instances.
   */
  private discoverFlyoutBlocks(): Blockly.BlockSvg[] {
    const flyout = this.workspace.getFlyout();
    if (!flyout) return [];
    const flyoutWs = flyout.getWorkspace();
    if (!flyoutWs) return [];

    const topBlocks = flyoutWs.getTopBlocks(true);
    const result: Blockly.BlockSvg[] = [];
    for (const block of topBlocks) {
      const blockSvg = block as Blockly.BlockSvg;
      const root = blockSvg.getSvgRoot?.();
      if (!root) continue;
      const rect = root.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      result.push(blockSvg);
    }
    return result;
  }

  /**
   * Enter the workspace region's block sub-scan.
   *
   * Mirrors {@link enterToolboxSubScan} but over the main workspace's
   * blocks (via {@link discoverWorkspaceBlocks}) in tree order. If
   * discovery yields zero blocks (empty workspace), advance past the
   * region the same way the toolbox / DOM helpers do, so the user
   * isn't stuck on an empty workspace.
   *
   * @param topLevelIndex  Top-level index of the workspace region.
   *     Stored on the pushed frame so the pop helpers can resume at the
   *     same region (sentinel bail — user re-enters workspace to pick
   *     a different block) or the next region (after an action menu
   *     commits — user moves on to maze-actions).
   */
  private enterWorkspaceSubScan(topLevelIndex: number): void {
    const blocks = this.discoverWorkspaceBlocks();

    if (blocks.length === 0) {
      // Empty workspace is a degenerate "action complete" → advance.
      this.popToNextRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'blocks',
      regionName: 'workspace',
      blocks,
      index: 0,
      topLevelIndex,
    });
    this.renderHighlight();
  }

  /**
   * Discover the main workspace's blocks in tree order, matching how
   * a programmer reads code top-to-bottom.
   *
   * Traversal rule, applied to each top block from
   * `workspace.getTopBlocks(true)` in order:
   *  1. Yield the block itself.
   *  2. For each input on `block.inputList`, if it has a `connection`
   *     whose `targetBlock()` is non-null, recurse into that subtree
   *     BEFORE moving on. This is what makes us descend into statement
   *     inputs (e.g. the body of a `repeat`) before continuing.
   *  3. After all inputs are processed, follow
   *     `block.nextConnection.targetBlock()` to the next sibling along
   *     the stack chain and repeat from step 1.
   *
   * The filter `block.getSvgRoot() != null` drops non-rendered
   * placeholders (e.g. blocks that exist in the model but haven't been
   * rendered yet — rare in the maze game but cheap insurance).
   *
   * Staleness: in the controlled switch-only flow, blocks don't get
   * disposed between a frame push and the next interaction without the
   * user driving it; we don't bother with weak refs. The 0x0-rect hide
   * path in {@link renderHighlight} already handles the rare case of a
   * block being removed mid-cycle.
   */
  private discoverWorkspaceBlocks(): Blockly.BlockSvg[] {
    const result: Blockly.BlockSvg[] = [];
    const visit = (block: Blockly.Block | null): void => {
      if (!block) return;
      const blockSvg = block as Blockly.BlockSvg;
      if (blockSvg.getSvgRoot && blockSvg.getSvgRoot() != null) {
        result.push(blockSvg);
      }
      // Descend into statement / value inputs first, in input-list order.
      for (const input of block.inputList) {
        const conn = input.connection;
        if (conn) {
          const target = conn.targetBlock();
          if (target) visit(target);
        }
      }
      // Then continue along the next-connection chain.
      const nextConn = block.nextConnection;
      if (nextConn) {
        const next = nextConn.targetBlock();
        if (next) visit(next);
      }
    };
    const topBlocks = this.workspace.getTopBlocks(true);
    for (const top of topBlocks) {
      visit(top);
    }
    return result;
  }

  /**
   * Push the action-menu sub-scan for `block`, anchored adjacent to it.
   *
   * Item set is determined here, not statically:
   * - `Select` and `Delete` are always present.
   * - `Edit` is conditional on the block having at least one editable
   * `Blockly.FieldDropdown` (v1 limitation: if there are multiple
   * editable dropdowns, we'll edit the FIRST one — see
   * {@link findFirstEditableDropdown}; multi-field handling is a
   * later-phase enhancement).
   * - `Move` (Phase 3 Step 1) is conditional on the block having at
   * least one valid alternative connection on the workspace — see
   * {@link hasValidAlternativeConnections}. If there's nowhere else
   * the block could go, entering move mode would just leave the user
   * stuck cycling candidates that don't exist, so we hide the option
   * entirely (matches the design doc instruction "skip this option").
   *
   * Order is `[Select, Edit, Move, Delete]` per the design doc —
   * Move sits between Edit and Delete so the most-destructive option
   * stays at the bottom of the menu where mis-selects are less likely.
   *
   * `topLevelIndex` is inherited from the workspace blocks frame — by
   * design every action (Select / Edit / Delete) pops straight back to
   * the top-level frame (advancing to the next region), and the
   * sentinel pops back to the same workspace region so the user can
   * pick a different block. This keeps the "you committed an action"
   * boundary visually obvious and avoids the staleness problem after
   * Delete.
   *
   * @param block
   * @param topLevelIndex
   */
  private enterActionMenu(
    block: Blockly.BlockSvg,
    topLevelIndex: number,
  ): void {
    const items: ActionItem[] = [{key: 'select', label: 'Select'}];
    if (this.findFirstEditableDropdown(block)) {
      items.push({key: 'edit', label: 'Edit'});
    }
    if (this.hasValidAlternativeConnections(block)) {
      items.push({key: 'move', label: 'Move'});
    }
    items.push({key: 'delete', label: 'Delete'});

    this.frameStack.push({
      kind: 'action-menu',
      block,
      items,
      index: 0,
      topLevelIndex,
    });
    this.renderActionMenu(block, items);
    this.renderHighlight();
  }

  /**
   * Push the dropdown-values sub-scan for `field` on `block`. Selecting
   * an option calls `field.setValue(option[1])` and pops all the way to
   * top. The action-menu overlay is torn down at the same time so the
   * dropdown menu is the only visible overlay while editing.
   *
   * @param block
   * @param field
   * @param topLevelIndex
   */
  private enterDropdownValues(
    block: Blockly.BlockSvg,
    field: Blockly.FieldDropdown,
    topLevelIndex: number,
  ): void {
    // FieldDropdown.getOptions returns MenuOption[] where each option
    // is `[labelOrImage, value]`. We narrow to the subset our renderer
    // can display (string label OR image-object label) and drop any
    // 'separator' entries — separators don't appear in the maze game's
    // own dropdowns but the type allows them in general.
    const raw = field.getOptions(false);
    const options: Array<
      [string | {src: string; width: number; height: number; alt: string}, string]
    > = [];
    for (const opt of raw) {
      if (opt === 'separator') continue;
      const [label, value] = opt as [unknown, string];
      if (typeof label === 'string') {
        options.push([label, value]);
      } else if (
        label &&
        typeof label === 'object' &&
        'src' in (label as object)
      ) {
        const img = label as {
          src: string;
          width: number;
          height: number;
          alt: string;
        };
        options.push([img, value]);
      } else {
        // HTMLElement labels (rare): mirror Blockly's own getText_ for
        // FieldDropdown — prefer title, then ariaLabel, then innerText —
        // so the menu row shows something readable instead of the
        // default `[object HTMLDivElement]` you'd get from String(label).
        let text = '';
        if (label && typeof label === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyLabel = label as any;
          text =
            (typeof anyLabel.title === 'string' && anyLabel.title) ||
            (typeof anyLabel.ariaLabel === 'string' && anyLabel.ariaLabel) ||
            (typeof anyLabel.innerText === 'string' && anyLabel.innerText) ||
            (typeof anyLabel.textContent === 'string' && anyLabel.textContent) ||
            '';
        }
        options.push([text || value, value]);
      }
    }

    // Tear down the action menu so only the dropdown overlay is visible
    // while the user picks a value. The action-menu frame is still on
    // the stack underneath (so popping the dropdown frame surfaces it
    // again in code), but visually we replace one overlay with another.
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;

    this.frameStack.push({
      kind: 'dropdown-values',
      block,
      field,
      options,
      index: 0,
      topLevelIndex,
    });
    this.renderDropdownMenu(block, options);
    this.renderHighlight();
  }

  /**
   * Find the first editable `Blockly.FieldDropdown` on `block`, scanning
   * inputs in `inputList` order, fields in `fieldRow` order. Returns
   * `null` if none. v1 limitation: blocks with multiple editable
   * dropdowns only expose the first to the Edit flow — adequate for the
   * current maze blocks (`maze_turn`'s `DIR`, `maze_if`'s `DIR`,
   * `maze_repeatTimes`'s `TIMES`, etc., each have exactly one).
   *
   * @param block
   */
  private findFirstEditableDropdown(
    block: Blockly.BlockSvg,
  ): Blockly.FieldDropdown | null {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (
          field instanceof Blockly.FieldDropdown &&
          // EDITABLE is a static-ish boolean Blockly sets per-field
          // class; cast is needed because the public typing exposes it
          // as a class-level prop, not an instance-readable one.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (field as any).EDITABLE !== false
        ) {
          return field;
        }
      }
    }
    return null;
  }

  /**
   * Decide whether the action menu's "Move" entry should be shown for
   * `block`. True iff at least one of `block`'s own connections could
   * legally connect to at least one connection on some OTHER block on
   * the workspace (excluding `block`'s own descendants — they move with
   * it, so they aren't valid attachment targets).
   *
   * Mirrors the same predicate used by the maze game's normal-mode
   * move-hint code in `index.ts` (`hasValidConnections`). Duplicating
   * the logic instead of importing keeps the controller a self-
   * contained, lazily-loaded module and avoids reaching across to
   * top-level page glue from inside a sub-feature.
   *
   * @param block
   */
  private hasValidAlternativeConnections(block: Blockly.BlockSvg): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localConnections = (block as any).getConnections_?.(false) as
      | Blockly.Connection[]
      | undefined;
    if (!localConnections || localConnections.length === 0) return false;

    const movingDescendants = block.getDescendants(true) as Blockly.BlockSvg[];
    const movingSet = new Set(movingDescendants);
    const allWorkspaceConnections: Blockly.Connection[] = [];
    for (const b of this.workspace.getAllBlocks(false)) {
      if (movingSet.has(b as Blockly.BlockSvg)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conns = (b as any).getConnections_?.(false) as Blockly.Connection[] | undefined;
      if (conns) allWorkspaceConnections.push(...conns);
    }
    if (allWorkspaceConnections.length === 0) return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectionChecker = (this.workspace as any).connectionChecker as
      | {
          canConnect(
            a: Blockly.Connection,
            b: Blockly.Connection,
            isDragging: boolean,
            distance: number,
          ): boolean;
        }
      | undefined;
    if (!connectionChecker) return false;

    for (const local of localConnections) {
      for (const ws of allWorkspaceConnections) {
        const sourceBlock = ws.getSourceBlock();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!sourceBlock || (sourceBlock as any).isInsertionMarker?.()) continue;
        // Only check directions where `block` would attach TO another
        // block (matches the normal-mode helper's filter — keeps Move
        // from showing on a block that's already at the end of a stack
        // and only has next-statement connections that nothing in the
        // workspace can attach to).
        const isValidDirection =
          (local.type === Blockly.ConnectionType.OUTPUT_VALUE &&
            ws.type === Blockly.ConnectionType.INPUT_VALUE) ||
          (local.type === Blockly.ConnectionType.PREVIOUS_STATEMENT &&
            ws.type === Blockly.ConnectionType.NEXT_STATEMENT) ||
          (local.type === Blockly.ConnectionType.NEXT_STATEMENT &&
            ws.type === Blockly.ConnectionType.PREVIOUS_STATEMENT);
        if (!isValidDirection) continue;
        if (connectionChecker.canConnect(local, ws, true, Infinity)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Hand off to Blockly's keyboard move mode and push our own
   * `move-candidates` frame so subsequent switch input drives Blockly's
   * candidate traversal / commit / abort.
   *
   * Why route through `ShortcutRegistry` rather than reaching into the
   * `Mover` directly: the maze game holds only a `KeyboardNavigation`
   * handle (no public accessor for `Mover` / `MoveActions`), and the
   * spec is to use ONLY public-API entry points. The `start_move`
   * shortcut is the same code path Blockly's `M` key uses, so we
   * inherit its preconditions (focus on workspace, no other move in
   * flight, draggable is movable) and its keyboard-navigation activation
   * (`keyboardNavigationController.setIsActive(true)`) for free.
   *
   * Priming: we focus the block AND set the workspace cursor to it so
   * `getCurrentDraggable(workspace)` (which looks at
   * `workspace.getCursor().getSourceBlock()`) returns this exact block
   * when the shortcut runs. Without this priming the shortcut would
   * fall through to whatever block last held focus.
   *
   * @param block
   * @param topLevelIndex
   */
  private enterMoveCandidates(
    block: Blockly.BlockSvg,
    topLevelIndex: number,
  ): void {
    // Tear down the action menu first so the move-mode menu doesn't
    // visually stack on top of it.
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;

    // Prime focus + cursor so start_move targets THIS block. Both calls
    // are needed: Blockly's NavigationController activation flips into
    // accessibility mode (via the start_move callback) and reads the
    // current cursor; the focus call also moves the workspace focus tree
    // so `getState()` reports WORKSPACE.
    try {
      Blockly.getFocusManager().focusNode(block);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.workspace as any).getCursor?.()?.setCurNode?.(block);
    } catch (err) {
      console.warn('[switch-scan] move-mode focus priming failed:', err);
      this.popToSameRegion(topLevelIndex);
      return;
    }

    const started = this.invokeShortcut('start_move');
    if (!started) {
      // Could not enter move mode — workspace state didn't satisfy
      // `canMove` (e.g. workspace lost focus mid-call) or the shortcut
      // wasn't registered. Bail without leaving residual state.
      console.warn('[switch-scan] start_move did not begin a move');
      this.popToSameRegion(topLevelIndex);
      return;
    }

    const items: MoveCandidatesItem[] = [
      {key: 'next', label: 'Next'},
      {key: 'place', label: 'Place'},
    ];
    this.frameStack.push({
      kind: 'move-candidates',
      block,
      items,
      index: 0,
      topLevelIndex,
    });
    this.renderMoveMenu(block, items);
    this.renderHighlight();
  }

  /**
   * Step Blockly's move-mode candidate cursor to the next valid
   * connection. We use `move_down_constrained` (the same shortcut bound
   * to Down arrow during normal-keyboard move mode) because its
   * traversal walks `allConnections` in index order with wraparound,
   * which is the right "advance through candidates" semantic for a
   * single advance switch.
   */
  private stepMoveCandidate(): void {
    if (!this.invokeShortcut('move_down_constrained')) {
      console.warn('[switch-scan] move_down_constrained did not run');
    }
  }

  /**
   * Commit the in-flight move at the currently-previewed candidate.
   * Mirrors what `Enter` does during Blockly's normal keyboard move.
   */
  private commitMoveAtCurrentCandidate(): void {
    if (!this.invokeShortcut('finish_move')) {
      console.warn('[switch-scan] finish_move did not run');
    }
  }

  /**
   * Abort the in-flight move if one is active. Safe to call when no
   * move is in progress (the shortcut's `preconditionFn` makes it a
   * no-op in that case). Used by:
   *  - the move-candidates sentinel handler (user-initiated abort),
   *  - `tearDownOverlaysForRun` (a pause-during-run guard so a partial
   *    move doesn't leave Blockly's drag strategy patched),
   *  - `disable()` (clean controller shutdown).
   */
  private cancelActiveMoveIfAny(): void {
    this.invokeShortcut('abort_move');
  }

  /**
   * Invoke a named shortcut from Blockly's `ShortcutRegistry` against
   * this controller's workspace. Returns true iff the shortcut existed,
   * its preconditionFn (if any) passed, AND its callback ran. We don't
   * synthesize a real `KeyboardEvent` here — the move-mode shortcut
   * callbacks all ignore the event/scope arguments and only read the
   * workspace, so an empty fake event is sufficient.
   *
   * @param name
   */
  private invokeShortcut(name: string): boolean {
    const registry = Blockly.ShortcutRegistry.registry.getRegistry();
    const shortcut = registry[name];
    if (!shortcut || !shortcut.callback) return false;
    try {
      if (shortcut.preconditionFn && !shortcut.preconditionFn(this.workspace, {})) {
        return false;
      }
      return !!shortcut.callback(
        this.workspace,
        // The move-mode callbacks never read the event; an empty
        // synthetic KeyboardEvent satisfies the type without
        // triggering any DOM side-effects.
        new KeyboardEvent('keydown'),
        shortcut,
        {workspace: this.workspace},
      );
    } catch (err) {
      console.warn(`[switch-scan] shortcut "${name}" threw:`, err);
      return false;
    }
  }

  /**
   * (Re)build the action-menu overlay DOM and anchor it adjacent to
   * `block`. We rebuild on every entry rather than keeping a long-lived
   * element so the item list can change per block (Edit is conditional).
   *
   * Anchoring heuristic: default below-left of the block; if that would
   * overflow the viewport bottom, switch to right-of the block. Simple
   * two-fallback rule is enough for the maze game's compact layout.
   *
   * @param block
   * @param items
   */
  private renderActionMenu(
    block: Blockly.BlockSvg,
    items: ActionItem[],
  ): void {
    this.actionMenuEl?.remove();
    const el = document.createElement('div');
    el.className = 'switch-scan-action-menu';
    for (let i = 0; i < items.length; i++) {
      const row = document.createElement('div');
      row.className = 'switch-scan-menu-item';
      row.setAttribute('data-scan-action-item', String(i));
      row.textContent = items[i].label;
      el.appendChild(row);
    }
    document.body.appendChild(el);
    this.actionMenuEl = el;
    this.anchorMenuToBlock(el, block);
  }

  /**
   * (Re)build the move-candidates overlay DOM ("Next" / "Place") and
   * anchor it next to `block`. Reuses the action-menu CSS class for
   * styling consistency so the two overlays look like siblings rather
   * than visually competing widgets. The candidate-connection itself
   * is highlighted by Blockly's own move-mode preview, so this overlay
   * just hosts the "which switch action did the user pick" affordance.
   *
   * @param block
   * @param items
   */
  private renderMoveMenu(
    block: Blockly.BlockSvg,
    items: MoveCandidatesItem[],
  ): void {
    this.moveMenuEl?.remove();
    const el = document.createElement('div');
    // Share the action-menu class for visual consistency; an extra
    // marker class lets us narrow CSS overrides later if needed.
    el.className = 'switch-scan-action-menu switch-scan-move-menu';
    for (let i = 0; i < items.length; i++) {
      const row = document.createElement('div');
      row.className = 'switch-scan-menu-item';
      row.setAttribute('data-scan-move-item', String(i));
      row.textContent = items[i].label;
      el.appendChild(row);
    }
    document.body.appendChild(el);
    this.moveMenuEl = el;
    this.anchorMenuToBlock(el, block);
  }

  /**
   * (Re)build the dropdown-values overlay DOM and anchor it adjacent to
   * `block`. Image options render as `<img>` so direction arrows etc.
   * show pictographically; string options render as text.
   *
   * @param block
   * @param options
   */
  private renderDropdownMenu(
    block: Blockly.BlockSvg,
    options: Array<
      [string | {src: string; width: number; height: number; alt: string}, string]
    >,
  ): void {
    this.dropdownMenuEl?.remove();
    const el = document.createElement('div');
    el.className = 'switch-scan-dropdown-menu';
    for (let i = 0; i < options.length; i++) {
      const row = document.createElement('div');
      row.className = 'switch-scan-menu-item';
      row.setAttribute('data-scan-dropdown-item', String(i));
      const label = options[i][0];
      if (typeof label === 'string') {
        row.textContent = label;
      } else {
        const img = document.createElement('img');
        img.src = label.src;
        img.width = label.width;
        img.height = label.height;
        img.alt = label.alt;
        row.appendChild(img);
      }
      el.appendChild(row);
    }
    document.body.appendChild(el);
    this.dropdownMenuEl = el;
    this.anchorMenuToBlock(el, block);
  }

  /**
   * Position `menuEl` (fixed-positioned by CSS) adjacent to `block`.
   * Default: just below the block, left-aligned. Fallback: if the menu
   * would overflow the viewport bottom, anchor to the right of the
   * block instead.
   *
   * @param menuEl
   * @param block
   */
  private anchorMenuToBlock(
    menuEl: HTMLElement,
    block: Blockly.BlockSvg,
  ): void {
    // Use the single-block viewport rect (not `getSvgRoot().getBoundingClientRect()`):
    // the SVG `<g>` root visually contains the entire connected stack, so
    // anchoring off it drops the menu at the bottom of the chain instead of
    // directly below the block being acted on. The helper returns null only
    // when the block has no rendered SVG root — same guard as before.
    const r = this.getSingleBlockViewportRect(block);
    if (!r) return;
    // Measure menu after appending so the fallback heuristic has real
    // dimensions to compare against the viewport.
    const menuRect = menuEl.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const wouldOverflowBottom = r.bottom + 8 + menuRect.height > viewportH;
    if (wouldOverflowBottom) {
      menuEl.style.top = `${r.top}px`;
      menuEl.style.left = `${r.right + 8}px`;
    } else {
      menuEl.style.top = `${r.bottom + 8}px`;
      menuEl.style.left = `${r.left}px`;
    }
  }

  /**
   * Find the visible `[data-scan-item]` descendants of the named
   * `[data-scan-region="<regionName>"]` wrapper in DOM order.
   *
   * Visibility filter handles:
   * - `display: none` and the `.hidden` class (both null out
   * `offsetParent` on non-fixed elements). Confirmed against
   * `maze.css` — e.g. `#ghostRunButton.hidden { display: none }` —
   * so the ghost-run button is correctly dropped on levels where
   * it isn't enabled.
   * - Zero-width layouts (collapsed flex containers, etc.).
   *
   * Returns `[]` if the region wrapper itself is missing.
   *
   * @param regionName
   */
  private discoverDomRegionItems(regionName: string): HTMLElement[] {
    const regionEl = document.querySelector<HTMLElement>(
      `[data-scan-region="${regionName}"]`,
    );
    if (!regionEl) return [];
    const nodeList = regionEl.querySelectorAll<HTMLElement>('[data-scan-item]');
    const items: HTMLElement[] = [];
    nodeList.forEach((el) => {
      // offsetParent === null catches display:none and .hidden;
      // width === 0 catches collapsed / unmeasured layouts.
      if (el.offsetParent === null) return;
      if (el.getBoundingClientRect().width === 0) return;
      items.push(el);
    });
    return items;
  }
}
