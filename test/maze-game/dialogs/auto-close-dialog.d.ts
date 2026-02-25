/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dialog, DialogOptions } from './dialog';

/**
 * Options for AutoCloseDialog
 */
export interface AutoCloseDialogOptions extends DialogOptions {
  /** Auto-close duration in milliseconds (default: 5000) */
  duration?: number;
  /** CSS selector for progress bar element */
  progressBarSelector?: string;
  /** Callback when timer expires and dialog auto-closes */
  onAutoClose?: () => void;
}

/**
 * AutoCloseDialog extends Dialog with auto-close timer functionality
 */
export class AutoCloseDialog extends Dialog {
  /**
   * @param elementId - ID of the dialog element
   * @param options - Configuration options
   */
  constructor(elementId: string, options?: AutoCloseDialogOptions);

  /**
   * Opens the dialog and starts auto-close timer
   * @param duration - Optional duration override in milliseconds
   */
  show(duration?: number): void;

  /**
   * Closes the dialog and clears the auto-close timer
   */
  hide(): void;
}
