/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Controller for Maze game.
 *
 * Phase 1 controller: drives a two-switch step-scanning input mode for
 * users with severe motor impairments who access the page via two
 * physical switches (or two assigned keys). One key advances a visible
 * highlight across scannable regions/items; the other selects the
 * currently highlighted target.
 *
 * URL params (read in `index.ts`, passed via `SwitchScanOptions`):
 *  - `inputMode=switch-scan` — enable the controller.
 *  - `switchAdvance` — key name for advance (default `Space`).
 *  - `switchSelect` — key name for select (default `Enter`).
 *
 * Full design / phased plan: see `PLAN_switch_scanning.md` at the
 * repository root and `.claude/scratchpad/current-plan.md`.
 *
 * Step 3 (current): top-level scan loop across four regions
 * (header / toolbox / workspace / maze-actions) plus a "back to top"
 * sentinel. Advance cycles the highlight; select on a region just
 * console.logs the region name (real sub-scans land in Steps 4-8);
 * select on sentinel resets the index.
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
 * A discoverable top-level scan region. `getRect` is a thunk because
 * Blockly's flyout / workspace DOM may not be measurable at the moment
 * `enable()` runs (e.g. before first layout) — deferring keeps things
 * robust to lazy sizing and to later resizes.
 */
interface ScanRegion {
  name: string;
  getRect: () => DOMRect | null;
}

/**
 * Controller for two-switch step-scanning input mode.
 * See file-level docstring for design notes.
 */
export class SwitchScanController {
  private workspace: Blockly.WorkspaceSvg;
  private mazeGame: MazeGame;
  private enabled = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;
  private boundReflow: () => void;

  // Key bindings (KeyboardEvent.key values). Defaults: Space / Enter.
  private switchAdvance = ' ';
  private switchSelect = 'Enter';

  // Top-level regions, discovered on enable(). Index === regions.length
  // represents the synthetic "back to top" sentinel.
  private regions: ScanRegion[] = [];
  private scanIndex = 0;

  // DOM overlay elements; created once per enable, removed on disable.
  private highlightEl: HTMLDivElement | null = null;
  private sentinelChip: HTMLDivElement | null = null;

  // rAF handle for throttled reflow on resize/scroll, so we don't
  // re-render on every wheel tick.
  private reflowRafHandle: number | null = null;

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

    // Bind handlers so add/removeEventListener get matching references.
    this.boundKeyHandler = this.handleKeyDown.bind(this);
    this.boundReflow = this.scheduleReflow.bind(this);
  }

  /**
   * Enable switch scan mode.
   */
  public enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Discover regions and create overlay DOM.
    this.regions = this.discoverRegions();
    this.scanIndex = 0;
    this.createOverlayElements();

    // Bind keyboard + viewport-change events.
    document.addEventListener('keydown', this.boundKeyHandler);
    window.addEventListener('resize', this.boundReflow);
    window.addEventListener('scroll', this.boundReflow, true);

    // Initial render so the user sees the highlight immediately.
    this.renderHighlight();
  }

  /**
   * Disable switch scan mode.
   */
  public disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Unbind events.
    document.removeEventListener('keydown', this.boundKeyHandler);
    window.removeEventListener('resize', this.boundReflow);
    window.removeEventListener('scroll', this.boundReflow, true);

    // Cancel any pending reflow frame.
    if (this.reflowRafHandle !== null) {
      cancelAnimationFrame(this.reflowRafHandle);
      this.reflowRafHandle = null;
    }

    // Tear down overlay DOM.
    this.highlightEl?.remove();
    this.sentinelChip?.remove();
    this.highlightEl = null;
    this.sentinelChip = null;

    this.regions = [];
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
   * Discover the four top-level scan regions in fixed order:
   * header → toolbox → workspace → maze-actions.
   *
   * Each region is exposed as a `{name, getRect}` pair so that callers
   * always get a fresh bounding rect (toolbox / workspace dimensions
   * change with window resize and panel collapse).
   *
   * Regions whose backing element can't be found are skipped (with a
   * console warning) rather than crashing — keeps the controller usable
   * even on level configurations that lack, say, a toolbox.
   */
  private discoverRegions(): ScanRegion[] {
    const regions: ScanRegion[] = [];

    // Header — plain DOM region tagged in Step 2.
    const headerEl = document.querySelector<HTMLElement>(
      '[data-scan-region="header"]',
    );
    if (headerEl) {
      regions.push({
        name: 'header',
        getRect: () => headerEl.getBoundingClientRect(),
      });
    } else {
      console.warn('[switch-scan] header region not found');
    }

    // Toolbox — prefer Blockly's flyout SVG group, fall back to the
    // toolbox HtmlDiv if a category-style Toolbox is in use. Both are
    // private-ish APIs; the cast pattern matches `src/index.ts:157`.
    const flyout = this.workspace.getFlyout();
    const toolbox = this.workspace.getToolbox();
    let toolboxRectFn: (() => DOMRect | null) | null = null;
    if (flyout) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svgGroup = (flyout as any).svgGroup_ as SVGElement | undefined;
      if (svgGroup) {
        toolboxRectFn = () => svgGroup.getBoundingClientRect();
      }
    }
    if (!toolboxRectFn && toolbox) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const htmlDiv = (toolbox as any).HtmlDiv as HTMLElement | undefined;
      if (htmlDiv) {
        toolboxRectFn = () => htmlDiv.getBoundingClientRect();
      }
    }
    if (toolboxRectFn) {
      // We deliberately don't sample the rect here — Blockly's flyout
      // may not be measured yet at `enable()` time (e.g. if discovery
      // runs before first layout / on a hidden tab). The thunk re-reads
      // on every render, and `renderHighlight()` already hides the
      // outline for a 0x0 rect, so a transiently-unmeasurable toolbox
      // self-recovers on the next cycle instead of being permanently
      // dropped.
      regions.push({name: 'toolbox', getRect: toolboxRectFn});
    } else {
      console.warn('[switch-scan] toolbox region not found');
    }

    // Workspace — outermost Blockly injection div. We're highlighting
    // the region as a whole here, not individual blocks (block scan
    // arrives in Step 7), so injectionDiv is the right granularity.
    const injectionDiv = this.workspace.getInjectionDiv();
    if (injectionDiv) {
      regions.push({
        name: 'workspace',
        getRect: () => injectionDiv.getBoundingClientRect(),
      });
    } else {
      console.warn('[switch-scan] workspace region not found');
    }

    // Maze actions — plain DOM region tagged in Step 2.
    const mazeActionsEl = document.querySelector<HTMLElement>(
      '[data-scan-region="maze-actions"]',
    );
    if (mazeActionsEl) {
      regions.push({
        name: 'maze-actions',
        getRect: () => mazeActionsEl.getBoundingClientRect(),
      });
    } else {
      console.warn('[switch-scan] maze-actions region not found');
    }

    return regions;
  }

  /**
   * Create the highlight outline + sentinel chip and attach them to
   * the document body. Both elements stay in the DOM for the life of
   * the enabled controller; we just toggle visibility / position.
   */
  private createOverlayElements(): void {
    this.highlightEl = document.createElement('div');
    this.highlightEl.className = 'switch-scan-highlight';
    this.highlightEl.style.display = 'none';
    document.body.appendChild(this.highlightEl);

    this.sentinelChip = document.createElement('div');
    this.sentinelChip.className = 'switch-scan-sentinel';
    this.sentinelChip.textContent = '↺ Back to top';
    this.sentinelChip.style.display = 'none';
    document.body.appendChild(this.sentinelChip);
  }

  /**
   * Reposition / show / hide the highlight + sentinel chip based on
   * the current `scanIndex`. Safe to call any number of times.
   */
  private renderHighlight(): void {
    if (!this.highlightEl || !this.sentinelChip) return;

    const atSentinel = this.scanIndex === this.regions.length;

    if (atSentinel) {
      this.highlightEl.style.display = 'none';
      this.sentinelChip.style.display = 'block';
      return;
    }

    // At a region — hide chip, position outline.
    this.sentinelChip.style.display = 'none';

    const region = this.regions[this.scanIndex];
    const rect = region?.getRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      // Defensive: rect may briefly be unmeasurable; hide rather than
      // splat a 0x0 outline at (0,0).
      this.highlightEl.style.display = 'none';
      return;
    }

    this.highlightEl.style.display = 'block';
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;
  }

  /**
   * Coalesce resize/scroll bursts into a single rAF-paced re-render so
   * we don't thrash layout while the user drags the window or scrolls.
   */
  private scheduleReflow(): void {
    if (this.reflowRafHandle !== null) return;
    this.reflowRafHandle = requestAnimationFrame(() => {
      this.reflowRafHandle = null;
      this.renderHighlight();
    });
  }

  /**
   * Keydown handler. Step 3: advance cycles the top-level highlight;
   * select on a region logs, select on sentinel resets to index 0.
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
      // Cycle: regions[0] ... regions[N-1] then sentinel, then wrap.
      const cycleLen = this.regions.length + 1;
      if (cycleLen > 0) {
        this.scanIndex = (this.scanIndex + 1) % cycleLen;
        this.renderHighlight();
      }
      return;
    }

    if (e.key === this.switchSelect) {
      const atSentinel = this.scanIndex === this.regions.length;
      if (atSentinel) {
        console.log('[switch-scan] selected sentinel: back to top');
        this.scanIndex = 0;
        this.renderHighlight();
      } else {
        const region = this.regions[this.scanIndex];
        console.log('[switch-scan] selected region:', region?.name);
      }
      return;
    }
  }
}
