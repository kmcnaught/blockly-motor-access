/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Settings — inline sub-panel inside the
 * unified settings modal (`#shortcutsModal`).
 *
 * Originally the switch-scan settings lived in their own dedicated
 * `<dialog id="switchSettingsModal">`. After the settings UI refactor
 * (todo.md #1) the controls are embedded INLINE inside the unified
 * settings modal as a collapsible sub-panel (`#switchAccessPanel`)
 * gated on the "Switch access" checkbox. This file owns the lifecycle
 * of those controls — key-capture, mode radio, scan-speed slider,
 * audio toggle — and fires {@link SwitchScanSettingsOptions.onChange}
 * whenever an accepted control change happens.
 *
 * Behavior changes vs. the dialog era:
 *  - No Save / Cancel buttons. Every accepted control change applies
 *    immediately and fires `onChange`. Key-capture still has explicit
 *    accept semantics (Tab / Escape / duplicate-key rejected; only an
 *    accepted key commits) so a stray press during capture is safe.
 *  - No `show()` / `hide()`. The parent dialog owns open/close; this
 *    class is constructed once at boot and just reads / writes the
 *    inline controls.
 *  - `isCapturing()` is kept — the SwitchScanController uses it to
 *    suspend its own keydown handling while a capture is in flight.
 */

/** Scan mode chosen by the user. */
export type SwitchScanMode = 'step' | 'auto';

/** Shape of the settings object handed back to the caller. */
export interface SwitchScanSettingsValues {
  switchAdvance: string;
  switchSelect: string;
  mode: SwitchScanMode;
  /**
   * Whether TTS audio feedback should be on. The host page persists
   * this to localStorage and calls `SwitchScanTts.setEnabled(audio)`.
   */
  audio: boolean;
  /**
   * Auto-scan timer period in milliseconds. Only meaningful when
   * `mode === 'auto'` — host still receives the current value so it
   * can persist + live-update the controller even if the user toggled
   * modes during the same change.
   */
  scanSpeedMs: number;
}

/** Constructor options for {@link SwitchScanSettings}. */
export interface SwitchScanSettingsOptions {
  initialAdvanceKey: string;
  initialSelectKey: string;
  /** Initial scan mode. Defaults to `'step'`. */
  initialMode?: SwitchScanMode;
  /** Initial audio toggle. Defaults to off. */
  initialAudio?: boolean;
  /** Initial auto-scan period in ms. Defaults to 1500. */
  initialScanSpeedMs?: number;
  /**
   * True when at least one switch-scan URL param is currently in
   * effect. When true the panel renders a small note explaining that
   * saved values are being overridden.
   */
  urlOverrideActive?: boolean;
  /**
   * Fired whenever an accepted control change happens. The host
   * persists the new values to localStorage and live-rebinds the
   * SwitchScanController.
   */
  onChange: (cfg: SwitchScanSettingsValues) => void;
}

/**
 * Convert a raw `KeyboardEvent.key` value to a human-readable label.
 *
 * `KeyboardEvent.key` returns the literal character produced — `" "`
 * for Space, `"ArrowLeft"` for the left arrow, etc. We show those as
 * "Space" / "Left" so the settings panel reads naturally.
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
 * Controller for the inline switch-scan settings sub-panel.
 *
 * Lives inside `#switchAccessPanel` within the unified
 * `#shortcutsModal`. Constructed unconditionally at page boot — the
 * host calls {@link setPanelVisible} when the user toggles the
 * "Switch access" checkbox.
 *
 * State model: the constructor records initial values. Every accepted
 * control change updates the in-memory state AND fires `onChange` so
 * the host can persist + live-apply. Key-capture is the only
 * non-trivial path: an in-flight capture stays open until the user
 * presses an accepted key (no duplicate, no Tab/Escape) or starts a
 * new capture / collapses the panel.
 */
export class SwitchScanSettings {
  private readonly switchACurrentEl: HTMLElement | null;
  private readonly switchBCurrentEl: HTMLElement | null;
  private readonly switchACaptureBtn: HTMLButtonElement | null;
  private readonly switchBCaptureBtn: HTMLButtonElement | null;
  private readonly switchBGroup: HTMLElement | null;
  private readonly modeRadios: NodeListOf<HTMLInputElement>;
  private readonly audioToggle: HTMLInputElement | null;
  private readonly scanSpeedSlider: HTMLInputElement | null;
  private readonly scanSpeedValueEl: HTMLElement | null;
  private readonly scanSpeedGroup: HTMLElement | null;
  private readonly panelEl: HTMLElement | null;

  /** Live values. Auto-applied on every accepted change. */
  private currentAdvance: string;
  private currentSelect: string;
  private currentMode: SwitchScanMode;
  private currentAudio: boolean;
  private currentScanSpeedMs: number;

  /**
   * True iff URL params are overriding saved settings on this page
   * load. Drives the "URL settings active" note — see
   * {@link renderUrlOverrideNote}.
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

  private readonly onChange: (cfg: SwitchScanSettingsValues) => void;

  constructor(options: SwitchScanSettingsOptions) {
    this.onChange = options.onChange;
    this.currentAdvance = options.initialAdvanceKey;
    this.currentSelect = options.initialSelectKey;
    this.currentMode = options.initialMode ?? 'step';
    this.currentAudio = options.initialAudio ?? false;
    this.currentScanSpeedMs = options.initialScanSpeedMs ?? 1500;
    this.urlOverrideActive = options.urlOverrideActive ?? false;

    this.panelEl = document.getElementById('switchAccessPanel');
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
    this.scanSpeedSlider = document.getElementById(
      'scanSpeedSlider',
    ) as HTMLInputElement | null;
    this.scanSpeedValueEl = document.getElementById('scanSpeedValue');
    this.scanSpeedGroup = document.getElementById('scanSpeedGroup');

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
          this.emitChange();
        }
      });
    });

    if (this.audioToggle) {
      this.audioToggle.checked = this.currentAudio;
      this.audioToggle.addEventListener('change', () => {
        this.currentAudio = this.audioToggle!.checked;
        this.emitChange();
      });
    }

    if (this.scanSpeedSlider) {
      this.scanSpeedSlider.value = String(this.currentScanSpeedMs);
      // `input` updates live (drag feedback); `change` is when the
      // user releases the slider, at which point we fire onChange so
      // the controller doesn't get spammed mid-drag.
      this.scanSpeedSlider.addEventListener('input', () => {
        const raw = Number(this.scanSpeedSlider!.value);
        if (Number.isFinite(raw)) {
          this.currentScanSpeedMs = raw;
          this.refreshScanSpeedDisplay();
        }
      });
      this.scanSpeedSlider.addEventListener('change', () => {
        this.emitChange();
      });
    }

    // Seed the radio buttons to match initial state.
    this.modeRadios.forEach((r) => {
      r.checked = r.value === this.currentMode;
    });

    this.refreshDisplay();
    this.refreshScanSpeedDisplay();
    this.refreshModeVisibility();
    this.renderUrlOverrideNote();
  }

  /**
   * Show or hide the inline sub-panel. The host calls this when the
   * "Switch access" checkbox is toggled. Hiding also cancels any
   * in-flight key-capture so a switch user can't get stranded with a
   * stale capture listener.
   */
  setPanelVisible(visible: boolean): void {
    if (!this.panelEl) return;
    if (visible) {
      this.panelEl.classList.remove('hidden');
    } else {
      this.cancelCapture();
      this.panelEl.classList.add('hidden');
    }
  }

  /** Whether the inline panel is currently visible. */
  isPanelVisible(): boolean {
    return !!this.panelEl && !this.panelEl.classList.contains('hidden');
  }

  /**
   * Whether a live key-capture is in progress. The SwitchScanController
   * checks this in its keydown handler so a press during capture
   * doesn't double-fire as a switch action.
   */
  isCapturing(): boolean {
    return this.captureContext !== null;
  }

  /**
   * Fire the onChange callback with the current state. Centralised so
   * every code path that mutates state ends with the same notification.
   */
  private emitChange(): void {
    this.onChange({
      switchAdvance: this.currentAdvance,
      switchSelect: this.currentSelect,
      mode: this.currentMode,
      audio: this.currentAudio,
      scanSpeedMs: this.currentScanSpeedMs,
    });
  }

  /**
   * Inject (or remove) the "URL settings active" hint near the top of
   * the panel body. Idempotent — we render at construction time. The
   * note is only meaningful when URL params are in effect.
   */
  private renderUrlOverrideNote(): void {
    const existing = document.getElementById('switchSettingsUrlNote');
    if (!this.urlOverrideActive) {
      existing?.remove();
      return;
    }
    if (existing) return;

    if (!this.panelEl) return;

    const note = document.createElement('p');
    note.id = 'switchSettingsUrlNote';
    note.className = 'switch-settings-url-note';
    note.textContent =
      'URL settings active — refresh without params to use saved values.';
    this.panelEl.insertBefore(note, this.panelEl.firstChild);
  }

  /** Sync `#switchACurrent` / `#switchBCurrent` to the current state. */
  private refreshDisplay(): void {
    if (this.switchACurrentEl) {
      this.switchACurrentEl.textContent = keyLabel(this.currentAdvance);
    }
    if (this.switchBCurrentEl) {
      this.switchBCurrentEl.textContent = keyLabel(this.currentSelect);
    }
  }

  /**
   * Show / hide the Switch B and Scan-speed sections based on mode.
   *
   *  - Auto mode: hide Switch B, show Scan-speed.
   *  - Step mode: show Switch B, hide Scan-speed.
   */
  private refreshModeVisibility(): void {
    if (this.switchBGroup) {
      if (this.currentMode === 'auto') {
        this.switchBGroup.classList.add('hidden');
      } else {
        this.switchBGroup.classList.remove('hidden');
      }
    }
    if (this.scanSpeedGroup) {
      if (this.currentMode === 'auto') {
        this.scanSpeedGroup.classList.remove('hidden');
      } else {
        this.scanSpeedGroup.classList.add('hidden');
      }
    }
  }

  /** Sync `#scanSpeedValue` to the current scan-speed value. */
  private refreshScanSpeedDisplay(): void {
    if (this.scanSpeedValueEl) {
      this.scanSpeedValueEl.textContent = `${this.currentScanSpeedMs} ms`;
    }
  }

  /**
   * Begin a live key-capture for `which` (advance or select).
   *
   * We attach the keydown listener on `document` with `capture: true`
   * and call `stopImmediatePropagation()` inside the handler so the
   * SwitchScanController — which also listens for the same keys —
   * never sees the press. Otherwise the user pressing their *current*
   * Switch A key while trying to rebind it would also trigger
   * "Advance" in the controller.
   *
   * @param which Which switch this capture is rebinding.
   */
  private beginCapture(which: 'advance' | 'select'): void {
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
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      if (event.key === 'Tab' || event.key === 'Escape') {
        errorEl.textContent =
          "Tab/Escape can't be used as a switch key. Try again.";
        return;
      }

      const other =
        which === 'advance' ? this.currentSelect : this.currentAdvance;
      if (event.key === other) {
        const otherLabel = which === 'advance' ? 'Switch B' : 'Switch A';
        errorEl.textContent = `That key is already bound to ${otherLabel}. Pick a different key.`;
        return;
      }

      // Accepted — commit live + apply.
      if (which === 'advance') {
        this.currentAdvance = event.key;
      } else {
        this.currentSelect = event.key;
      }
      this.refreshDisplay();
      this.cancelCapture();
      this.emitChange();
    };

    document.addEventListener('keydown', keydownHandler, {capture: true});

    this.captureContext = {
      which,
      button,
      originalLabel,
      keydownHandler,
      errorEl,
    };
  }

  /** Tear down any in-flight capture. Safe when no capture is active. */
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
   * capture row for `which`.
   */
  private ensureErrorEl(which: 'advance' | 'select'): HTMLElement {
    const id =
      which === 'advance'
        ? 'switchSettingsErrorA'
        : 'switchSettingsErrorB';
    let el = document.getElementById(id);
    if (el) return el;

    const groupId = which === 'advance' ? null : 'switchBGroup';
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
}
