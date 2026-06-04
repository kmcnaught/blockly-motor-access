/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Controller for Maze game (Phase 1 complete).
 *
 * Drives a two-switch step-scanning input mode for users with severe
 * motor impairments who access the page via two physical switches (or
 * two assigned keys, e.g. via Grid 3 sending keyboard events). One key
 * advances a visible highlight across scannable regions/items; the
 * other selects the currently highlighted target.
 *
 * Activation + key bindings come from URL params (read in `index.ts`,
 * forwarded to the constructor via {@link SwitchScanOptions}):
 *  - `inputMode=switch-scan` — activate the controller. When unset,
 *    the controller is NEVER instantiated and binds NO listeners — the
 *    default-mode page behaves exactly as before.
 *  - `switchAdvance` — advance key, as either a `KeyboardEvent.key`
 *    value (`' '`) or the alias `'Space'`. Default `' '` (Space).
 *  - `switchSelect` — select key, as a `KeyboardEvent.key` value.
 *    Default `'Enter'`.
 *
 * Mutual exclusion: this controller is mutually exclusive with grid
 * coding mode (`?grid=1`). `index.ts` will not instantiate
 * `GridCodingModeController` when `inputMode=switch-scan` is set —
 * only one input-augmentation controller runs at a time.
 *
 * Full design / phased plan: see `PLAN_switch_scanning.md` at the
 * repository root and `.claude/scratchpad/current-plan.md`.
 *
 * Behavior summary (Phase 1, completed): top-level scan loop across
 * four regions (header / toolbox / workspace / maze-actions) plus a
 * "back to top" sentinel; generic DOM-item sub-scan for header /
 * maze-actions; a Blockly-block sub-scan for the toolbox flyout
 * (selecting inserts a new instance via the shared
 * {@link insertBlockAfterCursor} helper); a Blockly-block sub-scan
 * for the workspace itself in tree order; and — when the user selects
 * a workspace block — an inline ACTION MENU (Select / Edit / Delete)
 * anchored next to the block. Edit opens a nested dropdown-values
 * sub-scan over the FIRST editable `Blockly.FieldDropdown` on the
 * block (v1 limitation — multi-dropdown blocks would need a
 * field-picker step, deferred). All three actions pop straight back
 * to the top-level frame for consistency: even Select/Edit, where the
 * underlying workspace frame is still valid, pops to top so the
 * cursor-commit / value-change reads as a clean transition rather
 * than dropping the user back into the middle of a workspace scan.
 * Scanning is paused while the maze program runs (highlight, sentinel,
 * and any open menus are torn down; key input short-circuits) and
 * resumes on a clean top-level frame (header, index 0) when the run
 * finishes via any path — success, failure, timeout, error, or reset
 * interrupt — all of which surface through a single
 * `MazeGame.onExecutionStateChange` subscription.
 *
 * Out of scope for Phase 1 (deferred to later phases — see the design
 * doc for the planned rollout):
 *  - No in-page settings UI: keys are URL params only.
 *  - No Move action in the block action menu (Select / Edit / Delete
 *    only).
 *  - No header dropdown sub-scans (level picker etc. — the existing
 *    pegman dropdown is reachable via the header sub-scan but its
 *    sub-menu items aren't yet scannable as a nested region).
 *  - No single-switch auto-scan mode — two-switch step scan only.
 *  - No TTS / audio cue layer.
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
 *
 * @param key
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
 *    index === items.length. `topLevelIndex` is the index of the
 *    top-level region the user entered THIS sub-scan from — pop helpers
 *    derive the resume index from it (same region for sentinel pops, the
 *    NEXT region for action-completed pops). See {@link popToSameRegion}
 *    and {@link popToNextRegion}.
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
      topLevelIndex: number;
    }
  | {
      kind: 'blocks';
      regionName: 'toolbox' | 'workspace';
      blocks: Blockly.BlockSvg[];
      index: number;
      topLevelIndex: number;
    }
  | {
      kind: 'action-menu';
      block: Blockly.BlockSvg;
      items: ActionItem[];
      index: number;
      topLevelIndex: number;
    }
  | {
      kind: 'dropdown-values';
      block: Blockly.BlockSvg;
      field: Blockly.FieldDropdown;
      options: Array<
        [string | {src: string; width: number; height: number; alt: string}, string]
      >;
      index: number;
      topLevelIndex: number;
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
  // True while the maze is running a user program. Set by the
  // execution-state subscription; gates key input and overlay rendering
  // so the highlight isn't competing with the maze animation for the
  // user's attention. Independent from `enabled` — a disabled
  // controller doesn't care about run state, but an enabled controller
  // that's `executing` ignores advance/select keys and shows no
  // overlays until the run ends.
  private executing = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;
  private boundReflow: () => void;
  // Subscription registered with mazeGame.onExecutionStateChange.
  // Stored so disable() can null its inner reference (the maze callback
  // list itself is owned by MazeGame and we don't have an unsubscribe
  // API; the no-op closure pattern is the cheapest safe equivalent).
  private boundExecutionStateHandler: (isExecuting: boolean) => void;
  // Set to true once we've registered the execution-state subscription
  // so re-enable doesn't double-register on the maze's callback list.
  private executionStateSubscribed = false;

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
    // Wrap with an `enabled` guard so a late-firing callback after a
    // disable() (e.g. user toggled modes mid-run) is a no-op rather
    // than a crash on torn-down state.
    this.boundExecutionStateHandler = (isExecuting: boolean) => {
      if (!this.enabled) return;
      if (isExecuting) {
        this.handleRunStart();
      } else {
        this.handleRunEnd();
      }
    };
  }

  /**
   * Enable switch scan mode.
   */
  enable(): void {
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

    // Subscribe to maze execution state ONCE — MazeGame stores
    // callbacks in a list with no unsubscribe API, so re-enabling
    // would otherwise duplicate our handler. The `enabled` guard in
    // boundExecutionStateHandler makes re-subscription unnecessary
    // anyway: a no-op fires when disabled, and the handler fires
    // correctly again on next enable.
    if (!this.executionStateSubscribed) {
      this.mazeGame.onExecutionStateChange(this.boundExecutionStateHandler);
      this.executionStateSubscribed = true;
    }

    // If a run is somehow already in flight at enable() time (rare —
    // user toggled into switch-scan during a running program), reflect
    // that state immediately so we don't render a highlight on top of
    // the animation.
    if (this.mazeGame.isExecuting()) {
      this.executing = true;
      this.tearDownOverlaysForRun();
    } else {
      // Initial render so the user sees the highlight immediately.
      this.renderHighlight();
    }
  }

  /**
   * Disable switch scan mode.
   */
  disable(): void {
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
    // Clear executing — if we re-enable later we'll resync from
    // mazeGame.isExecuting() in enable(). NB: we deliberately don't
    // attempt to unsubscribe the execution-state callback (MazeGame
    // has no removal API); boundExecutionStateHandler's `enabled`
    // guard makes any late-firing callback a safe no-op.
    this.executing = false;
  }

  /**
   * Check if switch scan mode is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the MazeGame reference (called when level changes).
   *
   * @param mazeGame
   */
  setMazeGame(mazeGame: MazeGame): void {
    this.mazeGame = mazeGame;
  }

  /**
   * Update the advance / select key bindings.
   * Keys use `KeyboardEvent.key` string values; aliases like `'Space'`
   * are normalized.
   *
   * @param switchAdvance
   * @param switchSelect
   */
  setKeys(switchAdvance: string, switchSelect: string): void {
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

    // Workspace — the visible workspace area MINUS the toolbox/flyout.
    // The injectionDiv contains both the toolbox/flyout AND the main
    // workspace SVG, so its raw bounding rect would over-cover the
    // region and visually overlap the toolbox region's outline.
    // Instead, use Blockly's own metrics: viewWidth/viewHeight describe
    // the visible workspace (flyout excluded), and absoluteLeft/
    // absoluteTop give that view's offset within the injection div.
    // Translate to viewport coords by anchoring to the injection div's
    // bounding rect. This matches the workspace focus ring used by
    // src/index.ts:resizeFocusRingInternal.
    //
    // Visual nudge: shift the outline LEFT by `toolbox_width / 10` and
    // narrow it by `toolbox_width / 6` so the rect doesn't visually
    // hug the full available width. Toolbox width is read from
    // `toolboxRectFn` (captured above) at render time so it tracks
    // resizes; if the toolbox isn't measurable yet (null rect or zero
    // width), fall through to the unmodified workspace rect.
    const injectionDiv = this.workspace.getInjectionDiv();
    const capturedToolboxRectFn = toolboxRectFn;
    if (injectionDiv) {
      regions.push({
        name: 'workspace',
        getRect: () => {
          const base = this.getWorkspaceViewportRect(injectionDiv);
          if (!base) return null;
          const toolboxRect = capturedToolboxRectFn?.() ?? null;
          const toolboxWidth = toolboxRect?.width ?? 0;
          if (!toolboxWidth) return base;
          const leftShift = toolboxWidth / 10;
          const widthReduction = toolboxWidth / 6;
          return new DOMRect(
            base.left - leftShift,
            base.top,
            base.width - widthReduction,
            base.height,
          );
        },
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
   * Compute the viewport-coordinate rect of the main workspace view
   * area, excluding the toolbox/flyout. Used by the `workspace` top-
   * level region so its outline hugs the workspace and doesn't bleed
   * into the toolbox region (which already has its own highlight).
   *
   * Combines:
   *  - `injectionDiv.getBoundingClientRect()` for viewport anchoring,
   *  - `workspace.getMetrics()` `absoluteLeft`/`absoluteTop` for the
   *    offset of the visible workspace within the injection div,
   *  - `viewWidth`/`viewHeight` for the visible workspace's size.
   *
   * Returns `null` if metrics aren't yet measurable (rare — defends
   * against an unrendered workspace; the renderer hides the outline
   * for null rects).
   *
   * @param injectionDiv
   */
  private getWorkspaceViewportRect(injectionDiv: Element): DOMRect | null {
    const m = this.workspace.getMetrics();
    if (!m) return null;
    const divRect = injectionDiv.getBoundingClientRect();
    return new DOMRect(
      divRect.left + m.absoluteLeft,
      divRect.top + m.absoluteTop,
      m.viewWidth,
      m.viewHeight,
    );
  }

  /**
   * Compute the viewport-coordinate rect of a SINGLE workspace block,
   * excluding any blocks connected via `nextConnection` or nested in its
   * statement inputs.
   *
   * Why not `block.getSvgRoot().getBoundingClientRect()`: a block's SVG
   * `<g>` element visually contains every descendant block (the next-
   * block stack, children of value/statement inputs), so its DOM
   * bounding rect over-covers — the outline would wrap the whole stack
   * instead of the one block being scanned.
   *
   * Approach: Blockly's `BlockSvg.getBoundingRectangleWithoutChildren()`
   * returns a {@link Blockly.utils.Rect} in WORKSPACE coordinates that
   * uses the block's own `height`/`width` only (no descendants). We
   * convert each corner to viewport (screen) coordinates via the public
   * `Blockly.utils.svgMath.wsToScreenCoordinates` helper — same path
   * Blockly itself uses for context-menu placement — which folds in
   * workspace scale, scroll, the injection div's viewport offset, and
   * the workspace origin offset in one call.
   *
   * Returns `null` if the block has no rendered SVG root (the renderer
   * already skips these elsewhere; this is just defensive).
   *
   * Reusable: also the right rect to anchor the per-block action menu
   * to (Step 4) — anchoring off the SVG-root rect drops the menu below
   * the entire stack instead of below the current block.
   *
   * @param block
   */
  private getSingleBlockViewportRect(
    block: Blockly.BlockSvg,
  ): DOMRect | null {
    if (!block.getSvgRoot?.()) return null;
    const wsRect = block.getBoundingRectangleWithoutChildren();
    const topLeft = Blockly.utils.svgMath.wsToScreenCoordinates(
      this.workspace,
      new Blockly.utils.Coordinate(wsRect.left, wsRect.top),
    );
    const bottomRight = Blockly.utils.svgMath.wsToScreenCoordinates(
      this.workspace,
      new Blockly.utils.Coordinate(wsRect.right, wsRect.bottom),
    );
    // RTL: workspace `left` may be > `right` numerically, but converting
    // both corners and re-normalising via min/max keeps the DOMRect's
    // width/height positive without us caring which direction is which.
    const left = Math.min(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const width = Math.abs(bottomRight.x - topLeft.x);
    const height = Math.abs(bottomRight.y - topLeft.y);
    return new DOMRect(left, top, width, height);
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
   *
   * @param frame
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
   *
   * @param frame
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
      const block = frame.blocks[frame.index];
      if (frame.regionName === 'workspace' && block) {
        // For workspace blocks we want the outline to hug ONLY the
        // current block, not the connected stack below it. The block's
        // SVG root visually contains all descendants/next-blocks, so
        // its raw bounding rect over-covers. See
        // {@link getSingleBlockViewportRect} for the conversion.
        rect = this.getSingleBlockViewportRect(block);
      } else {
        // Toolbox flyout blocks aren't stacked, so the SVG root rect
        // already hugs just the one block.
        const svgRoot = block?.getSvgRoot();
        rect = svgRoot?.getBoundingClientRect() ?? null;
      }
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
   * Pause the scanner while a maze run is in flight. Hides every
   * overlay (highlight, sentinel chip, action menu, dropdown menu) so
   * the maze animation reads cleanly, and flips `executing` so
   * `handleKeyDown` early-returns. The {@link frameStack} is left
   * untouched here — we don't reset until run-end so the bookkeeping
   * stays simple, and the user can never observe an intermediate state
   * because we hide everything while paused anyway.
   *
   * Note: action / dropdown overlays are torn down (not just hidden)
   * to match the existing lifecycle — they're recreated on demand by
   * `renderActionMenu` / `renderDropdownMenu`, and tearing them down
   * here means we don't have to remember they exist when resetting
   * the frameStack on run-end.
   */
  private handleRunStart(): void {
    this.executing = true;
    this.tearDownOverlaysForRun();
  }

  /**
   * Resume the scanner after a maze run finishes (success, failure,
   * timeout, error, or reset interrupt — MazeGame's start/cancel/
   * showResult/reset paths all fire the same `false` notification).
   *
   * Restores the user to a clean top-level frame at index 0 (header)
   * — chosen over "resume where they were" so it's predictable: after
   * a run, the highlight is always back at the top, ready for the
   * next interaction.
   */
  private handleRunEnd(): void {
    this.executing = false;
    // Fresh top frame so the user always restarts at the header.
    this.frameStack = [{kind: 'top', index: 0}];
    this.renderHighlight();
  }

  /**
   * Hide overlays during a run. Highlight + sentinel are just set to
   * `display: none` (kept in the DOM, cheap to re-show); the action
   * and dropdown menus are removed entirely since their lifecycle is
   * "exists while the corresponding frame is on top." `handleRunEnd`
   * resets the frameStack to a fresh top, so any frames that owned
   * those overlays are gone anyway.
   */
  private tearDownOverlaysForRun(): void {
    if (this.highlightEl) this.highlightEl.style.display = 'none';
    if (this.sentinelChip) this.sentinelChip.style.display = 'none';
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;
    this.dropdownMenuEl?.remove();
    this.dropdownMenuEl = null;
  }

  /**
   * Coalesce resize/scroll bursts into a single rAF-paced re-render so
   * we don't thrash layout while the user drags the window or scrolls.
   */
  private scheduleReflow(): void {
    if (this.reflowRafHandle !== null) return;
    this.reflowRafHandle = requestAnimationFrame(() => {
      this.reflowRafHandle = null;
      // Don't re-show overlays during a run: the run-end handler will
      // re-render on a clean top-frame anyway, and resizing mid-run
      // shouldn't pop the scanner back on top of the animation.
      if (this.executing) return;
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
   * - `top` at sentinel    → reset to index 0 (wrap).
   * - `top` at any region  → push the appropriate sub-scan frame for
   * that region (DOM-item, toolbox-blocks, workspace-blocks).
   * - sub-scan at item     → commit the action (click button / insert
   * block / pick value / Select / Delete / Edit) and pop via
   * {@link popToNextRegion} so the user advances to the next top
   * region.
   * - sub-scan at sentinel → pop via {@link popToSameRegion} so the
   * user lands back on the SAME top-level region they entered the
   * sub-scan from, ready to re-enter it. (Action-completed pops go
   * to the NEXT region; sentinel pops stay on the same region.)
   *
   * Defensive: bails if disabled (the listener is removed on disable,
   * but the guard keeps state and listener-binding decoupled) and skips
   * events from text inputs so the keys remain usable in dialogs / form
   * fields once those land in later phases.
   *
   * @param e
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    // While the maze is running a program, advance/select are dead.
    // The user should be watching the animation, not driving the
    // scanner; resuming happens automatically via handleRunEnd.
    if (this.executing) return;

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
   *
   * @param frame
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
        // Land on the SAME region the user just left so they can re-enter
        // it (matches user's mental model of "back to top = let me try
        // again from where I was").
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      // Click first, then pop — if click() throws we still escape the
      // sub-scan rather than getting stuck on a broken item.
      try {
        item?.click();
      } finally {
        // Action completed: advance to the next top-level region so the
        // user keeps moving forward through the scan cycle.
        this.popToNextRegion(frame.topLevelIndex);
      }
      return;
    }

    if (frame.kind === 'blocks') {
      if (this.atSentinel(frame)) {
        // Sentinel pop → stay on the same region for re-entry.
        this.popToSameRegion(frame.topLevelIndex);
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
          // Action completed (block inserted): advance to next region.
          this.popToNextRegion(frame.topLevelIndex);
        }
        return;
      }
      // Workspace block frame: open the action sub-scan menu anchored
      // next to this block. The action-menu frame inherits this frame's
      // `topLevelIndex` (the workspace top-level index) so its own pop
      // helpers compute the correct same/next resume index.
      if (block) {
        this.enterActionMenu(block, frame.topLevelIndex);
      }
      return;
    }

    if (frame.kind === 'action-menu') {
      if (this.atSentinel(frame)) {
        // "Back to top" sentinel — bail out without acting on the block,
        // stay on the same top region (workspace) so the user can pick a
        // different block.
        this.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      const block = frame.block;
      if (!item) {
        // Defensive fallback — treat as a sentinel-style bail.
        this.popToSameRegion(frame.topLevelIndex);
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
        // Action committed → next region.
        this.popToNextRegion(frame.topLevelIndex);
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
        // Action committed → next region.
        this.popToNextRegion(frame.topLevelIndex);
        return;
      }
      if (item.key === 'edit') {
        // Push a nested dropdown-values frame. The Edit option is only
        // present when there's at least one editable FieldDropdown, so
        // this lookup should succeed; defensively fall back to pop-to-
        // top if it doesn't (treat as a bail → same region).
        const field = this.findFirstEditableDropdown(block);
        if (!field) {
          this.popToSameRegion(frame.topLevelIndex);
          return;
        }
        // Pre-focus the block via Blockly's FocusManager (same call the
        // Select handler uses) so the block visibly highlights during the
        // dropdown-values sub-scan. Without this, the action menu closes
        // and the dropdown opens with no indication of WHICH block is
        // being edited — confusing in a chain of similar blocks. Wrapped
        // in try/catch defensively: focusNode can throw if the block was
        // disposed between menu open and selection, but we still want to
        // proceed into the dropdown-values frame.
        try {
          Blockly.getFocusManager().focusNode(block);
        } catch (err) {
          console.warn('[switch-scan] focusNode failed:', err);
        }
        // Dropdown frame inherits the same top-level index so its own
        // pop helpers compute correctly.
        this.enterDropdownValues(block, field, frame.topLevelIndex);
        return;
      }
      return;
    }

    if (frame.kind === 'dropdown-values') {
      if (this.atSentinel(frame)) {
        // Bail without changing the field's value. Pop both the
        // dropdown-values frame AND the action-menu frame beneath it;
        // stay on the same top region so the user can re-enter the
        // workspace sub-scan and try editing again.
        this.popToSameRegion(frame.topLevelIndex);
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
      // Edit committed → advance to next region (v1 design: treat the
      // whole edit flow as a single committed action that lands the user
      // past the workspace region, not back inside it).
      this.popToNextRegion(frame.topLevelIndex);
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
   * @param topLevelIndex  Top-level index of the region the user entered
   *     from. Stored on the frame so the pop helpers can derive the
   *     correct resume index (same region for sentinel pops, next region
   *     for action-completed pops — see {@link popToSameRegion} /
   *     {@link popToNextRegion}).
   */
  private enterDomRegionSubScan(
    regionName: string,
    topLevelIndex: number,
  ): void {
    const items = this.discoverDomRegionItems(regionName);

    if (items.length === 0) {
      // Nothing to scan — advance past the region so the user isn't
      // stuck. Treat the empty sub-scan as a no-op "action" and advance
      // to the next top-level region (matches what a successful item
      // click would have done). For maze-actions this still correctly
      // lands on the top-level sentinel via the modulo inside
      // popToNextRegion.
      this.popToNextRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'dom-items',
      parentRegionName: regionName,
      items,
      index: 0,
      topLevelIndex,
    });
    this.renderHighlight();
  }

  /**
   * Pop every non-`top` frame off the stack and resume the top frame at
   * the SAME top-level region the user entered the sub-scan from.
   *
   * Used for sentinel-driven pops ("Back to top"): the user is
   * explicitly bailing out of the sub-scan and wants to land back on the
   * region they were on, so they can re-enter it (e.g. re-open the
   * toolbox if they entered it by mistake, or pick a different workspace
   * block after backing out of the action menu).
   *
   * @param topLevelIndex Top-level region the sub-scan was entered from.
   */
  private popToSameRegion(topLevelIndex: number): void {
    this.popSubScan(topLevelIndex);
  }

  /**
   * Pop every non-`top` frame off the stack and resume the top frame at
   * the NEXT top-level region (wrapping past the sentinel, modulo cycle
   * length).
   *
   * Used after an action commits — a clicked DOM button, a toolbox
   * block insertion, a workspace block action (Select / Delete / Edit
   * value chosen). Moving forward keeps the scan cycle progressing
   * rather than parking the user on a region they just finished with.
   *
   * For the last real region (maze-actions) the next index lands on the
   * top-level sentinel, which is the desired "you reached the end, now
   * wrap" affordance.
   *
   * @param topLevelIndex Top-level region the sub-scan was entered from.
   */
  private popToNextRegion(topLevelIndex: number): void {
    const topCycleLen = this.regions.length + 1;
    const nextIndex = topCycleLen > 0 ? (topLevelIndex + 1) % topCycleLen : 0;
    this.popSubScan(nextIndex);
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
   *
   * Prefer the named helpers {@link popToSameRegion} /
   * {@link popToNextRegion} at call sites — they encode the semantic
   * intent (sentinel bail vs action commit) and compute the right
   * resume index from the entry top-level index.
   *
   * @param resumeIndex
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
   * @param topLevelIndex  Top-level index of the toolbox region. Stored
   *     on the pushed frame so the pop helpers can resume at the same
   *     region (sentinel bail — user re-enters toolbox) or the next
   *     region (block-inserted — user moves on to workspace).
   */
  private enterToolboxSubScan(topLevelIndex: number): void {
    const blocks = this.discoverFlyoutBlocks();

    if (blocks.length === 0) {
      // Empty toolbox is a degenerate "action complete" → advance.
      this.popToNextRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'blocks',
      regionName: 'toolbox',
      blocks,
      index: 0,
      topLevelIndex,
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
   * @param topLevelIndex  Top-level index of the workspace region.
   *     Stored on the pushed frame so the pop helpers can resume at the
   *     same region (sentinel bail — user re-enters workspace to pick
   *     a different block) or the next region (after an action menu
   *     commits — user moves on to maze-actions).
   */
  private enterWorkspaceSubScan(topLevelIndex: number): void {
    const blocks = this.discoverWorkspaceBlocks();

    if (blocks.length === 0) {
      // Empty workspace is a degenerate "action complete" → advance.
      this.popToNextRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'blocks',
      regionName: 'workspace',
      blocks,
      index: 0,
      topLevelIndex,
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
   * - `Select` and `Delete` are always present.
   * - `Edit` is conditional on the block having at least one editable
   * `Blockly.FieldDropdown` (v1 limitation: if there are multiple
   * editable dropdowns, we'll edit the FIRST one — see
   * {@link findFirstEditableDropdown}; multi-field handling is a
   * later-phase enhancement).
   *
   * `topLevelIndex` is inherited from the workspace blocks frame — by
   * design every action (Select / Edit / Delete) pops straight back to
   * the top-level frame (advancing to the next region), and the
   * sentinel pops back to the same workspace region so the user can
   * pick a different block. This keeps the "you committed an action"
   * boundary visually obvious and avoids the staleness problem after
   * Delete.
   *
   * @param block
   * @param topLevelIndex
   */
  private enterActionMenu(
    block: Blockly.BlockSvg,
    topLevelIndex: number,
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
      topLevelIndex,
    });
    this.renderActionMenu(block, items);
    this.renderHighlight();
  }

  /**
   * Push the dropdown-values sub-scan for `field` on `block`. Selecting
   * an option calls `field.setValue(option[1])` and pops all the way to
   * top. The action-menu overlay is torn down at the same time so the
   * dropdown menu is the only visible overlay while editing.
   *
   * @param block
   * @param field
   * @param topLevelIndex
   */
  private enterDropdownValues(
    block: Blockly.BlockSvg,
    field: Blockly.FieldDropdown,
    topLevelIndex: number,
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
      topLevelIndex,
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
   *
   * @param block
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
   *
   * @param block
   * @param items
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
   *
   * @param block
   * @param options
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
   *
   * @param menuEl
   * @param block
   */
  private anchorMenuToBlock(
    menuEl: HTMLElement,
    block: Blockly.BlockSvg,
  ): void {
    // Use the single-block viewport rect (not `getSvgRoot().getBoundingClientRect()`):
    // the SVG `<g>` root visually contains the entire connected stack, so
    // anchoring off it drops the menu at the bottom of the chain instead of
    // directly below the block being acted on. The helper returns null only
    // when the block has no rendered SVG root — same guard as before.
    const r = this.getSingleBlockViewportRect(block);
    if (!r) return;
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
   * Find the visible `[data-scan-item]` descendants of the named
   * `[data-scan-region="<regionName>"]` wrapper in DOM order.
   *
   * Visibility filter handles:
   * - `display: none` and the `.hidden` class (both null out
   * `offsetParent` on non-fixed elements). Confirmed against
   * `maze.css` — e.g. `#ghostRunButton.hidden { display: none }` —
   * so the ghost-run button is correctly dropped on levels where
   * it isn't enabled.
   * - Zero-width layouts (collapsed flex containers, etc.).
   *
   * Returns `[]` if the region wrapper itself is missing.
   *
   * @param regionName
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
