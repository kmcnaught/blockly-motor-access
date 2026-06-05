/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Region and block discovery for the switch-scan
 * controller. Extracted from `switch-scan-mode.ts` so the controller
 * can focus on the scan state machine; everything here is a read-only
 * probe of the DOM / Blockly workspace and doesn't touch frame state.
 *
 * Two flavours of "discovery":
 *  - Top-level regions (header / instruction-bar / toolbox / workspace
 *    / maze-actions) plus their viewport-rect thunks — see
 *    {@link discoverRegions}.
 *  - The contents of a region: DOM scannable items for the plain-DOM
 *    regions, Blockly blocks for the flyout and the workspace.
 *
 * The rect helpers ({@link getWorkspaceViewportRect},
 * {@link getSingleBlockViewportRect}) sit here too because they're the
 * shared coordinate-math used by region thunks AND by the menu
 * anchoring path (menus module receives them via callback).
 */

import * as Blockly from 'blockly/core';

/**
 * A discoverable top-level scan region. `getRect` is a thunk because
 * Blockly's flyout / workspace DOM may not be measurable at the moment
 * the controller's `enable()` runs (e.g. before first layout) —
 * deferring keeps things robust to lazy sizing and to later resizes.
 */
export interface ScanRegion {
  name: string;
  getRect: () => DOMRect | null;
}

/**
 * Discover the top-level scan regions in display order. Each region
 * carries a thunk that re-reads its rect on demand so we tolerate
 * Blockly not having laid the flyout / workspace out yet at enable
 * time, and so we tolerate later resizes without rediscovering.
 *
 * Regions whose backing element can't be found are skipped (with a
 * console warning) rather than crashing — keeps the controller usable
 * even on level configurations that lack, say, a toolbox.
 *
 * @param workspace The main Blockly workspace.
 */
export function discoverRegions(
  workspace: Blockly.WorkspaceSvg,
): ScanRegion[] {
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

  // Instruction bar — separate DOM region from <header> (lives below
  // it visually). Hosts the `?` info button (keyboard-shortcuts modal
  // entry) plus the stage dropdown. Both are tagged `data-scan-item`;
  // the stage dropdown additionally carries
  // `data-scan-dropdown-source="stage"` so a switch select opens a
  // dropdown-values sub-scan over its options instead of trying to
  // drive the native popover.
  const instructionBarEl = document.querySelector<HTMLElement>(
    '[data-scan-region="instruction-bar"]',
  );
  if (instructionBarEl) {
    regions.push({
      name: 'instruction-bar',
      getRect: () => instructionBarEl.getBoundingClientRect(),
    });
  }

  // Practice-mode controls panel (Forward / Turn Left / Turn Right).
  // Only visible in practice mode — when `#immediateModePanel.hidden`
  // is in effect (coding mode) `offsetParent` is null and we skip the
  // region entirely so the scan cycle doesn't pause on an invisible
  // step. Conversely, in practice mode `#blocklyDiv.hidden` hides the
  // workspace/toolbox so those regions are skipped below; the two are
  // mutually exclusive in display, matching the mode toggle.
  const practiceEl = document.querySelector<HTMLElement>(
    '[data-scan-region="practice-controls"]',
  );
  if (practiceEl && practiceEl.offsetParent !== null) {
    regions.push({
      name: 'practice-controls',
      getRect: () => practiceEl.getBoundingClientRect(),
    });
  }

  // Toolbox — prefer Blockly's flyout SVG group, fall back to the
  // toolbox HtmlDiv if a category-style Toolbox is in use. Both are
  // private-ish APIs; the cast pattern matches `src/index.ts:157`.
  //
  // In practice mode the blocklyDiv is `display: none`, so the flyout
  // / workspace SVG are unmeasurable AND meaningless — there's nothing
  // for the user to scan inside them. Skip both regions outright in
  // that case so the cycle doesn't include dead steps.
  const blocklyDiv = document.getElementById('blocklyDiv');
  const blocklyVisible = !!blocklyDiv && blocklyDiv.offsetParent !== null;
  const flyout = workspace.getFlyout();
  const toolbox = workspace.getToolbox();
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
  if (blocklyVisible && toolboxRectFn) {
    // We deliberately don't sample the rect here — Blockly's flyout
    // may not be measured yet at `enable()` time (e.g. if discovery
    // runs before first layout / on a hidden tab). The thunk re-reads
    // on every render, and `renderHighlight()` already hides the
    // outline for a 0x0 rect, so a transiently-unmeasurable toolbox
    // self-recovers on the next cycle instead of being permanently
    // dropped.
    regions.push({name: 'toolbox', getRect: toolboxRectFn});
  } else if (blocklyVisible) {
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
  const injectionDiv = workspace.getInjectionDiv();
  const capturedToolboxRectFn = toolboxRectFn;
  if (blocklyVisible && injectionDiv) {
    regions.push({
      name: 'workspace',
      getRect: () => {
        const base = getWorkspaceViewportRect(workspace, injectionDiv);
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
  } else if (blocklyVisible) {
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
 */
export function getWorkspaceViewportRect(
  workspace: Blockly.WorkspaceSvg,
  injectionDiv: Element,
): DOMRect | null {
  const m = workspace.getMetrics();
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
 * to — anchoring off the SVG-root rect drops the menu below the
 * entire stack instead of below the current block.
 */
export function getSingleBlockViewportRect(
  block: Blockly.BlockSvg,
  workspace: Blockly.WorkspaceSvg,
): DOMRect | null {
  if (!block.getSvgRoot?.()) return null;
  const wsRect = block.getBoundingRectangleWithoutChildren();
  const topLeft = Blockly.utils.svgMath.wsToScreenCoordinates(
    workspace,
    new Blockly.utils.Coordinate(wsRect.left, wsRect.top),
  );
  const bottomRight = Blockly.utils.svgMath.wsToScreenCoordinates(
    workspace,
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
 * Discover the visible top blocks in the toolbox/flyout in display
 * order.
 *
 * "Visible" filter: block must have a rendered SVG root with a
 * non-zero bounding rect. Flyout categories or labels (non-block
 * elements) are naturally excluded because `getTopBlocks` only
 * returns Block instances.
 *
 * @param workspace The main workspace (its flyout is what we probe).
 */
export function discoverFlyoutBlocks(
  workspace: Blockly.WorkspaceSvg,
): Blockly.BlockSvg[] {
  const flyout = workspace.getFlyout();
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
 * Discover the main workspace's blocks in tree order, matching how a
 * programmer reads code top-to-bottom.
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
 * path in the controller's renderHighlight already handles the rare
 * case of a block being removed mid-cycle.
 */
export function discoverWorkspaceBlocks(
  workspace: Blockly.WorkspaceSvg,
): Blockly.BlockSvg[] {
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
  const topBlocks = workspace.getTopBlocks(true);
  for (const top of topBlocks) {
    visit(top);
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
 *    so the ghost-run button is correctly dropped on levels where it
 *    isn't enabled.
 *  - Zero-width layouts (collapsed flex containers, etc.).
 *
 * Returns `[]` if the region wrapper itself is missing.
 */
export function discoverDomRegionItems(regionName: string): HTMLElement[] {
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
