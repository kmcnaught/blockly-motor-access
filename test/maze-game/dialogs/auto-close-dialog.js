/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dialog } from './dialog.js';

/**
 * AutoCloseDialog extends Dialog with auto-close timer functionality
 */
export class AutoCloseDialog extends Dialog {
  /**
   * @param {string} elementId - ID of the dialog element
   * @param {Object} options - Configuration options
   * @param {number} [options.duration=5000] - Auto-close duration in milliseconds
   * @param {string} [options.progressBarSelector=''] - CSS selector for progress bar element
   * @param {Function} [options.onAutoClose] - Callback when timer expires and dialog auto-closes
   * @param {...*} options.rest - Other options from Dialog class
   */
  constructor(elementId, options = {}) {
    super(elementId, options);

    this.defaultDuration = options.duration ?? 5000;
    this.progressBarSelector = options.progressBarSelector ?? '';
    this.onAutoClose = options.onAutoClose ?? (() => {});
    this.autoCloseTimer = null;
  }

  /**
   * Opens the dialog and starts auto-close timer
   * @param {number} [duration] - Optional duration override in milliseconds
   */
  show(duration) {
    // Call parent show
    super.show();

    // Use provided duration or default
    const actualDuration = duration ?? this.defaultDuration;

    // Set up progress bar animation if selector provided
    if (this.progressBarSelector) {
      const progressBar = this.dialogElement.querySelector(this.progressBarSelector);
      if (progressBar) {
        // Reset animation on the parent button (CSS targets .ok-button.countdown)
        const countdownTarget = progressBar.parentElement ?? progressBar;
        countdownTarget.classList.remove('countdown');
        // Force reflow to restart animation
        void countdownTarget.offsetWidth;
        // Set duration and start animation
        progressBar.style.animationDuration = `${actualDuration}ms`;
        countdownTarget.classList.add('countdown');
      }
    }

    // Start auto-close timer
    this.autoCloseTimer = setTimeout(() => {
      this.onAutoClose();
      this.hide();
    }, actualDuration);
  }

  /**
   * Closes the dialog and clears the auto-close timer
   */
  hide() {
    // Clear timer if running
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    // Clear progress bar animation
    if (this.progressBarSelector) {
      const progressBar = this.dialogElement.querySelector(this.progressBarSelector);
      if (progressBar) {
        (progressBar.parentElement ?? progressBar).classList.remove('countdown');
      }
    }

    // Call parent hide
    super.hide();
  }
}
