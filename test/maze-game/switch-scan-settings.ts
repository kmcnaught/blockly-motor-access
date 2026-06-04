/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Settings modal (Phase 2 Step A — scaffold).
 *
 * Owns the lifecycle of the in-page Switch Scan Settings modal — a
 * dedicated dialog separate from the existing `#shortcutsModal`. It's
 * surfaced only in switch-scan mode (the header's `#switchSettingsBtn`
 * is `.hidden` for everyone else), giving switch users a clean,
 * scannable entry point that doesn't force them through the keyboard-
 * shortcuts list to reach their settings.
 *
 * Phase 2 sub-step rollout:
 *  - Step A (this file): scaffold only — modal open/close via the
 *    existing {@link Dialog} helper, all controls rendered as stubs
 *    (radio mode, two key-capture rows, scan-speed slider, audio
 *    toggle, Save/Cancel). Save just closes the modal. No persistence.
 *  - Step B: live key capture for Switch A / Switch B with validation
 *    (no duplicates, no Tab/Escape).
 *  - Step C: localStorage persistence + URL-wins precedence.
 *  - Step D: tag controls with `data-scan-region` / `data-scan-item`
 *    so the modal is itself reachable via switch-scan.
 *
 * Non-switch-scan users see ZERO change from this step: the controller
 * is instantiated only when `inputMode === 'switch-scan'`, and the
 * header button is hidden until that controller is wired up.
 *
 * See `PLAN_switch_scanning.md` lines 192-211 for the full settings
 * panel design, and `.claude/scratchpad/current-plan.md` Phase 2 for
 * the per-step plan.
 */

import {Dialog} from './dialogs';

/**
 * Controller for the Switch Scan Settings modal.
 *
 * Wraps the existing `#switchSettingsModal` `<dialog>` (declared in
 * `index.html` so the markup ships with the page rather than being
 * injected at runtime — keeps the modal styleable from `maze.css` and
 * matches the convention used by `#shortcutsModal`,
 * `#confirmationModal`, etc.).
 */
export class SwitchScanSettings {
  private readonly dialog: Dialog;
  private readonly cancelBtn: HTMLButtonElement | null;
  private readonly saveBtn: HTMLButtonElement | null;

  /**
   * @param elementId   Optional DOM id of the `<dialog>` element.
   *                    Defaults to `'switchSettingsModal'`.
   */
  constructor(elementId = 'switchSettingsModal') {
    // Mirrors the pattern used by `shortcutsDialog` in index.ts so
    // ESC closes / focus traps work the same way as every other modal
    // on the page.
    this.dialog = new Dialog(elementId, {
      focusSelector: '#switchSettingsCancel',
      closeOnEscape: true,
      closeOnBackdropClick: true,
    });

    // These buttons live inside the dialog. We deliberately don't
    // attach any logic beyond hide() in Step A — Save persistence
    // lands in Step C, capture logic in Step B.
    this.cancelBtn = document.getElementById(
      'switchSettingsCancel',
    ) as HTMLButtonElement | null;
    this.saveBtn = document.getElementById(
      'switchSettingsSave',
    ) as HTMLButtonElement | null;

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.hide());
    }
    if (this.saveBtn) {
      // Step A scaffold: Save is a no-op beyond closing. Step C will
      // wire it to write to localStorage and re-bind keys live.
      this.saveBtn.addEventListener('click', () => this.hide());
    }
  }

  /**
   * Open the settings modal. Focuses Cancel by default (matches the
   * `shortcutsDialog` pattern — the dismiss action is the safe default
   * for a scan user who lands on the modal accidentally).
   */
  show(): void {
    this.dialog.show();
  }

  /**
   * Close the settings modal.
   */
  hide(): void {
    this.dialog.hide();
  }

  /**
   * Whether the modal is currently open. Exposed for the switch-scan
   * controller in later sub-steps so it can pause its own keydown
   * handling while a key-capture is in progress (Step B / D).
   */
  isOpen(): boolean {
    return this.dialog.isOpen();
  }
}
