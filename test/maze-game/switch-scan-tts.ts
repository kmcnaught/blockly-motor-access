/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan TTS helper.
 *
 * Thin wrapper around the Web Speech API used to read the currently
 * highlighted scan item aloud each time the user advances or selects.
 * The implementation is deliberately tiny — most of the policy
 * (when to speak, what string to say) lives in the controller; this
 * module owns the "only the most recent label is audible" contract,
 * the trailing debounce that absorbs rapid cycling, and the feature
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
 *    AND drops any pending debounced label so the voice goes quiet
 *    immediately.
 *  - On every scan-advance / sub-scan-entry, the controller calls
 *    {@link SwitchScanTts#speak} with the freshly-derived label. The
 *    contract is "only the most recent label is ever audible"; we
 *    uphold it with a trailing debounce: every call restarts a single
 *    timer with the latest label, and the dispatch to the synthesizer
 *    only happens once the user has been quiet for DEBOUNCE_MS. On
 *    rapid cycling this means nothing is spoken until cycling settles,
 *    and then the final label is announced once. Chrome's TTS pipeline
 *    needs ~100-300ms to produce audio for a fresh utterance, so a
 *    naive "fire immediately then throttle" scheme ends up cancelling
 *    every utterance before any sound comes out — the debounce avoids
 *    that cancel storm entirely. An empty label is treated as
 *    "silence now" and bypasses the debounce so the previous utterance
 *    doesn't outlive its highlight.
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
 * Callers don't need to know about the trailing-debounce policy, the
 * cancel-and-replace guard, or the feature detection — all three are
 * handled here.
 */
export class SwitchScanTts {
  /**
   * Quiet period, in milliseconds, that must elapse after the most
   * recent {@link SwitchScanTts#speak} call before the pending label
   * is actually dispatched to the synthesizer. Sized to:
   *  - Absorb rapid switch cycling (deliberate presses typically land
   *    80-200ms apart) so intermediate items don't produce audio.
   *  - Stay short enough that a single deliberate press feels
   *    responsive — the 150ms delay is well below the ~250ms threshold
   *    where perceived latency starts to feel laggy.
   *  - Avoid the cancel+speak churn that wedges Chrome's TTS engine
   *    when utterances are dispatched faster than the engine can
   *    produce audio for them.
   */
  private static readonly DEBOUNCE_MS = 150;

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
   * Label waiting to be dispatched when the debounce timer fires, or
   * `null` when nothing is queued. Each {@link SwitchScanTts#speak}
   * call overwrites this with the latest label and (re)arms the
   * timer, so the final value wins on rapid cycling.
   */
  private pendingLabel: string | null = null;

  /**
   * Handle for the scheduled dispatch of {@link pendingLabel}, or
   * `null` when no dispatch is pending. Cleared on
   * cancel() / setEnabled(false) so a disabled or reset scanner can't
   * suddenly speak the last queued label.
   */
  private pendingFlushHandle: number | null = null;

  constructor() {
    // Feature-detect once. Some embedded WebViews don't expose this
    // at all; older browsers expose it but throw on construction of
    // SpeechSynthesisUtterance (caught in dispatchSpeak's try/catch).
    // The most common no-support case is "property missing entirely",
    // so a simple typeof check is enough here.
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
   * "only the most recent label is audible" via a trailing debounce:
   *
   *  - Every call stores `label` as the pending value and (re)arms a
   *    single timer for {@link DEBOUNCE_MS}. Rapid-fire callers end
   *    up pushing the dispatch out until they settle; only the final
   *    label is ever handed to the synthesizer.
   *  - When the timer finally fires, it dispatches the pending label.
   *    If an older utterance is still speaking at that point (e.g. a
   *    prior settle whose audio hasn't finished), it is cancelled
   *    before the new one speaks. The cancel is guarded by a
   *    `speaking || pending` check because an idle-state cancel has
   *    been observed to wedge Chrome's synthesizer under high churn.
   *
   * An empty/whitespace label is treated as "silence now": it cancels
   * any in-flight utterance AND drops any pending debounced label,
   * then returns without scheduling anything. This bypasses the
   * debounce on purpose — the previous label's audio must not
   * outlive its highlight.
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
      // debounced label must be dropped so it doesn't fire after the
      // highlight has moved on.
      this.cancelCurrentAndPending();
      return;
    }
    this.pendingLabel = trimmed;
    if (this.pendingFlushHandle !== null) {
      window.clearTimeout(this.pendingFlushHandle);
    }
    this.pendingFlushHandle = window.setTimeout(() => {
      this.pendingFlushHandle = null;
      const next = this.pendingLabel;
      this.pendingLabel = null;
      // Enabled recheck is load-bearing: the user can toggle audio off
      // during the 150ms window. `synth` is readonly and already proven
      // non-null by the entry guard in speak(), so no need to recheck.
      if (next !== null && this.enabled) {
        this.dispatchSpeak(next);
      }
    }, SwitchScanTts.DEBOUNCE_MS);
  }

  /**
   * Fire the utterance now. Caller is responsible for debounce
   * bookkeeping; this just talks to the synth.
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
   * Cancel any in-progress utterance AND drop any debounced label
   * that was waiting to be dispatched. Safe to call when nothing is
   * currently speaking, when nothing is pending, or when TTS is
   * disabled / unsupported — all paths treat it as a no-op.
   *
   * The pending-label drop is important: without it, a cancel()
   * triggered by run-start or setEnabled(false) could still be
   * followed, up to DEBOUNCE_MS later, by a stale utterance that the
   * debounce had armed just before shutdown.
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
