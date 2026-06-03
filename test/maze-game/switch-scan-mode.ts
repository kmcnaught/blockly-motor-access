/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Controller for Maze game.
 *
 * Phase 1 scaffold: this controller will eventually drive a two-switch
 * step-scanning input mode for users with severe motor impairments who
 * access the page via two physical switches (or two assigned keys). One
 * key advances a visible highlight across scannable regions/items; the
 * other selects the currently highlighted target.
 *
 * Full design / phased plan: see `PLAN_switch_scanning.md` at the
 * repository root and `.claude/scratchpad/current-plan.md`.
 *
 * For now this class is intentionally minimal — it binds a `keydown`
 * listener that simply logs to the console when the configured advance
 * or select keys are pressed, proving the URL-param wiring and
 * mutual exclusion with `GridCodingModeController` work. Real scan
 * logic (region discovery, highlight overlay, sub-scan stack, etc.)
 * lands in subsequent Phase 1 steps.
 */

import * as Blockly from 'blockly/core';
import {MazeGame} from './maze';

/**
 * Options for configuring the switch scan controller.
 * Keys use `KeyboardEvent.key` string values (e.g. `' '` for Space,
 * `'Enter'` for Enter). Human-readable aliases like `'Space'` are also
 * accepted (see {@link normalizeKey}).
 */
export interface SwitchScanOptions {
  switchAdvance?: string;
  switchSelect?: string;
}

/**
 * Map of human-readable key names (as a user would type in a URL param)
 * to their `KeyboardEvent.key` equivalents. The browser reports the
 * spacebar as `' '`, not `'Space'`, so we accept both spellings.
 */
const KEY_ALIASES: Record<string, string> = {
  'Space': ' ',
  'space': ' ',
  'SPACE': ' ',
};

/**
 * Normalize a configured key string to its `KeyboardEvent.key` form so
 * `event.key === normalized` works regardless of whether the user wrote
 * `?switchAdvance=Space` or `?switchAdvance=+` in the URL.
 */
function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

/**
 * Controller for two-switch step-scanning input mode.
 * Phase 1 scaffold — see file-level docstring.
 */
export class SwitchScanController {
  private workspace: Blockly.WorkspaceSvg;
  private mazeGame: MazeGame;
  private enabled = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;

  // Key bindings (KeyboardEvent.key values). Defaults: Space / Enter.
  private switchAdvance = ' ';
  private switchSelect = 'Enter';

  constructor(
    workspace: Blockly.WorkspaceSvg,
    mazeGame: MazeGame,
    options: SwitchScanOptions = {},
  ) {
    this.workspace = workspace;
    this.mazeGame = mazeGame;

    if (options.switchAdvance !== undefined) {
      this.switchAdvance = normalizeKey(options.switchAdvance);
    }
    if (options.switchSelect !== undefined) {
      this.switchSelect = normalizeKey(options.switchSelect);
    }

    // Bind keyboard handler
    this.boundKeyHandler = this.handleKeyDown.bind(this);
  }

  /**
   * Enable switch scan mode.
   */
  public enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Bind keyboard events
    document.addEventListener('keydown', this.boundKeyHandler);
  }

  /**
   * Disable switch scan mode.
   */
  public disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Unbind keyboard events
    document.removeEventListener('keydown', this.boundKeyHandler);
  }

  /**
   * Check if switch scan mode is enabled.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the MazeGame reference (called when level changes).
   */
  public setMazeGame(mazeGame: MazeGame): void {
    this.mazeGame = mazeGame;
  }

  /**
   * Update the advance / select key bindings.
   * Keys use `KeyboardEvent.key` string values; aliases like `'Space'`
   * are normalized.
   */
  public setKeys(switchAdvance: string, switchSelect: string): void {
    this.switchAdvance = normalizeKey(switchAdvance);
    this.switchSelect = normalizeKey(switchSelect);
  }

  /**
   * Keydown handler. Phase 1: just log on match.
   *
   * Defensive: bails if disabled (the listener is removed on disable,
   * but the guard keeps state and listener-binding decoupled) and skips
   * events from text inputs so the keys remain usable in dialogs / form
   * fields once those land in later phases.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Ignore if user is typing in an input field.
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (e.key === this.switchAdvance) {
      console.log('[switch-scan] advance');
      return;
    }
    if (e.key === this.switchSelect) {
      console.log('[switch-scan] select');
      return;
    }
  }
}
