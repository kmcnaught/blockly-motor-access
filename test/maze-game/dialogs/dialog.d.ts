/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dialog options for configuring behavior
 */
export interface DialogOptions {
  /** Close dialog when ESC key is pressed (default: true) */
  closeOnEscape?: boolean;
  /** Close dialog when clicking the backdrop (default: true) */
  closeOnBackdropClick?: boolean;
  /** CSS selector for element to focus when dialog opens */
  focusSelector?: string;
  /** Callback when dialog closes */
  onClose?: () => void;
}

/**
 * Dialog class using native <dialog> element
 * Handles show/hide, focus management, and event listeners
 */
export class Dialog {
  /**
   * @param elementId - ID of the dialog element
   * @param options - Configuration options
   */
  constructor(elementId: string, options?: DialogOptions);

  /**
   * Opens the dialog and sets up event listeners
   */
  show(): void;

  /**
   * Closes the dialog and cleans up event listeners
   */
  hide(): void;

  /**
   * Check if dialog is currently open
   */
  isOpen(): boolean;
}
