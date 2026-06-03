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
 * Step 8 (current): top-level scan loop across four regions
 * (header / toolbox / workspace / maze-actions) plus a "back to top"
 * sentinel, generic DOM-item sub-scan for header / maze-actions, a
 * Blockly-block sub-scan for the toolbox flyout (selecting inserts a
 * new instance via the shared {@link insertBlockAfterCursor} helper),
 * a Blockly-block sub-scan for the workspace itself in tree order, and
 * — when the user selects a workspace block — an inline ACTION MENU
 * (Select / Edit / Delete) anchored next to the block. Edit opens a
 * nested dropdown-values sub-scan over the FIRST editable
 * `Blockly.FieldDropdown` on the block (v1 limitation — multi-dropdown
 * blocks would need a field-picker step, deferred). All three actions
 * pop straight back to the top-level frame for consistency: even
 * Select/Edit, where the underlying workspace frame is still valid,
 * pops to top so the cursor-commit / value-change reads as a clean
 * transition rather than dropping the user back into the middle of a
 * workspace scan.
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
    }
  | {
      kind: 'action-menu';
      block: Blockly.BlockSvg;
      items: ActionItem[];
      index: number;
      popToTopIndex: number;
    }
  | {
      kind: 'dropdown-values';
      block: Blockly.BlockSvg;
      field: Blockly.FieldDropdown;
      options: Array<
        [string | {src: string; width: number; height: number; alt: string}, string]
      >;
      index: number;
      popToTopIndex: number;
    };

/**
 * One row in the inline action menu shown when the user selects a
 * workspace block. `key` drives behavior in {@link handleSelect}; the
 * human-readable `label` is what we render in the overlay.
 */
interface ActionItem {
  key: 'select' | 'edit' | 'delete';
  label: string;
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

  // Stack of active scan frames. The last entry is the active frame.
  // Always non-empty while enabled (seeded with a `top` frame in
  // `enable()` and reset on `disable()`).
  private frameStack: ScanFrame[] = [];

  // DOM overlay elements; created once per enable, removed on disable.
  private highlightEl: HTMLDivElement | null = null;
  private sentinelChip: HTMLDivElement | null = null;

  // Inline action / dropdown menus shown next to a workspace block when
  // the user enters the action sub-scan. Lazily created on first use and
  // removed when the corresponding frame is popped.
  private actionMenuEl: HTMLDivElement | null = null;
  private dropdownMenuEl: HTMLDivElement | null = null;

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
    this.actionMenuEl?.remove();
    this.dropdownMenuEl?.remove();
    this.highlightEl = null;
    this.sentinelChip = null;
    this.actionMenuEl = null;
    this.dropdownMenuEl = null;

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
    if (frame.kind === 'blocks') return frame.blocks.length + 1;
    if (frame.kind === 'action-menu') return frame.items.length + 1;
    return frame.options.length + 1;
  }

  /**
   * `true` iff the frame's index points at its sentinel slot.
   */
  private atSentinel(frame: ScanFrame): boolean {
    if (frame.kind === 'top') return frame.index === this.regions.length;
    if (frame.kind === 'dom-items') return frame.index === frame.items.length;
    if (frame.kind === 'blocks') return frame.index === frame.blocks.length;
    if (frame.kind === 'action-menu') return frame.index === frame.items.length;
    return frame.index === frame.options.length;
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
    } else if (frame.kind === 'blocks') {
      const svgRoot = frame.blocks[frame.index]?.getSvgRoot();
      rect = svgRoot?.getBoundingClientRect() ?? null;
    } else if (frame.kind === 'action-menu') {
      // Highlight the currently-focused menu row inside the overlay.
      // The block underneath is implicitly the subject of every action,
      // identifiable by the menu's anchor position next to it — so we
      // intentionally don't outline the block here.
      const itemEl = this.actionMenuEl?.querySelector<HTMLElement>(
        `[data-scan-action-item="${frame.index}"]`,
      );
      rect = itemEl?.getBoundingClientRect() ?? null;
    } else {
      // dropdown-values
      const itemEl = this.dropdownMenuEl?.querySelector<HTMLElement>(
        `[data-scan-dropdown-item="${frame.index}"]`,
      );
      rect = itemEl?.getBoundingClientRect() ?? null;
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
      } else if (region.name === 'workspace') {
        this.enterWorkspaceSubScan(frame.index);
      } else {
        // Unknown region — keep the Step-3 log behavior so any future
        // region added to `discoverRegions` without a routing branch
        // surfaces in the console rather than silently no-op'ing.
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

    if (frame.kind === 'blocks') {
      if (this.atSentinel(frame)) {
        this.popSubScan(frame.popToTopIndex);
        return;
      }
      const block = frame.blocks[frame.index];
      if (frame.regionName === 'toolbox') {
        // Insert a new block of the same type into the MAIN workspace
        // (not the flyout workspace) via the shared heuristic. We do
        // not clone or move the flyout block itself — `block.type` plus
        // the insertion helper produces a fresh, properly-connected
        // instance.
        try {
          if (block) {
            insertBlockAfterCursor(this.workspace, block.type);
          }
        } finally {
          this.popSubScan(frame.popToTopIndex);
        }
        return;
      }
      // Workspace block frame: open the action sub-scan menu anchored
      // next to this block. `popToTopIndex` matches what the workspace
      // sub-scan itself would use — after acting on the block we land
      // straight back at the top, past the workspace region.
      if (block) {
        this.enterActionMenu(block, frame.popToTopIndex);
      }
      return;
    }

    if (frame.kind === 'action-menu') {
      if (this.atSentinel(frame)) {
        // "Back to top" sentinel — bail out without acting on the block.
        this.popSubScan(frame.popToTopIndex);
        return;
      }
      const item = frame.items[frame.index];
      const block = frame.block;
      if (!item) {
        this.popSubScan(frame.popToTopIndex);
        return;
      }
      if (item.key === 'select') {
        // Commit Blockly's FocusManager to this block so the shared
        // `insertBlockAfterCursor` heuristic places subsequent toolbox
        // insertions after it.
        try {
          Blockly.getFocusManager().focusNode(block);
        } catch (err) {
          // Defensive: focusNode can throw if the block was disposed
          // out from under us between menu open and selection. Pop
          // anyway so the user isn't stranded.
          console.warn('[switch-scan] focusNode failed:', err);
        }
        this.popSubScan(frame.popToTopIndex);
        return;
      }
      if (item.key === 'delete') {
        // Group disposal so undo treats it as a single step. Pop to top
        // unconditionally — even if dispose throws, the workspace frame
        // beneath us is stale (its block list is built from
        // pre-disposal state), so returning to it would be incorrect.
        try {
          Blockly.Events.setGroup(true);
          try {
            block.dispose(true, true);
          } finally {
            Blockly.Events.setGroup(false);
          }
        } catch (err) {
          console.warn('[switch-scan] block.dispose failed:', err);
        }
        this.popSubScan(frame.popToTopIndex);
        return;
      }
      if (item.key === 'edit') {
        // Push a nested dropdown-values frame. The Edit option is only
        // present when there's at least one editable FieldDropdown, so
        // this lookup should succeed; defensively fall back to pop-to-
        // top if it doesn't.
        const field = this.findFirstEditableDropdown(block);
        if (!field) {
          this.popSubScan(frame.popToTopIndex);
          return;
        }
        this.enterDropdownValues(block, field, frame.popToTopIndex);
        return;
      }
      return;
    }

    if (frame.kind === 'dropdown-values') {
      if (this.atSentinel(frame)) {
        // Bail without changing the field's value. We still pop both
        // the dropdown-values frame AND the action-menu frame beneath
        // it, mirroring the design choice that any exit from the
        // edit-flow lands the user back at the top frame.
        this.popDropdownToTop(frame.popToTopIndex);
        return;
      }
      const option = frame.options[frame.index];
      if (option) {
        try {
          frame.field.setValue(option[1]);
        } catch (err) {
          console.warn('[switch-scan] field.setValue failed:', err);
        }
      }
      // Pop BOTH frames (dropdown-values then action-menu) and land at
      // the top-level frame's `popToTopIndex`. v1 design choice: pop
      // straight to top after edit, rather than back to the action menu
      // — simpler, and treats "Edit" as a single committed action.
      this.popDropdownToTop(frame.popToTopIndex);
      return;
    }
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
   * Pop sub-scan frames off the stack until only the top-level `top`
   * frame remains, then set that frame's index to `resumeIndex`.
   *
   * Popping all non-`top` frames (rather than just the immediate
   * caller) matters for the action-menu flow: a Select/Delete/sentinel
   * from `action-menu` lands us back at top, skipping past the
   * workspace blocks frame underneath. Post-delete the workspace
   * frame's `blocks[]` holds a stale reference, so resuming it would be
   * incorrect; and post-select/edit we deliberately pop to top too, for
   * consistency. Tear down any owned overlay DOM as we go.
   *
   * For the simpler dom-items / blocks-from-toolbox case, this is still
   * a single pop because there's only one non-top frame on the stack.
   */
  private popSubScan(resumeIndex: number): void {
    while (
      this.frameStack.length > 0 &&
      this.frameStack[this.frameStack.length - 1].kind !== 'top'
    ) {
      const popped = this.frameStack.pop();
      // Tear down any DOM that belonged to the popped frame.
      if (popped?.kind === 'action-menu') {
        this.actionMenuEl?.remove();
        this.actionMenuEl = null;
      } else if (popped?.kind === 'dropdown-values') {
        this.dropdownMenuEl?.remove();
        this.dropdownMenuEl = null;
      }
    }
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
   * Enter the workspace region's block sub-scan.
   *
   * Mirrors {@link enterToolboxSubScan} but over the main workspace's
   * blocks (via {@link discoverWorkspaceBlocks}) in tree order. If
   * discovery yields zero blocks (empty workspace), advance past the
   * region the same way the toolbox / DOM helpers do, so the user
   * isn't stuck on an empty workspace.
   *
   * @param topLevelIndex  Top-level index of the workspace region;
   *     used to compute `popToTopIndex` so the user resumes at the
   *     region AFTER workspace once they exit the sub-scan (via the
   *     sentinel — Step 7 select doesn't pop yet).
   */
  private enterWorkspaceSubScan(topLevelIndex: number): void {
    const blocks = this.discoverWorkspaceBlocks();
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
      regionName: 'workspace',
      blocks,
      index: 0,
      popToTopIndex,
    });
    this.renderHighlight();
  }

  /**
   * Discover the main workspace's blocks in tree order, matching how
   * a programmer reads code top-to-bottom.
   *
   * Traversal rule, applied to each top block from
   * `workspace.getTopBlocks(true)` in order:
   *  1. Yield the block itself.
   *  2. For each input on `block.inputList`, if it has a `connection`
   *     whose `targetBlock()` is non-null, recurse into that subtree
   *     BEFORE moving on. This is what makes us descend into statement
   *     inputs (e.g. the body of a `repeat`) before continuing.
   *  3. After all inputs are processed, follow
   *     `block.nextConnection.targetBlock()` to the next sibling along
   *     the stack chain and repeat from step 1.
   *
   * The filter `block.getSvgRoot() != null` drops non-rendered
   * placeholders (e.g. blocks that exist in the model but haven't been
   * rendered yet — rare in the maze game but cheap insurance).
   *
   * Staleness: in the controlled switch-only flow, blocks don't get
   * disposed between a frame push and the next interaction without the
   * user driving it; we don't bother with weak refs. The 0x0-rect hide
   * path in {@link renderHighlight} already handles the rare case of a
   * block being removed mid-cycle.
   */
  private discoverWorkspaceBlocks(): Blockly.BlockSvg[] {
    const result: Blockly.BlockSvg[] = [];
    const visit = (block: Blockly.Block | null): void => {
      if (!block) return;
      const blockSvg = block as Blockly.BlockSvg;
      if (blockSvg.getSvgRoot && blockSvg.getSvgRoot() != null) {
        result.push(blockSvg);
      }
      // Descend into statement / value inputs first, in input-list order.
      for (const input of block.inputList) {
        const conn = input.connection;
        if (conn) {
          const target = conn.targetBlock();
          if (target) visit(target);
        }
      }
      // Then continue along the next-connection chain.
      const nextConn = block.nextConnection;
      if (nextConn) {
        const next = nextConn.targetBlock();
        if (next) visit(next);
      }
    };
    const topBlocks = this.workspace.getTopBlocks(true);
    for (const top of topBlocks) {
      visit(top);
    }
    return result;
  }

  /**
   * Push the action-menu sub-scan for `block`, anchored adjacent to it.
   *
   * Item set is determined here, not statically:
   *  - `Select` and `Delete` are always present.
   *  - `Edit` is conditional on the block having at least one editable
   *    `Blockly.FieldDropdown` (v1 limitation: if there are multiple
   *    editable dropdowns, we'll edit the FIRST one — see
   *    {@link findFirstEditableDropdown}; multi-field handling is a
   *    later-phase enhancement).
   *
   * `popToTopIndex` is the workspace frame's own `popToTopIndex` — by
   * design every action (Select / Edit / Delete) and the sentinel pop
   * straight back to the top-level frame, skipping the workspace
   * sub-scan beneath. This keeps the "you committed an action" boundary
   * visually obvious and avoids the staleness problem after Delete.
   */
  private enterActionMenu(
    block: Blockly.BlockSvg,
    popToTopIndex: number,
  ): void {
    const items: ActionItem[] = [{key: 'select', label: 'Select'}];
    if (this.findFirstEditableDropdown(block)) {
      items.push({key: 'edit', label: 'Edit'});
    }
    items.push({key: 'delete', label: 'Delete'});

    this.frameStack.push({
      kind: 'action-menu',
      block,
      items,
      index: 0,
      popToTopIndex,
    });
    this.renderActionMenu(block, items);
    this.renderHighlight();
  }

  /**
   * Push the dropdown-values sub-scan for `field` on `block`. Selecting
   * an option calls `field.setValue(option[1])` and pops all the way to
   * top. The action-menu overlay is torn down at the same time so the
   * dropdown menu is the only visible overlay while editing.
   */
  private enterDropdownValues(
    block: Blockly.BlockSvg,
    field: Blockly.FieldDropdown,
    popToTopIndex: number,
  ): void {
    // FieldDropdown.getOptions returns MenuOption[] where each option
    // is `[labelOrImage, value]`. We narrow to the subset our renderer
    // can display (string label OR image-object label) and drop any
    // 'separator' entries — separators don't appear in the maze game's
    // own dropdowns but the type allows them in general.
    const raw = field.getOptions(false);
    const options: Array<
      [string | {src: string; width: number; height: number; alt: string}, string]
    > = [];
    for (const opt of raw) {
      if (opt === 'separator') continue;
      const [label, value] = opt as [unknown, string];
      if (typeof label === 'string') {
        options.push([label, value]);
      } else if (
        label &&
        typeof label === 'object' &&
        'src' in (label as object)
      ) {
        const img = label as {
          src: string;
          width: number;
          height: number;
          alt: string;
        };
        options.push([img, value]);
      } else {
        // HTMLElement labels (rare): mirror Blockly's own getText_ for
        // FieldDropdown — prefer title, then ariaLabel, then innerText —
        // so the menu row shows something readable instead of the
        // default `[object HTMLDivElement]` you'd get from String(label).
        let text = '';
        if (label && typeof label === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyLabel = label as any;
          text =
            (typeof anyLabel.title === 'string' && anyLabel.title) ||
            (typeof anyLabel.ariaLabel === 'string' && anyLabel.ariaLabel) ||
            (typeof anyLabel.innerText === 'string' && anyLabel.innerText) ||
            (typeof anyLabel.textContent === 'string' && anyLabel.textContent) ||
            '';
        }
        options.push([text || value, value]);
      }
    }

    // Tear down the action menu so only the dropdown overlay is visible
    // while the user picks a value. The action-menu frame is still on
    // the stack underneath (so popping the dropdown frame surfaces it
    // again in code), but visually we replace one overlay with another.
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;

    this.frameStack.push({
      kind: 'dropdown-values',
      block,
      field,
      options,
      index: 0,
      popToTopIndex,
    });
    this.renderDropdownMenu(block, options);
    this.renderHighlight();
  }

  /**
   * Find the first editable `Blockly.FieldDropdown` on `block`, scanning
   * inputs in `inputList` order, fields in `fieldRow` order. Returns
   * `null` if none. v1 limitation: blocks with multiple editable
   * dropdowns only expose the first to the Edit flow — adequate for the
   * current maze blocks (`maze_turn`'s `DIR`, `maze_if`'s `DIR`,
   * `maze_repeatTimes`'s `TIMES`, etc., each have exactly one).
   */
  private findFirstEditableDropdown(
    block: Blockly.BlockSvg,
  ): Blockly.FieldDropdown | null {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (
          field instanceof Blockly.FieldDropdown &&
          // EDITABLE is a static-ish boolean Blockly sets per-field
          // class; cast is needed because the public typing exposes it
          // as a class-level prop, not an instance-readable one.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (field as any).EDITABLE !== false
        ) {
          return field;
        }
      }
    }
    return null;
  }

  /**
   * (Re)build the action-menu overlay DOM and anchor it adjacent to
   * `block`. We rebuild on every entry rather than keeping a long-lived
   * element so the item list can change per block (Edit is conditional).
   *
   * Anchoring heuristic: default below-left of the block; if that would
   * overflow the viewport bottom, switch to right-of the block. Simple
   * two-fallback rule is enough for the maze game's compact layout.
   */
  private renderActionMenu(
    block: Blockly.BlockSvg,
    items: ActionItem[],
  ): void {
    this.actionMenuEl?.remove();
    const el = document.createElement('div');
    el.className = 'switch-scan-action-menu';
    for (let i = 0; i < items.length; i++) {
      const row = document.createElement('div');
      row.className = 'switch-scan-menu-item';
      row.setAttribute('data-scan-action-item', String(i));
      row.textContent = items[i].label;
      el.appendChild(row);
    }
    document.body.appendChild(el);
    this.actionMenuEl = el;
    this.anchorMenuToBlock(el, block);
  }

  /**
   * (Re)build the dropdown-values overlay DOM and anchor it adjacent to
   * `block`. Image options render as `<img>` so direction arrows etc.
   * show pictographically; string options render as text.
   */
  private renderDropdownMenu(
    block: Blockly.BlockSvg,
    options: Array<
      [string | {src: string; width: number; height: number; alt: string}, string]
    >,
  ): void {
    this.dropdownMenuEl?.remove();
    const el = document.createElement('div');
    el.className = 'switch-scan-dropdown-menu';
    for (let i = 0; i < options.length; i++) {
      const row = document.createElement('div');
      row.className = 'switch-scan-menu-item';
      row.setAttribute('data-scan-dropdown-item', String(i));
      const label = options[i][0];
      if (typeof label === 'string') {
        row.textContent = label;
      } else {
        const img = document.createElement('img');
        img.src = label.src;
        img.width = label.width;
        img.height = label.height;
        img.alt = label.alt;
        row.appendChild(img);
      }
      el.appendChild(row);
    }
    document.body.appendChild(el);
    this.dropdownMenuEl = el;
    this.anchorMenuToBlock(el, block);
  }

  /**
   * Position `menuEl` (fixed-positioned by CSS) adjacent to `block`.
   * Default: just below the block, left-aligned. Fallback: if the menu
   * would overflow the viewport bottom, anchor to the right of the
   * block instead.
   */
  private anchorMenuToBlock(
    menuEl: HTMLElement,
    block: Blockly.BlockSvg,
  ): void {
    const root = block.getSvgRoot?.();
    if (!root) return;
    const r = root.getBoundingClientRect();
    // Measure menu after appending so the fallback heuristic has real
    // dimensions to compare against the viewport.
    const menuRect = menuEl.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const wouldOverflowBottom = r.bottom + 8 + menuRect.height > viewportH;
    if (wouldOverflowBottom) {
      menuEl.style.top = `${r.top}px`;
      menuEl.style.left = `${r.right + 8}px`;
    } else {
      menuEl.style.top = `${r.bottom + 8}px`;
      menuEl.style.left = `${r.left}px`;
    }
  }

  /**
   * Pop the entire edit flow (dropdown-values frame, action-menu frame,
   * and the workspace blocks frame beneath them) and resume the top
   * frame at `resumeIndex`. Used after a dropdown value is picked OR
   * after the dropdown-values sentinel is selected — either way the
   * edit flow is over and v1 design pops straight to top (rather than
   * back to the action menu).
   *
   * Implemented as a thin wrapper around {@link popSubScan} since that
   * already pops all non-top frames and tears down our overlays — but
   * we keep the named entry point so call sites read clearly as "exit
   * the edit flow", not "pop a sub-scan".
   */
  private popDropdownToTop(resumeIndex: number): void {
    this.popSubScan(resumeIndex);
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
