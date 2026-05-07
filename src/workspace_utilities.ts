/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';

/**
 * Walks up the block tree from a shadow block to find the parent non-shadow block.
 * Shadow blocks should never be moved independently.
 *
 * @param block The block to start from (may be a shadow block)
 * @returns The first non-shadow block ancestor, or null if none found
 */
export function getNonShadowBlock(block: Blockly.BlockSvg | null): Blockly.BlockSvg | null {
  if (!block) return null;

  while (block.isShadow()) {
    const parent = block.getParent();
    if (!parent) {
      return null;
    }
    block = parent;
  }

  return block;
}

const SCROLL_PADDING = 10;
const SCROLL_BOTTOM_BUFFER = 60;

/**
 * Returns a padded clone of bounds and the current viewport as a Rect.
 */
function getScrollContext(
  bounds: Blockly.utils.Rect,
  workspace: Blockly.WorkspaceSvg,
): {bounds: Blockly.utils.Rect; viewport: Blockly.utils.Rect} {
  const rawViewport = workspace.getMetricsManager().getViewMetrics(true);
  const viewport = new Blockly.utils.Rect(
    rawViewport.top,
    rawViewport.top + rawViewport.height,
    rawViewport.left,
    rawViewport.left + rawViewport.width,
  );
  bounds = bounds.clone();
  bounds.top -= SCROLL_PADDING;
  bounds.bottom += SCROLL_PADDING;
  bounds.left -= SCROLL_PADDING;
  bounds.right += SCROLL_PADDING;
  return {bounds, viewport};
}

/** Returns the horizontal delta needed to bring bounds into the viewport. */
function horizontalDelta(
  bounds: Blockly.utils.Rect,
  viewport: Blockly.utils.Rect,
): number {
  if (bounds.left < viewport.left) return viewport.left - bounds.left;
  if (bounds.right > viewport.right) return viewport.right - bounds.right;
  return 0;
}

/**
 * Scrolls the provided bounds into view.
 *
 * In the case of small workspaces/large bounds, this function prioritizes
 * getting the top left corner of the bounds into view. It also adds some
 * padding around the bounds to allow the element to be comfortably in view.
 *
 * @param bounds A rectangle to scroll into view, as best as possible.
 * @param workspace The workspace to scroll the given bounds into view in.
 */
export function scrollBoundsIntoView(
  bounds: Blockly.utils.Rect,
  workspace: Blockly.WorkspaceSvg,
) {
  if (Blockly.Gesture.inProgress()) {
    // This can cause jumps during a drag and it only suited for keyboard nav.
    return;
  }

  const {bounds: paddedBounds, viewport} = getScrollContext(bounds, workspace);

  if (
    paddedBounds.left >= viewport.left &&
    paddedBounds.top >= viewport.top &&
    paddedBounds.right <= viewport.right &&
    paddedBounds.bottom <= viewport.bottom
  ) {
    return;
  }

  const deltaX = horizontalDelta(paddedBounds, viewport);
  let deltaY = 0;
  if (paddedBounds.top < viewport.top) {
    deltaY = viewport.top - paddedBounds.top;
  } else if (paddedBounds.bottom > viewport.bottom) {
    deltaY = viewport.bottom - paddedBounds.bottom;
  }

  const scale = workspace.getScale();
  workspace.scroll(
    workspace.scrollX + deltaX * scale,
    workspace.scrollY + deltaY * scale,
  );
}

/**
 * Centers the provided bounds vertically in the viewport when the stack is
 * taller than the viewport (the "scroll by clicking" model). Falls back to
 * minimal scroll when the content fits.
 *
 * Uses bounds.top as the focal point because getBoundingRectangle() includes
 * all child blocks, so bounds.bottom is not a reliable reference for the
 * actual focused element.
 *
 * @param bounds A rectangle to center in view.
 * @param workspace The workspace to scroll.
 */
export function centerBoundsInView(
  bounds: Blockly.utils.Rect,
  workspace: Blockly.WorkspaceSvg,
) {
  if (Blockly.Gesture.inProgress()) return;

  const {bounds: paddedBounds, viewport} = getScrollContext(bounds, workspace);
  const rawViewport = workspace.getMetricsManager().getViewMetrics(true);
  const rawContent = workspace.getMetricsManager().getContentMetrics(true);

  const deltaX = horizontalDelta(paddedBounds, viewport);
  let deltaY = 0;

  if (rawContent.height > rawViewport.height) {
    // Stack taller than viewport: center bounds.top in the viewport.
    const viewportCenterY = rawViewport.top + rawViewport.height / 2;
    deltaY = viewportCenterY - paddedBounds.top;

    // Clamp: don't scroll above content top.
    const maxDeltaY = viewport.top - rawContent.top + SCROLL_PADDING;
    if (deltaY > maxDeltaY) deltaY = maxDeltaY;

    // Clamp: don't scroll below content bottom (buffer so last block isn't flush with edge).
    const minDeltaY = viewport.bottom - (rawContent.top + rawContent.height) - SCROLL_BOTTOM_BUFFER;
    if (deltaY < minDeltaY) deltaY = minDeltaY;
  } else {
    // Content fits: minimal scroll, skip if already in view.
    if (
      paddedBounds.left >= viewport.left &&
      paddedBounds.top >= viewport.top &&
      paddedBounds.right <= viewport.right &&
      paddedBounds.bottom <= viewport.bottom
    ) {
      return;
    }
    if (paddedBounds.top < viewport.top) {
      deltaY = viewport.top - paddedBounds.top;
    } else if (paddedBounds.bottom > viewport.bottom) {
      deltaY = viewport.bottom - paddedBounds.bottom;
    }
  }

  if (deltaX === 0 && deltaY === 0) return;

  const scale = workspace.getScale();
  workspace.scroll(
    workspace.scrollX + deltaX * scale,
    workspace.scrollY + deltaY * scale,
  );
}
