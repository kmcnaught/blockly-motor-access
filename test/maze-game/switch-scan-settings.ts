/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Settings modal.
 *
 * Owns the lifecycle of the in-page Switch Scan Settings modal — a
 * dedicated dialog separate from the existing `#shortcutsModal`. It's
 * surfaced only in switch-scan mode (the header's `#switchSettingsBtn`
 * is `.hidden` for everyone else), giving switch users a clean,
 * scannable entry point that doesn't force them through the keyboard-
 * shortcuts list to reach their settings.
 *
 * Phase 2 sub-step rollout:
 *  - Step A: scaffold (modal markup + open/close).
 *  - Step B (this file's current state): live key capture for Switch A
 *    / Switch B with validation (no duplicates, no Tab/Escape) and a
 *    mode-radio that hides Switch B in auto-scan mode. Save fires an
 *    `onSave` callback; persistence + live re-bind land in Step C.
 *  - Step C: localStorage persistence + URL-wins precedence + live
 *    re-bind of the SwitchScanController.
 *  - Step D: tag controls with `data-scan-region` / `data-scan-item`
 *    so the modal is itself reachable via switch-scan.
 *
 * Non-switch-scan users see ZERO change: the controller is instantiated
 * only when `inputMode === 'switch-scan'`, and the header button is
 * hidden until that controller is wired up.
 *
 * See `PLAN_switch_scanning.md` lines 192-211 for the full settings
 * panel design, and `.claude/scratchpad/current-plan.md` Phase 2 for
 * the per-step plan.
 */

import {Dialog} from './dialogs';

/** Scan mode chosen by the user. Auto-scan is Phase 4 (UI-only here). */
export type SwitchScanMode = 'step' | 'auto';

/** Shape of the settings object handed back to the caller on Save. */
export interface SwitchScanSettingsValues {
  switchAdvance: string;
  switchSelect: string;
  mode: SwitchScanMode;
  /**
   * Phase 5: whether TTS audio feedback should be on. The host page
   * persists this to localStorage and calls
   * `SwitchScanTts.setEnabled(audio)` so the change takes effect
   * mid-session — matches the live-rebind pattern used for the keys.
   */
  audio: boolean;
}

/**
 * Constructor options for {@link SwitchScanSettings}.
 *
 * Initial values come from whatever the page resolved at boot (URL
 * params today; localStorage in Step C). The `onSave` callback is how
 * the host page learns about user edits — Step C wires it to persist
 * + re-bind the controller; Step B's host wires it to a no-op log.
 */
export interface SwitchScanSettingsOptions {
  initialAdvanceKey: string;
  initialSelectKey: string;
  /**
   * Initial scan mode (Phase 4 — UI-only for now). When omitted, the
   * dialog defaults to `'step'`. Step C plumbs the persisted value
   * through here so the radio reflects what the user last picked.
   */
  initialMode?: SwitchScanMode;
  /**
   * Phase 5: initial state for the audio-feedback (TTS) checkbox.
   * When omitted the dialog defaults to OFF — matching the host
   * page's URL > localStorage > 'off' resolution.
   */
  initialAudio?: boolean;
  /**
   * True when at least one `?switchAdvance=…` / `?switchSelect=…` /
   * `?scanMode=…` / `?scanAudio=…` URL param is currently in effect
   * for this page load. When true the dialog renders a small note
   * explaining that saved values are being overridden by the URL —
   * without this, a user who just saved a different key would wonder
   * why the URL bindings keep winning on reload.
   */
  urlOverrideActive?: boolean;
  onSave: (cfg: SwitchScanSettingsValues) => void;
  /**
   * Optional Step D hook: fired after the modal opens, BEFORE the user
   * can interact with it. The switch-scan controller wires this to
   * `pushModalSubScan('settings-modal')` so the scanner re-targets
   * itself inside the modal's region for the duration of the modal's
   * lifetime. Non-switch-scan callers can leave it unset.
   */
  onOpen?: () => void;
  /**
   * Optional Step D hook: fired after the modal closes via any path
   * (Cancel, Save, ESC, backdrop click — Dialog's existing onClose
   * funnels them all). The controller wires this to
   * `popModalSubScan()` so the scanner restores its previous frame
   * stack. Non-switch-scan callers can leave it unset.
   */
  onClose?: () => void;
}

/**
 * Convert a raw `KeyboardEvent.key` value to a human-readable label.
 *
 * `KeyboardEvent.key` returns the literal character produced — `" "`
 * for Space, `"ArrowLeft"` for the left arrow, etc. We show those as
 * "Space" / "Left" so the settings panel reads naturally.
 *
 * Single printable characters are upper-cased so "q" → "Q"; named keys
 * are passed through (Enter, Escape, etc.) with arrow keys stripped of
 * their "Arrow" prefix.
 *
 * @param key Raw `KeyboardEvent.key` value (e.g. `" "`, `"ArrowLeft"`).
 * @returns Human-readable label for display in the settings UI.
 */
function keyLabel(key: string): string {
  if (key === ' ') return 'Space';
  if (key.startsWith('Arrow')) return key.slice('Arrow'.length);
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Controller for the Switch Scan Settings modal.
 *
 * Wraps the existing `#switchSettingsModal` `<dialog>` (declared in
 * `index.html` so the markup ships with the page rather than being
 * injected at runtime — keeps the modal styleable from `maze.css` and
 * matches the convention used by `#shortcutsModal`, etc.).
 *
 * State model: the constructor records the *committed* (initial)
 * values, and `currentAdvance` / `currentSelect` / `currentMode` hold
 * the *pending* state shown in the dialog. Cancel reverts to committed;
 * Save promotes pending to committed and fires `onSave`.
 */
export class SwitchScanSettings {
  private readonly dialog: Dialog;
  private readonly cancelBtn: HTMLButtonElement | null;
  private readonly saveBtn: HTMLButtonElement | null;
  private readonly switchACurrentEl: HTMLElement | null;
  private readonly switchBCurrentEl: HTMLElement | null;
  private readonly switchACaptureBtn: HTMLButtonElement | null;
  private readonly switchBCaptureBtn: HTMLButtonElement | null;
  private readonly switchBGroup: HTMLElement | null;
  private readonly modeRadios: NodeListOf<HTMLInputElement>;
  private readonly audioToggle: HTMLInputElement | null;

  /** Committed (last-saved) values — what Cancel reverts to. */
  private committedAdvance: string;
  private committedSelect: string;
  private committedMode: SwitchScanMode;
  private committedAudio: boolean;

  /** Pending values — what's currently shown in the dialog. */
  private currentAdvance: string;
  private currentSelect: string;
  private currentMode: SwitchScanMode;
  private currentAudio: boolean;

  /**
   * True iff URL params are overriding saved settings on this page
   * load. Drives the "URL settings active" note rendered near the top
   * of the modal body — see {@link renderUrlOverrideNote}.
   */
  private readonly urlOverrideActive: boolean;

  /** Active key-capture state. Null when no capture is in flight. */
  private captureContext: {
    which: 'advance' | 'select';
    button: HTMLButtonElement;
    originalLabel: string;
    keydownHandler: (e: KeyboardEvent) => void;
    errorEl: HTMLElement;
  } | null = null;

  private readonly onSave: (cfg: SwitchScanSettingsValues) => void;
  private readonly onOpenHook: (() => void) | null;
  private readonly onCloseHook: (() => void) | null;

  constructor(
    options: SwitchScanSettingsOptions,
    elementId = 'switchSettingsModal',
  ) {
    this.onSave = options.onSave;
    this.onOpenHook = options.onOpen ?? null;
    this.onCloseHook = options.onClose ?? null;
    this.committedAdvance = options.initialAdvanceKey;
    this.committedSelect = options.initialSelectKey;
    this.committedMode = options.initialMode ?? 'step';
    this.committedAudio = options.initialAudio ?? false;
    this.currentAdvance = this.committedAdvance;
    this.currentSelect = this.committedSelect;
    this.currentMode = this.committedMode;
    this.currentAudio = this.committedAudio;
    this.urlOverrideActive = options.urlOverrideActive ?? false;

    // Mirrors the pattern used by `shortcutsDialog` in index.ts so
    // ESC closes / focus traps work the same way as every other modal.
    // We treat backdrop-click / ESC as Cancel so the user can't leak
    // pending key-captures past a dismissed dialog.
    //
    // Step D: also fire the host's `onClose` hook so the switch-scan
    // controller can pop its modal sub-scan frame on every close path
    // (Cancel button, Save button, ESC, backdrop click — Dialog
    // funnels them all here).
    this.dialog = new Dialog(elementId, {
      focusSelector: '#switchSettingsCancel',
      closeOnEscape: true,
      closeOnBackdropClick: true,
      onClose: () => {
        this.cancelCapture();
        this.onCloseHook?.();
      },
    });

    this.cancelBtn = document.getElementById(
      'switchSettingsCancel',
    ) as HTMLButtonElement | null;
    this.saveBtn = document.getElementById(
      'switchSettingsSave',
    ) as HTMLButtonElement | null;
    this.switchACurrentEl = document.getElementById('switchACurrent');
    this.switchBCurrentEl = document.getElementById('switchBCurrent');
    this.switchACaptureBtn = document.getElementById(
      'switchACaptureBtn',
    ) as HTMLButtonElement | null;
    this.switchBCaptureBtn = document.getElementById(
      'switchBCaptureBtn',
    ) as HTMLButtonElement | null;
    this.switchBGroup = document.getElementById('switchBGroup');
    this.modeRadios = document.querySelectorAll<HTMLInputElement>(
      'input[name="switchScanMode"]',
    );
    this.audioToggle = document.getElementById(
      'audioFeedbackToggle',
    ) as HTMLInputElement | null;

    // Capture buttons were inert (disabled) in Step A; enable them now.
    if (this.switchACaptureBtn) {
      this.switchACaptureBtn.disabled = false;
      this.switchACaptureBtn.addEventListener('click', () =>
        this.beginCapture('advance'),
      );
    }
    if (this.switchBCaptureBtn) {
      this.switchBCaptureBtn.disabled = false;
      this.switchBCaptureBtn.addEventListener('click', () =>
        this.beginCapture('select'),
      );
    }

    this.modeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          this.currentMode = radio.value as SwitchScanMode;
          this.refreshModeVisibility();
        }
      });
    });

    // Phase 5: audio toggle. Previously inert (disabled stub with a
    // "Coming soon" note in markup — removed in Phase 5). The change
    // is pending until Save: Cancel reverts to the committed value
    // via revertPending(); Save promotes it via the existing flow.
    if (this.audioToggle) {
      this.audioToggle.checked = this.currentAudio;
      this.audioToggle.addEventListener('change', () => {
        this.currentAudio = this.audioToggle!.checked;
      });
    }

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => {
        this.revertPending();
        this.hide();
      });
    }
    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => {
        this.cancelCapture();
        // Promote pending → committed and notify the host.
        this.committedAdvance = this.currentAdvance;
        this.committedSelect = this.currentSelect;
        this.committedMode = this.currentMode;
        this.committedAudio = this.currentAudio;
        this.onSave({
          switchAdvance: this.committedAdvance,
          switchSelect: this.committedSelect,
          mode: this.committedMode,
          audio: this.committedAudio,
        });
        this.hide();
      });
    }

    this.refreshDisplay();
    this.refreshModeVisibility();
    this.renderUrlOverrideNote();
  }

  /**
   * Inject (or remove) the "URL settings active" hint near the top of
   * the modal body. Idempotent — we render at construction time and
   * again on `show()` so re-opening the modal after a Save shows fresh
   * state. The note is only meaningful when URL params are in effect:
   * a user who arrived without URL overrides gets nothing extra.
   *
   * Placement: prepended to `.switch-settings-list` so it sits above
   * the first group without any markup changes in `index.html`.
   */
  private renderUrlOverrideNote(): void {
    const existing = document.getElementById('switchSettingsUrlNote');
    if (!this.urlOverrideActive) {
      existing?.remove();
      return;
    }
    if (existing) return; // already present, nothing to do

    const list = document.querySelector<HTMLElement>(
      '#switchSettingsModal .switch-settings-list',
    );
    if (!list) return;

    const note = document.createElement('p');
    note.id = 'switchSettingsUrlNote';
    note.className = 'switch-settings-url-note';
    note.textContent =
      'URL settings active — refresh without params to use saved values.';
    list.insertBefore(note, list.firstChild);
  }

  /**
   * Open the settings modal. Focuses Cancel by default (matches the
   * `shortcutsDialog` pattern — the dismiss action is the safe default
   * for a scan user who lands on the modal accidentally).
   */
  show(): void {
    // Re-sync displayed values to committed in case anything mutated
    // them while the modal was closed (Step C will do this on URL
    // changes; harmless here).
    this.currentAdvance = this.committedAdvance;
    this.currentSelect = this.committedSelect;
    this.currentMode = this.committedMode;
    this.currentAudio = this.committedAudio;
    this.modeRadios.forEach((r) => {
      r.checked = r.value === this.currentMode;
    });
    if (this.audioToggle) this.audioToggle.checked = this.currentAudio;
    this.refreshDisplay();
    this.refreshModeVisibility();
    this.renderUrlOverrideNote();
    this.clearErrors();
    this.dialog.show();
    // Step D: notify the host AFTER the dialog has been shown so the
    // modal's DOM is laid out + measurable. The switch-scan controller
    // uses this to push a sub-scan frame over the modal's region;
    // discovery scans `[data-scan-item]` children, which need to be
    // visible (`offsetParent` non-null) to count.
    this.onOpenHook?.();
  }

  /** Close the settings modal. */
  hide(): void {
    this.dialog.hide();
  }

  /**
   * Whether the modal is currently open. Exposed for the switch-scan
   * controller in Step D so it can pause its own keydown handling
   * while a key-capture is in progress.
   */
  isOpen(): boolean {
    return this.dialog.isOpen();
  }

  /**
   * Whether a live key-capture is in progress. Step D will check this
   * to decide whether to suspend the controller's keybindings.
   */
  isCapturing(): boolean {
    return this.captureContext !== null;
  }

  /**
   * Push pending state back to the displayed initial values. Used by
   * Cancel and by `show()` on each open.
   */
  private revertPending(): void {
    this.cancelCapture();
    this.currentAdvance = this.committedAdvance;
    this.currentSelect = this.committedSelect;
    this.currentMode = this.committedMode;
    this.currentAudio = this.committedAudio;
    this.modeRadios.forEach((r) => {
      r.checked = r.value === this.currentMode;
    });
    if (this.audioToggle) this.audioToggle.checked = this.currentAudio;
    this.refreshDisplay();
    this.refreshModeVisibility();
    this.clearErrors();
  }

  /** Sync `#switchACurrent` / `#switchBCurrent` to the pending state. */
  private refreshDisplay(): void {
    if (this.switchACurrentEl) {
      this.switchACurrentEl.textContent = keyLabel(this.currentAdvance);
    }
    if (this.switchBCurrentEl) {
      this.switchBCurrentEl.textContent = keyLabel(this.currentSelect);
    }
  }

  /**
   * Show / hide the Switch B section based on the current mode. Auto-
   * scan only needs one switch (the Phase 4 scanning timer drives
   * highlights forward on its own); step-scan needs two.
   */
  private refreshModeVisibility(): void {
    if (!this.switchBGroup) return;
    if (this.currentMode === 'auto') {
      this.switchBGroup.classList.add('hidden');
    } else {
      this.switchBGroup.classList.remove('hidden');
    }
  }

  /**
   * Begin a live key-capture for `which` (advance or select).
   *
   * We attach the keydown listener on `document` with `capture: true`
   * and call `stopImmediatePropagation()` inside the handler so the
   * SwitchScanController — which also listens for the same keys on
   * `window` / `document` — never sees the press. Otherwise the user
   * pressing their *current* Switch A key while trying to rebind it
   * would also trigger "Advance" in the controller.
   *
   * @param which Which switch this capture is rebinding.
   */
  private beginCapture(which: 'advance' | 'select'): void {
    // If another capture is in flight, abort it first so we never have
    // two competing keydown listeners.
    this.cancelCapture();

    const button =
      which === 'advance'
        ? this.switchACaptureBtn
        : this.switchBCaptureBtn;
    if (!button) return;

    const originalLabel = button.textContent ?? 'Click to capture';
    button.textContent = 'Press a key...';
    button.classList.add('switch-settings-capturing');

    const errorEl = this.ensureErrorEl(which);

    const keydownHandler = (event: KeyboardEvent) => {
      // Block the SwitchScanController + any browser default for keys
      // we'd otherwise accept (e.g. Space scrolling the page).
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      // Disallow Tab/Escape entirely — they have UA-default behavior
      // (focus traversal, dialog dismiss) that we shouldn't override.
      if (event.key === 'Tab' || event.key === 'Escape') {
        errorEl.textContent =
          "Tab/Escape can't be used as a switch key. Try again.";
        return; // stay in capture mode
      }

      // Disallow binding both switches to the same key.
      const other =
        which === 'advance' ? this.currentSelect : this.currentAdvance;
      if (event.key === other) {
        const otherLabel = which === 'advance' ? 'Switch B' : 'Switch A';
        errorEl.textContent = `That key is already bound to ${otherLabel}. Pick a different key.`;
        return; // stay in capture mode
      }

      // Accepted — commit to pending state and exit capture mode.
      if (which === 'advance') {
        this.currentAdvance = event.key;
      } else {
        this.currentSelect = event.key;
      }
      this.refreshDisplay();
      this.cancelCapture();
    };

    // capture:true so we fire before any bubbling switch-scan listener
    // attached at `window` / `document` levels.
    document.addEventListener('keydown', keydownHandler, {capture: true});

    this.captureContext = {
      which,
      button,
      originalLabel,
      keydownHandler,
      errorEl,
    };
  }

  /**
   * Tear down any in-flight capture. Safe to call when no capture is
   * active.
   */
  private cancelCapture(): void {
    if (!this.captureContext) return;
    const {button, originalLabel, keydownHandler} = this.captureContext;
    document.removeEventListener('keydown', keydownHandler, {
      capture: true,
    });
    button.textContent = originalLabel;
    button.classList.remove('switch-settings-capturing');
    this.captureContext = null;
  }

  /**
   * Look up (or lazily create) the inline error element below the
   * capture row for `which`. We don't put these in the HTML because
   * they're transient and per-row; a single sibling element keeps the
   * DOM tidy and the styling targeted.
   *
   * @param which Which capture row this error belongs to.
   * @returns The `<p class="switch-settings-error">` element.
   */
  private ensureErrorEl(which: 'advance' | 'select'): HTMLElement {
    const id =
      which === 'advance'
        ? 'switchSettingsErrorA'
        : 'switchSettingsErrorB';
    let el = document.getElementById(id);
    if (el) return el;

    const groupId = which === 'advance' ? null : 'switchBGroup';
    // Switch A has no id on its group, so anchor off the capture
    // button's parent group; Switch B has #switchBGroup.
    const group =
      groupId !== null
        ? document.getElementById(groupId)
        : this.switchACaptureBtn?.closest('.switch-settings-group') ?? null;

    el = document.createElement('p');
    el.id = id;
    el.className = 'switch-settings-error';
    el.setAttribute('role', 'alert');
    if (group) {
      group.appendChild(el);
    }
    return el;
  }

  /** Wipe any error messages from both capture rows. */
  private clearErrors(): void {
    const a = document.getElementById('switchSettingsErrorA');
    const b = document.getElementById('switchSettingsErrorB');
    if (a) a.textContent = '';
    if (b) b.textContent = '';
  }
}
