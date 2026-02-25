/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dialog class using native <dialog> element
 * Handles show/hide, focus management, and event listeners
 */
export class Dialog {
  /**
   * @param {string} elementId - ID of the dialog element
   * @param {Object} options - Configuration options
   * @param {boolean} [options.closeOnEscape=true] - Close dialog when ESC key is pressed
   * @param {boolean} [options.closeOnBackdropClick=true] - Close dialog when clicking the backdrop
   * @param {string} [options.focusSelector=''] - CSS selector for element to focus when dialog opens
   * @param {Function} [options.onClose] - Callback when dialog closes
   */
  constructor(elementId, options = {}) {
    const element = document.getElementById(elementId);
    if (!element || !(element instanceof HTMLDialogElement)) {
      throw new Error(`Dialog element with id "${elementId}" not found or is not a <dialog> element`);
    }

    this.dialogElement = element;
    this.options = {
      closeOnEscape: options.closeOnEscape ?? true,
      closeOnBackdropClick: options.closeOnBackdropClick ?? true,
      focusSelector: options.focusSelector ?? '',
      onClose: options.onClose ?? (() => {})
    };
    this.abortController = null;
    this.previousActiveElement = null;
  }

  /**
   * Opens the dialog and sets up event listeners
   */
  show() {
    // Store currently focused element to restore later
    this.previousActiveElement = document.activeElement;

    // Open dialog using native showModal (centers and creates backdrop)
    this.dialogElement.showModal();

    // Set up event listeners with AbortController for easy cleanup
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Handle ESC key via native cancel event
    if (this.options.closeOnEscape) {
      this.dialogElement.addEventListener('cancel', (e) => {
        e.preventDefault(); // Prevent default behavior
        this.hide();
      }, { signal });
    }

    // Handle backdrop clicks (click on dialog element itself, not its children)
    if (this.options.closeOnBackdropClick) {
      this.dialogElement.addEventListener('click', (e) => {
        // Only close if clicking the dialog element itself (backdrop)
        if (e.target === this.dialogElement) {
          this.hide();
        }
      }, { signal });
    }

    // Focus the specified element if provided
    if (this.options.focusSelector) {
      const focusElement = this.dialogElement.querySelector(this.options.focusSelector);
      if (focusElement) {
        // Use setTimeout to ensure focus happens after dialog opens
        setTimeout(() => focusElement.focus(), 0);
      }
    }
  }

  /**
   * Closes the dialog and cleans up event listeners
   */
  hide() {
    // Clean up event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Close dialog
    this.dialogElement.close();

    // Restore focus to previous element
    if (this.previousActiveElement instanceof HTMLElement) {
      this.previousActiveElement.focus();
      this.previousActiveElement = null;
    }

    // Call onClose callback
    this.options.onClose();
  }

  /**
   * Check if dialog is currently open
   * @returns {boolean}
   */
  isOpen() {
    return this.dialogElement.open;
  }
}
