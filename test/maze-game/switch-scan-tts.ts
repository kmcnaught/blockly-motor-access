/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan TTS helper (Phase 5).
 *
 * Thin wrapper around the Web Speech API used to read the currently
 * highlighted scan item aloud each time the user advances or selects.
 * The implementation is deliberately tiny — most of the policy
 * (when to speak, what string to say) lives in the controller; this
 * module just owns the cancel-and-replace contract and the feature
 * detection / enabled-flag bookkeeping.
 *
 * Lifecycle:
 *  - The host page constructs ONE instance at boot, regardless of
 *    whether audio is currently enabled. URL > localStorage > default
 *    ('off') resolution happens in `index.ts` and is passed into
 *    {@link SwitchScanTts#setEnabled} at construction time.
 *  - When the user toggles the audio checkbox in the settings modal,
 *    {@link SwitchScanTts#setEnabled} is called with the new value.
 *    Toggling enabled → disabled CANCELS any in-progress utterance
 *    so the voice goes quiet immediately.
 *  - On every scan-advance / sub-scan-entry, the controller calls
 *    {@link SwitchScanTts#speak} with the freshly-derived label. We
 *    `cancel()` any
 *    in-flight utterance BEFORE queueing the new one — without this,
 *    fast advances would queue a backlog of stale labels that would
 *    keep talking long after the highlight moved on.
 *
 * Browser quirks worth knowing:
 *  - `speechSynthesis.speak` may silently no-op on the FIRST call if
 *    the page hasn't yet received a user gesture. Our first speak is
 *    triggered by the user's first switch press, which qualifies as a
 *    gesture in every browser we care about, so this isn't an issue
 *    in practice — but it's why audio CAN'T fire from a `setEnabled`
 *    call alone if the user toggled the setting via mouse but never
 *    pressed a switch yet.
 *  - Older browsers and some embedded contexts (notably Grid 3's
 *    WebView2 on locked-down machines) may not expose
 *    `window.speechSynthesis` at all. We feature-detect ONCE in the
 *    constructor and quietly degrade to a no-op — the rest of the
 *    switch-scan UI continues to work as if audio were simply off.
 */

/**
 * Controller for switch-scan text-to-speech announcements.
 *
 * Public surface is intentionally minimal: setEnabled / speak / cancel.
 * Callers don't need to know about the cancel-and-replace policy or
 * the feature detection — both are handled here.
 */
export class SwitchScanTts {
  /**
   * True iff the user has opted in to audio AND the browser supports
   * `speechSynthesis`. Combined check so callers can treat `enabled`
   * as the single source of truth for "will speak() actually do
   * anything?"
   */
  private enabled = false;

  /**
   * Cached `window.speechSynthesis` reference, or `null` when
   * unsupported. Set ONCE in the constructor; we never re-feature-
   * detect because the surrounding page reloads on any meaningful
   * change to the runtime.
   */
  private readonly synth: SpeechSynthesis | null;

  constructor() {
    // Feature-detect once. Some embedded WebViews don't expose this at
    // all; older browsers expose it but throw on construction of
    // SpeechSynthesisUtterance. We guard both paths in speak()
    // defensively, but the most common no-support case is "property
    // missing entirely" so a simple typeof check is enough here.
    try {
      this.synth =
        typeof window !== 'undefined' &&
        typeof window.speechSynthesis !== 'undefined'
          ? window.speechSynthesis
          : null;
    } catch (e) {
      // Defensive: some sandboxed contexts throw on the property access.
      this.synth = null;
    }
  }

  /**
   * Toggle audio output on or off. Disabling cancels any in-progress
   * utterance so the voice goes quiet immediately; enabling does NOT
   * replay the last label (the controller can call
   * {@link SwitchScanTts#speak} separately if it wants the user to
   * hear confirmation of the toggle).
   *
   * Idempotent — calling with the current value is a no-op.
   *
   * @param on True to enable audio, false to disable.
   */
  setEnabled(on: boolean): void {
    // No support → permanently disabled. Quietly accept the call so
    // the rest of the wiring doesn't need to branch.
    if (!this.synth) {
      this.enabled = false;
      return;
    }
    if (this.enabled === on) return;
    this.enabled = on;
    // Going dark: cut off any utterance mid-word so the user gets
    // instant feedback that the toggle worked.
    if (!on) {
      this.cancel();
    }
  }

  /**
   * Whether audio is currently enabled AND supported. Exposed so the
   * controller can decide whether to bother computing labels at all
   * for frames it doesn't yet have efficient label derivation for.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Speak `label` using the browser's default voice. Cancels any
   * in-progress utterance first (cancel-and-replace) so a rapid burst
   * of advances doesn't queue a backlog of stale strings — only the
   * most recent label is ever audible.
   *
   * No-op when disabled, when `speechSynthesis` is unsupported, or
   * when `label` is empty/whitespace.
   *
   * @param label Text to speak. Trimmed before being queued.
   */
  speak(label: string): void {
    if (!this.enabled || !this.synth) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      // Cancel-and-replace: clear the queue + any in-flight utterance,
      // then schedule the new one. Without the cancel, fast advances
      // would queue a backlog of stale labels.
      this.synth.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      this.synth.speak(utterance);
    } catch (e) {
      // Defensive: a malformed utterance or a transient browser bug
      // shouldn't break the scanner's main flow. Swallow + log.
      console.warn('[switch-scan-tts] speak failed:', e);
    }
  }

  /**
   * Cancel any in-progress utterance and clear the queue. Safe to
   * call when nothing is currently speaking, or when TTS is disabled
   * / unsupported — the underlying API treats both as no-ops.
   *
   * Used by:
   *  - {@link SwitchScanTts#setEnabled}`(false)` to silence the voice
   *    immediately.
   *  - The controller's run-start pause path (don't keep talking
   *    while the maze animates the user's program).
   *  - The controller's `disable()` so a re-enable doesn't inherit
   *    a half-spoken utterance from the previous session.
   */
  cancel(): void {
    if (!this.synth) return;
    try {
      this.synth.cancel();
    } catch (e) {
      // Same defensive rationale as speak() — never let TTS bugs
      // bubble up into the scanner.
      console.warn('[switch-scan-tts] cancel failed:', e);
    }
  }
}
