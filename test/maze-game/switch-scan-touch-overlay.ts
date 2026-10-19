/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Entry countdown overlay and persistent corner
 * indicator for touch-switch mode.
 *
 * showTouchModeEntryOverlay(): called at page load when switch access
 * is enabled AND input mode is touch. Renders a full-screen overlay
 * with a single large Cancel button containing a 3→2→1 countdown.
 * Resolves to `'cancelled'` if the user taps during the countdown
 * (host should then disable switch access + reopen settings), or
 * `'entered'` if the countdown completes untouched (host should then
 * activate touch mode).
 *
 * The Cancel button is the ONLY interactive target on the overlay;
 * touches elsewhere on the overlay are swallowed (preventDefault) but
 * don't count as cancels. This matches the design decision: big
 * obvious target = clear agency, non-target touches = no accidental
 * cancel.
 *
 * showTouchModeIndicator(): small top-right chip shown while touch
 * mode is active. Visual-only — mode exit is via refreshing the page.
 * Call `hide()` on the returned handle to remove it when touch mode
 * exits.
 */

/** Default countdown duration (ms) before auto-entry. */
const COUNTDOWN_MS = 3000;

/** How often to update the countdown display. */
const TICK_MS = 50;

/** Result of the entry-countdown prompt. */
export type EntryOutcome = 'entered' | 'cancelled';

/**
 * Show the full-screen entry countdown overlay. Resolves when the
 * user cancels (tap the big button) or the countdown completes.
 *
 * The overlay is removed from the DOM before the promise resolves,
 * so the caller can proceed with mode activation / settings reopen
 * without worrying about overlay cleanup.
 */
export function showTouchModeEntryOverlay(): Promise<EntryOutcome> {
  return new Promise((resolve) => {
    // Use a native <dialog> + showModal() so the overlay joins the
    // browser's top layer. A z-indexed div loses to any other
    // showModal()-opened dialog that fires after us (e.g. the stage
    // intro dialog on its 500ms boot timer).
    const overlay = document.createElement('dialog');
    overlay.className = 'switch-touch-entry-overlay';
    overlay.setAttribute('aria-label', 'Touch-switch mode starting');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'switch-touch-entry-cancel';
    button.setAttribute('aria-label', 'Cancel starting touch mode');

    const label = document.createElement('span');
    label.className = 'switch-touch-entry-label';
    label.textContent = 'Touch mode starting';

    const countdown = document.createElement('span');
    countdown.className = 'switch-touch-entry-countdown';

    const hint = document.createElement('span');
    hint.className = 'switch-touch-entry-hint';
    hint.textContent = 'Tap to cancel';

    button.append(label, countdown, hint);
    overlay.append(button);
    document.body.append(overlay);
    overlay.showModal();

    const startedAt = performance.now();
    let settled = false;
    let tickHandle: number | null = null;

    const finish = (outcome: EntryOutcome) => {
      if (settled) return;
      settled = true;
      if (tickHandle != null) {
        window.clearInterval(tickHandle);
        tickHandle = null;
      }
      overlay.remove();
      resolve(outcome);
    };

    const render = () => {
      const remainingMs = COUNTDOWN_MS - (performance.now() - startedAt);
      if (remainingMs <= 0) {
        countdown.textContent = '0';
        finish('entered');
        return;
      }
      // ceil so the display reads 3 → 2 → 1 across the full window,
      // rather than snapping to 2 the instant we start.
      countdown.textContent = String(Math.ceil(remainingMs / 1000));
    };
    render();
    tickHandle = window.setInterval(render, TICK_MS);

    // Swallow all touch events on the overlay so page gestures don't
    // bleed through (page scroll, pinch-zoom, element pointer). Only
    // the explicit cancel-button click counts.
    const swallow = (e: Event) => {
      // Allow clicks on the cancel button itself to go through.
      if (e.target === button || (e.target as Node)?.parentElement === button) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    overlay.addEventListener('touchstart', swallow, {passive: false});
    overlay.addEventListener('touchmove', swallow, {passive: false});
    overlay.addEventListener('touchend', swallow, {passive: false});

    button.addEventListener('click', () => finish('cancelled'));
    // Native <dialog> fires `cancel` on ESC and auto-closes. Route it
    // through finish('cancelled') so the promise resolves, the
    // countdown interval is cleared, and the host runs the same
    // cancel branch it would from a button tap. preventDefault keeps
    // the dialog from auto-closing before finish() tears it down.
    overlay.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish('cancelled');
    });
  });
}

/**
 * Prompt shown mid-session when the user enables switch access while
 * input mode is already set to Touch. Touch mode activation is only
 * safe at boot (it swaps out pointer-events + attaches document-level
 * listeners before Blockly initialises its gesture handling), so a
 * mid-session enable has to defer to the next refresh.
 *
 * Two buttons: OK (dismiss, user can refresh later) and Refresh
 * (reload the page immediately). Resolves once dismissed; the caller
 * doesn't need to differentiate — OK already does nothing beyond
 * closing, Refresh ends the page before the promise is awaited.
 */
export function showTouchModeRefreshPrompt(): Promise<void> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'switch-touch-refresh-prompt';
    dialog.setAttribute('aria-label', 'Refresh to start touch mode');

    const title = document.createElement('h2');
    title.className = 'switch-touch-refresh-title';
    title.textContent = 'Refresh to start touch mode';

    const body = document.createElement('p');
    body.className = 'switch-touch-refresh-body';
    body.textContent =
      'Touch-based switch access is loaded when the page starts. Refresh the page to begin.';

    const buttons = document.createElement('div');
    buttons.className = 'switch-touch-refresh-buttons';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'switch-touch-refresh-ok';
    okBtn.textContent = 'Continue editing settings';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'switch-touch-refresh-reload';
    refreshBtn.textContent = 'Refresh now';

    buttons.append(okBtn, refreshBtn);
    dialog.append(title, body, buttons);
    document.body.append(dialog);
    dialog.showModal();

    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    okBtn.addEventListener('click', finish);
    refreshBtn.addEventListener('click', () => {
      window.location.reload();
      // Defensive: if the browser's "Leave site?" prompt is cancelled,
      // reload() returns and the modal would otherwise be stuck open
      // with no close path. finish() ensures it tears down either way.
      finish();
    });
  });
}

/** Handle for the persistent indicator chip. */
export interface TouchIndicatorHandle {
  /** Remove the indicator from the DOM. */
  hide(): void;
}

/**
 * Show a small persistent chip in the top-right corner while touch
 * mode is active. Visual-only. The user exits touch mode by refreshing
 * the page and tapping Cancel on the entry countdown.
 */
export function showTouchModeIndicator(): TouchIndicatorHandle {
  const chip = document.createElement('div');
  chip.className = 'switch-touch-indicator';
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  chip.textContent = 'Touch mode · refresh to exit';

  document.body.append(chip);

  return {
    hide: () => chip.remove(),
  };
}
