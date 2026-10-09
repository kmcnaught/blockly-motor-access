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
 * module owns the "only the most recent label is audible" contract,
 * the throttle that smooths out key-repeat storms, and the feature
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
 *    AND drops any pending throttled label so the voice goes quiet
 *    immediately.
 *  - On every scan-advance / sub-scan-entry, the controller calls
 *    {@link SwitchScanTts#speak} with the freshly-derived label. The
 *    contract is "only the most recent label is ever audible"; we
 *    uphold it by cancelling the in-flight utterance (if any) before
 *    queueing a replacement, and by coalescing bursts via a 100ms
 *    minimum interval between actual speak() calls — a call that
 *    arrives inside the throttle window just updates the pending
 *    label, and the latest value is flushed when the window closes.
 *    An empty label is treated as "silence now" and bypasses the
 *    throttle so the previous utterance doesn't outlive its highlight.
 *
 * Browser quirks worth knowing:
 *  - `speechSynthesis.speak` may silently no-op on the FIRST call if
 *    the page hasn't yet received a user gesture. Our first speak is
 *    triggered by the user's first switch press, which qualifies as a
 *    gesture in every browser we care about, so this isn't an issue
 *    in practice — but it's why audio CAN'T fire from a `setEnabled`
 *    call alone if the user toggled the setting via mouse but never
 *    pressed a switch yet.
 *  - Calling `speechSynthesis.cancel()` when nothing is speaking is
 *    documented as a no-op, but under high churn Chrome has been
 *    observed to leave the synthesizer in a stuck state. We guard the
 *    cancel with a `speaking || pending` check so idle frames don't
 *    poke the engine.
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
 * Callers don't need to know about the speaking-guarded cancel-and-
 * replace policy, the burst-coalescing throttle, or the feature
 * detection — all three are handled here.
 */
export class SwitchScanTts {
  /**
   * Minimum interval, in milliseconds, between actual calls to the
   * underlying `speechSynthesis.speak`. Calls that arrive inside this
   * window don't fire a new utterance; they just overwrite the pending
   * label, which gets flushed when the window closes. Sized to absorb
   * OS key-repeat (typically 30-50ms per repeat) without clipping the
   * perceived responsiveness of a deliberate single press.
   */
  private static readonly THROTTLE_MS = 100;

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

  /**
   * Timestamp (performance.now-ish, from `Date.now()`) of the most
   * recent actual speak dispatched to the synthesizer. Zero means
   * "nothing has fired yet in this session" — the next speak will
   * always be allowed through regardless of the throttle.
   */
  private lastSpeakAt = 0;

  /**
   * Label waiting to be flushed when the throttle window closes, or
   * `null` when nothing is queued. Rapid-fire callers update this
   * directly without touching the synth; the setTimeout dispatched
   * at throttle-start reads the LATEST value here when it fires.
   */
  private pendingLabel: string | null = null;

  /**
   * Handle for the scheduled flush of {@link pendingLabel}, or `null`
   * when no flush is pending. Cleared on cancel() / setEnabled(false)
   * so a disabled or reset scanner can't suddenly speak the last
   * queued label.
   */
  private pendingFlushHandle: number | null = null;

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
   * Speak `label` using the browser's default voice, enforcing
   * "only the most recent label is audible":
   *
   *  - If an utterance is currently speaking or queued, it is cancelled
   *    before the replacement is dispatched. The cancel is skipped when
   *    the synth is idle, because `cancel()` on an idle engine has been
   *    observed to leave Chrome's synthesizer stuck under high churn.
   *  - Calls arriving within {@link THROTTLE_MS} of the last dispatched
   *    speak don't fire immediately; they overwrite a pending label
   *    that is flushed when the window closes. This coalesces OS
   *    key-repeat bursts (which otherwise produce clicks / truncated
   *    syllables) down to a single utterance of the final label.
   *
   * An empty/whitespace label is treated as "silence now": it cancels
   * any in-flight utterance AND drops any pending throttled label, then
   * returns without scheduling anything. This bypasses the throttle on
   * purpose — the previous label's audio must not outlive its highlight.
   *
   * No-op when disabled or when `speechSynthesis` is unsupported.
   *
   * @param label Text to speak. Trimmed before being queued.
   */
  speak(label: string): void {
    if (!this.enabled || !this.synth) return;
    const trimmed = label.trim();
    if (!trimmed) {
      // Empty-label path: the current frame has nothing to announce, so
      // the previous utterance must stop immediately — and any pending
      // throttled label (e.g. a prior speak("A") within the last 100ms
      // whose flush is still armed) must be dropped so it doesn't fire
      // after the highlight has moved on.
      this.cancelCurrentAndPending();
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastSpeakAt;
    if (elapsed < SwitchScanTts.THROTTLE_MS) {
      // Inside the throttle window: just remember the latest label.
      // If a flush is already armed it will pick this up when it fires;
      // otherwise arm one for the remainder of the window.
      this.pendingLabel = trimmed;
      if (this.pendingFlushHandle === null) {
        const delay = SwitchScanTts.THROTTLE_MS - elapsed;
        this.pendingFlushHandle = window.setTimeout(() => {
          this.pendingFlushHandle = null;
          const next = this.pendingLabel;
          this.pendingLabel = null;
          if (next !== null && this.enabled && this.synth) {
            this.dispatchSpeak(next);
          }
        }, delay);
      }
      return;
    }
    this.dispatchSpeak(trimmed);
  }

  /**
   * Fire the utterance now, after guarded cancel-and-replace. Caller
   * is responsible for throttle bookkeeping; this just talks to the
   * synth. Updates {@link lastSpeakAt} on successful dispatch.
   */
  private dispatchSpeak(trimmed: string): void {
    if (!this.synth) return;
    try {
      // Only cancel when there's actually something to cancel: an
      // idle-state cancel is a documented no-op but has been seen to
      // wedge Chrome's synthesizer under high churn.
      if (this.synth.speaking || this.synth.pending) {
        this.synth.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(trimmed);
      this.synth.speak(utterance);
      this.lastSpeakAt = Date.now();
    } catch (e) {
      // Defensive: a malformed utterance or a transient browser bug
      // shouldn't break the scanner's main flow. Swallow + log.
      console.warn('[switch-scan-tts] speak failed:', e);
    }
  }

  /**
   * Internal counterpart to {@link cancel} used by the empty-label
   * path. Kept separate so the public method stays a single clear
   * entry point for external callers.
   */
  private cancelCurrentAndPending(): void {
    if (this.pendingFlushHandle !== null) {
      window.clearTimeout(this.pendingFlushHandle);
      this.pendingFlushHandle = null;
    }
    this.pendingLabel = null;
    if (!this.synth) return;
    try {
      if (this.synth.speaking || this.synth.pending) {
        this.synth.cancel();
      }
    } catch (e) {
      console.warn('[switch-scan-tts] cancel failed:', e);
    }
  }

  /**
   * Cancel any in-progress utterance AND drop any throttled label
   * that was waiting to be flushed. Safe to call when nothing is
   * currently speaking, when nothing is pending, or when TTS is
   * disabled / unsupported — all paths treat it as a no-op.
   *
   * The pending-label drop is important: without it, a cancel()
   * triggered by run-start or setEnabled(false) could still be
   * followed, up to THROTTLE_MS later, by a stale utterance that the
   * throttle had armed just before shutdown.
   *
   * The underlying `speechSynthesis.cancel()` is only invoked when
   * the engine is actually speaking or has queued utterances, since
   * poking an idle engine has been observed to wedge Chrome's
   * synthesizer under high churn.
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
    this.cancelCurrentAndPending();
  }
}
