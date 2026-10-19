/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Touch-input adapter for switch-scan.
 *
 * Converts touch gestures into the same logical advance / select
 * actions the keyboard handler dispatches, so a user without physical
 * switches can drive the switch-scan UI with a phone or tablet.
 *
 * Design is 2-switch only (established in the design conversation):
 *  - Swipe left / right (configurable) → Advance
 *  - Tap                                → Select
 *
 * Mode exit is handled by refreshing the page — the entry countdown
 * overlay offers a Cancel button on each boot. There is no in-mode
 * exit gesture.
 *
 * The adapter binds touch listeners at document level (for gesture
 * classification) AND window-level pointer + mouse blockers (to stop
 * Blockly's pointer-based gesture tracking from firing in parallel —
 * Blockly listens for pointer events, not touch events, so touch
 * preventDefault alone isn't enough). Entry/exit is managed by the
 * host (index.ts); this class just classifies gestures and dispatches.
 */

import type {SwitchScanController} from './switch-scan-mode';
import type {TouchSwipeAdvance} from './switch-scan-settings';

/**
 * Threshold for calling horizontal motion a "swipe" vs. a slip during
 * a tap. 40px is enough to filter stationary taps while small enough
 * to be reachable by a user with gross motor control.
 */
const SWIPE_THRESHOLD_PX = 40;

/**
 * Max movement a touch can wander and still be classified as a tap.
 * Beyond this, we discard the gesture rather than guess — easier for
 * the user to try again than to receive a mis-classified action.
 */
const TAP_MOVE_TOLERANCE_PX = 15;

/**
 * Max duration for a touch to count as a tap. Longer than this and
 * we treat the gesture as a hold and ignore it.
 */
const MAX_TAP_MS = 600;

/**
 * Max duration for a horizontal motion to count as a swipe. Slower
 * than this and the user was probably mid-hold, not swiping.
 */
const MAX_SWIPE_MS = 800;

/** Options for constructing the adapter. */
export interface SwitchScanTouchAdapterOptions {
  /** Controller to dispatch logical commands into. */
  controller: SwitchScanController;
  /** Which swipe direction advances scan. */
  swipeAdvance: TouchSwipeAdvance;
  /** When true, verbose console logging for debugging stuck gestures. */
  debug?: boolean;
}

/**
 * Document-level touch adapter. Call `bind()` to attach listeners,
 * `unbind()` to detach. Safe to call `bind()`/`unbind()` repeatedly;
 * each `bind()` tears down any previous listener set first.
 */
export class SwitchScanTouchAdapter {
  private readonly controller: SwitchScanController;
  private swipeAdvance: TouchSwipeAdvance;
  private readonly debug: boolean;

  /** True while a bind is active. */
  private bound = false;

  /** State for the single active touch. Null when nothing is pressed. */
  private activeTouch: {
    identifier: number;
    startX: number;
    startY: number;
    startTime: number;
    maxDist: number;
  } | null = null;

  private readonly boundTouchStart: (e: TouchEvent) => void;
  private readonly boundTouchMove: (e: TouchEvent) => void;
  private readonly boundTouchEnd: (e: TouchEvent) => void;
  private readonly boundTouchCancel: (e: TouchEvent) => void;
  private readonly boundPointerBlocker: (e: PointerEvent) => void;
  private readonly boundMouseBlocker: (e: MouseEvent) => void;

  constructor(options: SwitchScanTouchAdapterOptions) {
    this.controller = options.controller;
    this.swipeAdvance = options.swipeAdvance;
    this.debug = options.debug ?? false;

    this.boundTouchStart = (e) => this.onTouchStart(e);
    this.boundTouchMove = (e) => this.onTouchMove(e);
    this.boundTouchEnd = (e) => this.onTouchEnd(e);
    this.boundTouchCancel = (e) => this.onTouchCancel(e);
    this.boundPointerBlocker = (e) => this.blockEvent(e);
    this.boundMouseBlocker = (e) => this.blockEvent(e);
  }

  /**
   * Universal preventDefault + stopPropagation blocker. Attached to
   * pointer and mouse events on `window` with capture-phase priority
   * so Blockly's gesture tracking (which uses pointer events) never
   * sees the input. Touch events are handled separately — they drive
   * the actual gesture classification.
   */
  private blockEvent(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  /** Attach touch + pointer + mouse listeners. Idempotent. */
  bind(): void {
    if (this.bound) return;
    // Touch listeners drive gesture classification; `passive: false`
    // + capture-phase on document.
    const touchOpts: AddEventListenerOptions = {
      capture: true,
      passive: false,
    };
    document.addEventListener('touchstart', this.boundTouchStart, touchOpts);
    document.addEventListener('touchmove', this.boundTouchMove, touchOpts);
    document.addEventListener('touchend', this.boundTouchEnd, touchOpts);
    document.addEventListener(
      'touchcancel',
      this.boundTouchCancel,
      touchOpts,
    );

    // Pointer + mouse listeners bound on `window` with capture:true so
    // they fire BEFORE any document-level Blockly listener (window
    // comes before document in the capture-phase order). They swallow
    // the events outright — Blockly's drag/select never trips.
    const blockOpts: AddEventListenerOptions = {
      capture: true,
      passive: false,
    };
    window.addEventListener('pointerdown', this.boundPointerBlocker, blockOpts);
    window.addEventListener('pointermove', this.boundPointerBlocker, blockOpts);
    window.addEventListener('pointerup', this.boundPointerBlocker, blockOpts);
    window.addEventListener('pointercancel', this.boundPointerBlocker, blockOpts);
    // NB: deliberately NOT blocking `click`. The switch-scan controller
    // dispatches programmatic `.click()` on scanned items to effect
    // selection; a `click` blocker would break every tap-select.
    // Blocking pointerdown + preventDefault on touchstart already stops
    // user-initiated clicks (compat clicks are suppressed by touch
    // preventDefault), so programmatic .click() is the only path that
    // reaches the target.
    window.addEventListener('mousedown', this.boundMouseBlocker, blockOpts);
    window.addEventListener('mousemove', this.boundMouseBlocker, blockOpts);
    window.addEventListener('mouseup', this.boundMouseBlocker, blockOpts);
    this.bound = true;
  }

  /** Detach listeners and clear any in-flight gesture state. */
  unbind(): void {
    if (!this.bound) return;
    const opts: AddEventListenerOptions = {capture: true};
    document.removeEventListener('touchstart', this.boundTouchStart, opts);
    document.removeEventListener('touchmove', this.boundTouchMove, opts);
    document.removeEventListener('touchend', this.boundTouchEnd, opts);
    document.removeEventListener('touchcancel', this.boundTouchCancel, opts);
    window.removeEventListener('pointerdown', this.boundPointerBlocker, opts);
    window.removeEventListener('pointermove', this.boundPointerBlocker, opts);
    window.removeEventListener('pointerup', this.boundPointerBlocker, opts);
    window.removeEventListener('pointercancel', this.boundPointerBlocker, opts);
    window.removeEventListener('mousedown', this.boundMouseBlocker, opts);
    window.removeEventListener('mousemove', this.boundMouseBlocker, opts);
    window.removeEventListener('mouseup', this.boundMouseBlocker, opts);
    this.activeTouch = null;
    this.bound = false;
  }

  /**
   * Update the swipe-direction config live. Called from the settings
   * `onChange` handler so a user who scans into settings while in
   * touch mode and flips the dropdown sees the change immediately
   * rather than having to refresh.
   */
  setSwipeAdvance(direction: TouchSwipeAdvance): void {
    this.swipeAdvance = direction;
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    // Stop propagation during the capture phase so the touch never
    // reaches Blockly's own touch handlers — otherwise a swipe inside
    // a dropdown or action menu would ALSO trigger that menu's
    // internal "close on gesture" logic and pop us out of the sub-scan.
    e.stopPropagation();
    this.log('touchstart', {
      touches: e.touches.length,
      changed: e.changedTouches.length,
      hasActive: this.activeTouch !== null,
    });
    // Defensive cleanup: if a previous gesture left state behind (lost
    // touchend/cancel, OS gesture steal, listener race), clear it now.
    // Otherwise every subsequent touch would be treated as a second
    // finger and discarded, "sticking" the adapter.
    if (this.activeTouch !== null) {
      this.log('touchstart stale state cleared');
      this.activeTouch = null;
    }
    const touch = e.changedTouches[0];
    if (!touch) return;
    this.activeTouch = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: performance.now(),
      maxDist: 0,
    };
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.activeTouch) return;
    const touch = this.findTouch(e.changedTouches);
    if (!touch) return;
    const dx = touch.clientX - this.activeTouch.startX;
    const dy = touch.clientY - this.activeTouch.startY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.activeTouch.maxDist) this.activeTouch.maxDist = dist;
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.log('touchend', {
      touches: e.touches.length,
      changed: e.changedTouches.length,
      hasActive: this.activeTouch !== null,
    });
    // Always clear state before any early return so an identifier
    // mismatch (e.g. multi-touch confusion) can't leave us stuck.
    const state = this.activeTouch;
    this.activeTouch = null;
    if (!state) return;

    const touch = this.findTouchInList(e.changedTouches, state.identifier);
    if (!touch) {
      this.log('touchend identifier mismatch', {
        wanted: state.identifier,
        got: Array.from({length: e.changedTouches.length}, (_, i) =>
          e.changedTouches.item(i)?.identifier,
        ),
      });
      return;
    }

    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    const dist = Math.hypot(dx, dy);
    const duration = performance.now() - state.startTime;

    // Horizontal swipe: dominant horizontal motion, past threshold,
    // within the swipe time window. If the direction matches the
    // configured advance direction, dispatch advance.
    if (
      Math.abs(dx) >= SWIPE_THRESHOLD_PX &&
      Math.abs(dx) > Math.abs(dy) &&
      duration <= MAX_SWIPE_MS
    ) {
      const direction: TouchSwipeAdvance = dx < 0 ? 'left' : 'right';
      this.log('swipe', {direction, dx, dy, duration});
      if (direction === this.swipeAdvance) {
        const consumed = this.controller.invokeAdvance();
        this.log('advance', {consumed});
      }
      // Swipe in the non-advance direction is ignored. In 2-switch
      // touch there's no third gesture to bind — ignoring is safer
      // than guessing the user meant select.
      return;
    }

    // Tap: short, barely moved.
    if (duration <= MAX_TAP_MS && dist <= TAP_MOVE_TOLERANCE_PX) {
      this.log('tap', {duration, dist});
      const consumed = this.controller.invokeSelect();
      this.log('select', {consumed});
      return;
    }

    // Everything else (slow drift, long swipe past threshold but past
    // the time limit, diagonal etc.) is dropped. Users can retry.
    this.log('gesture discarded', {dx, dy, dist, duration});
  }

  private onTouchCancel(e: TouchEvent): void {
    // Browser-level cancel (e.g. gesture conflict with system UI).
    // Mirror the end-of-gesture cleanup without dispatching anything.
    e.preventDefault();
    e.stopPropagation();
    this.log('touchcancel', {
      touches: e.touches.length,
      changed: e.changedTouches.length,
      hasActive: this.activeTouch !== null,
    });
    this.activeTouch = null;
  }

  private findTouch(list: TouchList): Touch | null {
    if (!this.activeTouch) return null;
    return this.findTouchInList(list, this.activeTouch.identifier);
  }

  private findTouchInList(list: TouchList, identifier: number): Touch | null {
    for (let i = 0; i < list.length; i++) {
      const t = list.item(i);
      if (t && t.identifier === identifier) return t;
    }
    return null;
  }

  private log(label: string, data?: Record<string, unknown>): void {
    if (!this.debug) return;
    if (data) {
      console.log(`[touch-switch] ${label}`, data);
    } else {
      console.log(`[touch-switch] ${label}`);
    }
  }
}
