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
 * Step 6 (current): top-level scan loop across four regions
 * (header / toolbox / workspace / maze-actions) plus a "back to top"
 * sentinel, generic DOM-item sub-scan for header / maze-actions, AND
 * a Blockly-block sub-scan for the toolbox flyout. Selecting a flyout
 * block inserts a new instance of that block type into the main
 * workspace via the shared {@link insertBlockAfterCursor} helper (also
 * used by grid-coding-mode), then pops back to the top-level scan.
 * Workspace block sub-scan reuses the same `blocks` frame and lands
 * in Step 7.
 */

import * as Blockly from 'blockly/core';
import {MazeGame} from './maze';
import {insertBlockAfterCursor} from './block-insertion';

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
 * One frame in the scan stack. The active (top) frame owns the cursor
 * and dictates what the highlight is positioned over.
 *
 *  - `top`: cycles {@link SwitchScanController.regions} plus a sentinel
 *    slot at index === regions.length.
 *  - `dom-items`: cycles a concrete list of DOM elements (e.g. the
 *    buttons inside the header region) plus a sentinel at
 *    index === items.length. `popToTopIndex` is the top-level index to
 *    restore when this sub-scan exits (either via the sentinel or via
 *    selecting an item) — header pops back to header+1 = toolbox so the
 *    user keeps moving forward instead of restarting the cycle.
 *  - `parentRegionName` is informational only (used for logging /
 *    future diagnostics) — frame routing is purely positional.
 */
type ScanFrame =
  | {kind: 'top'; index: number}
  | {
      kind: 'dom-items';
      parentRegionName: string;
      items: HTMLElement[];
      index: number;
      popToTopIndex: number;
    }
  | {
      kind: 'blocks';
      regionName: 'toolbox' | 'workspace';
      blocks: Blockly.BlockSvg[];
      index: number;
      popToTopIndex: number;
    };

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

  // Stack of active scan frames. The last entry is the active frame.
  // Always non-empty while enabled (seeded with a `top` frame in
  // `enable()` and reset on `disable()`).
  private frameStack: ScanFrame[] = [];

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
    // Seed the stack with a fresh top-level frame at index 0.
    this.frameStack = [{kind: 'top', index: 0}];
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
    this.frameStack = [];
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
   * Return the active (top of stack) frame, or `null` if disabled. Used
   * by every render / input path so the controller is purely a function
   * of which frame is on top.
   */
  private activeFrame(): ScanFrame | null {
    return this.frameStack.length > 0
      ? this.frameStack[this.frameStack.length - 1]
      : null;
  }

  /**
   * Cycle length for a given frame (real slots + 1 sentinel slot).
   */
  private cycleLen(frame: ScanFrame): number {
    if (frame.kind === 'top') return this.regions.length + 1;
    if (frame.kind === 'dom-items') return frame.items.length + 1;
    return frame.blocks.length + 1;
  }

  /**
   * `true` iff the frame's index points at its sentinel slot.
   */
  private atSentinel(frame: ScanFrame): boolean {
    if (frame.kind === 'top') return frame.index === this.regions.length;
    if (frame.kind === 'dom-items') return frame.index === frame.items.length;
    return frame.index === frame.blocks.length;
  }

  /**
   * Reposition / show / hide the highlight + sentinel chip based on
   * the active frame's current index. Safe to call any number of times.
   *
   * Highlight target by frame kind:
   *  - `top` at a real region → region's `getRect()` outline.
   *  - `top` at sentinel       → sentinel chip.
   *  - `dom-items` at an item  → item's `getBoundingClientRect()`.
   *  - `dom-items` at sentinel → sentinel chip (same "Back to top"
   *    affordance — pops the frame instead of resetting index).
   *  - `blocks` at a block     → block SVG root's bounding rect
   *    (viewport coordinates work with our `position: fixed` outline).
   *  - `blocks` at sentinel    → sentinel chip.
   */
  private renderHighlight(): void {
    if (!this.highlightEl || !this.sentinelChip) return;
    const frame = this.activeFrame();
    if (!frame) {
      this.highlightEl.style.display = 'none';
      this.sentinelChip.style.display = 'none';
      return;
    }

    if (this.atSentinel(frame)) {
      this.highlightEl.style.display = 'none';
      this.sentinelChip.style.display = 'block';
      return;
    }

    // Pointing at a concrete target — hide chip, position outline.
    this.sentinelChip.style.display = 'none';

    let rect: DOMRect | null = null;
    if (frame.kind === 'top') {
      rect = this.regions[frame.index]?.getRect() ?? null;
    } else if (frame.kind === 'dom-items') {
      rect = frame.items[frame.index]?.getBoundingClientRect() ?? null;
    } else {
      const svgRoot = frame.blocks[frame.index]?.getSvgRoot();
      rect = svgRoot?.getBoundingClientRect() ?? null;
    }

    if (!rect || rect.width === 0 || rect.height === 0) {
      // Defensive: rect may briefly be unmeasurable (e.g. element
      // hidden mid-cycle); hide rather than splat a 0x0 outline at
      // (0,0). The next reflow / advance recovers.
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
   * Keydown handler. Routes both advance and select through whichever
   * frame is currently on top of the stack.
   *
   * Advance: increments the active frame's index modulo its cycle
   * length (real slots + sentinel).
   *
   * Select:
   *  - `top` at sentinel    → reset to index 0 (wrap).
   *  - `top` at `header` or `maze-actions` → push a DOM-item sub-scan
   *    frame for that region. (Toolbox / workspace are still log-only
   *    — Steps 6-7.)
   *  - `dom-items` at item  → fire `.click()` on the element, then pop
   *    the frame and resume the top scan at `popToTopIndex`.
   *  - `dom-items` at sentinel → pop the frame without firing.
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

    const frame = this.activeFrame();
    if (!frame) return;

    if (e.key === this.switchAdvance) {
      const len = this.cycleLen(frame);
      if (len > 0) {
        frame.index = (frame.index + 1) % len;
        this.renderHighlight();
      }
      return;
    }

    if (e.key === this.switchSelect) {
      this.handleSelect(frame);
      return;
    }
  }

  /**
   * Resolve a select keypress against the active frame.
   * Kept separate from {@link handleKeyDown} so the routing reads as a
   * flat dispatch table rather than nested conditionals.
   */
  private handleSelect(frame: ScanFrame): void {
    if (frame.kind === 'top') {
      if (this.atSentinel(frame)) {
        console.log('[switch-scan] selected sentinel: back to top');
        frame.index = 0;
        this.renderHighlight();
        return;
      }
      const region = this.regions[frame.index];
      if (!region) return;
      if (region.name === 'header' || region.name === 'maze-actions') {
        this.enterDomRegionSubScan(region.name, frame.index);
      } else if (region.name === 'toolbox') {
        this.enterToolboxSubScan(frame.index);
      } else {
        // Workspace sub-scan lands in Step 7. Until then, keep the
        // Step-3 log behavior so the wiring stays observable.
        console.log('[switch-scan] selected region:', region.name);
      }
      return;
    }

    if (frame.kind === 'dom-items') {
      if (this.atSentinel(frame)) {
        // Sentinel: bail out of the sub-scan without firing anything.
        this.popSubScan(frame.popToTopIndex);
        return;
      }
      const item = frame.items[frame.index];
      // Click first, then pop — if click() throws we still escape the
      // sub-scan rather than getting stuck on a broken item.
      try {
        item?.click();
      } finally {
        this.popSubScan(frame.popToTopIndex);
      }
      return;
    }

    // blocks frame (toolbox in Step 6; workspace in Step 7).
    if (this.atSentinel(frame)) {
      this.popSubScan(frame.popToTopIndex);
      return;
    }
    const block = frame.blocks[frame.index];
    if (frame.regionName === 'toolbox') {
      // Insert a new block of the same type into the MAIN workspace
      // (not the flyout workspace) via the shared heuristic. We do not
      // clone or move the flyout block itself — `block.type` plus the
      // insertion helper produces a fresh, properly-connected instance.
      try {
        if (block) {
          insertBlockAfterCursor(this.workspace, block.type);
        }
      } finally {
        this.popSubScan(frame.popToTopIndex);
      }
      return;
    }
    // Workspace block frame — Step 8 will push an action sub-scan here.
    // For now (won't trigger until Step 7 enables workspace scanning),
    // just pop.
    this.popSubScan(frame.popToTopIndex);
  }

  /**
   * Enter a DOM region's item sub-scan.
   *
   * Generic over any region whose buttons are tagged with
   * `data-scan-item` inside a `[data-scan-region="..."]` wrapper.
   * Currently used for `header` and `maze-actions`; the same plumbing
   * will serve any future plain-DOM region.
   *
   * Items are discovered fresh every entry (not cached) so that
   * buttons which become visible later — e.g. `#ghostRunButton` once
   * its `.hidden` class is removed on the right level — get picked up
   * without any cache invalidation logic.
   *
   * If discovery yields zero visible items (degenerate / fully hidden
   * region), we treat select as a no-op and just advance past the
   * region: skipping forward keeps the cycle progressing instead of
   * leaving the user stuck on an unactionable region.
   *
   * @param regionName     The region's `data-scan-region` value.
   * @param topLevelIndex  Top-level index of the region; used to
   *     compute where to resume when the sub-scan exits
   *     (`topLevelIndex + 1`, modulo cycle length). For the last real
   *     region (maze-actions) this lands on the top-level sentinel,
   *     which is the desired "you finished, now wrap" affordance.
   */
  private enterDomRegionSubScan(
    regionName: string,
    topLevelIndex: number,
  ): void {
    const items = this.discoverDomRegionItems(regionName);
    const topCycleLen = this.regions.length + 1;
    const popToTopIndex = (topLevelIndex + 1) % topCycleLen;

    if (items.length === 0) {
      // Nothing to scan — advance past the region so the user isn't
      // stuck. For maze-actions this still correctly lands on the
      // top-level sentinel via the modulo above.
      const topFrame = this.frameStack[0];
      if (topFrame && topFrame.kind === 'top') {
        topFrame.index = popToTopIndex;
        this.renderHighlight();
      }
      return;
    }

    this.frameStack.push({
      kind: 'dom-items',
      parentRegionName: regionName,
      items,
      index: 0,
      popToTopIndex,
    });
    this.renderHighlight();
  }

  /**
   * Pop the current sub-scan frame off the stack and resume the top
   * frame at `resumeIndex` (already-normalized by the caller, but we
   * mod again for safety against late region list changes).
   */
  private popSubScan(resumeIndex: number): void {
    this.frameStack.pop();
    const topFrame = this.frameStack[0];
    if (topFrame && topFrame.kind === 'top') {
      const topCycleLen = this.regions.length + 1;
      topFrame.index =
        topCycleLen > 0 ? ((resumeIndex % topCycleLen) + topCycleLen) % topCycleLen : 0;
    }
    this.renderHighlight();
  }

  /**
   * Enter the toolbox region's flyout-block sub-scan.
   *
   * Discovers the flyout's top blocks via Blockly's flyout API
   * (`workspace.getFlyout().getWorkspace().getTopBlocks(true)`) rather
   * than via DOM tagging, since flyout blocks are SVG elements not
   * tagged with `data-scan-item`. Filters out blocks that aren't
   * currently rendered / measurable (defensive against transiently
   * unrendered flyout state on first enable).
   *
   * If discovery yields zero blocks, advance past toolbox the same way
   * `enterDomRegionSubScan` advances past an empty DOM region.
   *
   * @param topLevelIndex  Top-level index of the toolbox region; used
   *     to compute `popToTopIndex` so the user resumes at the region
   *     AFTER toolbox once they exit the sub-scan (either by selecting
   *     a block to insert, or by hitting the sentinel).
   */
  private enterToolboxSubScan(topLevelIndex: number): void {
    const blocks = this.discoverFlyoutBlocks();
    const topCycleLen = this.regions.length + 1;
    const popToTopIndex = (topLevelIndex + 1) % topCycleLen;

    if (blocks.length === 0) {
      const topFrame = this.frameStack[0];
      if (topFrame && topFrame.kind === 'top') {
        topFrame.index = popToTopIndex;
        this.renderHighlight();
      }
      return;
    }

    this.frameStack.push({
      kind: 'blocks',
      regionName: 'toolbox',
      blocks,
      index: 0,
      popToTopIndex,
    });
    this.renderHighlight();
  }

  /**
   * Discover the flyout's currently-visible top-level blocks, in
   * flyout order. Returns `[]` if there's no flyout or its workspace
   * isn't reachable.
   *
   * "Visible" filter: block must have a rendered SVG root with a
   * non-zero bounding rect. Flyout categories or labels (non-block
   * elements) are naturally excluded because `getTopBlocks` only
   * returns Block instances.
   */
  private discoverFlyoutBlocks(): Blockly.BlockSvg[] {
    const flyout = this.workspace.getFlyout();
    if (!flyout) return [];
    const flyoutWs = flyout.getWorkspace();
    if (!flyoutWs) return [];

    const topBlocks = flyoutWs.getTopBlocks(true);
    const result: Blockly.BlockSvg[] = [];
    for (const block of topBlocks) {
      const blockSvg = block as Blockly.BlockSvg;
      const root = blockSvg.getSvgRoot?.();
      if (!root) continue;
      const rect = root.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      result.push(blockSvg);
    }
    return result;
  }

  /**
   * Find the visible `[data-scan-item]` descendants of the named
   * `[data-scan-region="<regionName>"]` wrapper in DOM order.
   *
   * Visibility filter handles:
   *  - `display: none` and the `.hidden` class (both null out
   *    `offsetParent` on non-fixed elements). Confirmed against
   *    `maze.css` — e.g. `#ghostRunButton.hidden { display: none }` —
   *    so the ghost-run button is correctly dropped on levels where
   *    it isn't enabled.
   *  - Zero-width layouts (collapsed flex containers, etc.).
   *
   * Returns `[]` if the region wrapper itself is missing.
   */
  private discoverDomRegionItems(regionName: string): HTMLElement[] {
    const regionEl = document.querySelector<HTMLElement>(
      `[data-scan-region="${regionName}"]`,
    );
    if (!regionEl) return [];
    const nodeList = regionEl.querySelectorAll<HTMLElement>('[data-scan-item]');
    const items: HTMLElement[] = [];
    nodeList.forEach((el) => {
      // offsetParent === null catches display:none and .hidden;
      // width === 0 catches collapsed / unmeasured layouts.
      if (el.offsetParent === null) return;
      if (el.getBoundingClientRect().width === 0) return;
      items.push(el);
    });
    return items;
  }
}
