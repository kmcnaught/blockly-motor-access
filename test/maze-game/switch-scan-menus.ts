/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Inline overlay menus for the switch-scan controller —
 * the small floating widgets that appear next to a workspace block (or
 * header button) when the user enters an action / move / dropdown
 * sub-scan. Extracted from `switch-scan-mode.ts` so the controller can
 * stay focused on the scan state machine; nothing here touches frame
 * state or controller fields.
 *
 * Each render function takes the previous menu element (to remove if
 * present), builds a fresh one, appends to `<body>`, and anchors it
 * next to a block or DOM element. The caller stores the returned
 * element so a later render can remove it. The block-to-viewport-rect
 * conversion is workspace-specific, so it's threaded through as a
 * `getBlockRect` callback rather than reimplemented here.
 */

import * as Blockly from 'blockly/core';

/**
 * Shape of a dropdown option as cycled in the `dropdown-values` frame
 * and accepted by {@link renderDropdownMenu}. Either a plain string
 * label, or an image descriptor used for pictographic options (e.g.
 * direction arrows). Matches `HeaderDropdownSource.getOptions()` in
 * the controller.
 */
export type DropdownOption = [
  string | {src: string; width: number; height: number; alt: string},
  string,
];

/**
 * Minimal contract render functions need from action / move items —
 * just the user-visible label. The richer types (`ActionItem`,
 * `MoveCandidatesItem`) live in the controller where their `key`
 * discriminants drive dispatch.
 */
interface MenuItem {
  label: string;
}

/**
 * Resolver supplied by the controller. Returns the viewport rect of a
 * single workspace block, or null if the block isn't measurable yet.
 * Kept as a callback so this module doesn't need to know about
 * `Blockly.WorkspaceSvg` or the ws-to-screen math.
 */
type BlockRectResolver = (block: Blockly.BlockSvg) => DOMRect | null;

/**
 * (Re)build the inline action menu (Select / Edit / Move / Delete) and
 * anchor it next to `block`. Removes any previous menu element first.
 *
 * @param previous Previous menu element to remove (caller-owned), or null.
 * @param block The workspace block the menu is acting on.
 * @param items Rows to render, in display order.
 * @param getBlockRect Resolver for the block's viewport rect.
 * @returns The newly created menu element; caller stores it.
 */
export function renderActionMenu(
  previous: HTMLDivElement | null,
  block: Blockly.BlockSvg,
  items: ReadonlyArray<MenuItem>,
  getBlockRect: BlockRectResolver,
): HTMLDivElement {
  previous?.remove();
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
  anchorMenuToBlock(el, block, getBlockRect);
  return el;
}

/**
 * (Re)build the move-candidates overlay ("Next" / "Place") and anchor
 * it next to `block`. Reuses the action-menu CSS class for styling
 * consistency; the candidate-connection itself is highlighted by
 * Blockly's own move-mode preview, so this overlay just hosts the
 * "which switch action did the user pick" affordance.
 *
 * @param previous Previous menu element to remove (caller-owned), or null.
 * @param block The block currently being moved.
 * @param items Rows to render, in display order.
 * @param getBlockRect Resolver for the block's viewport rect.
 * @returns The newly created menu element; caller stores it.
 */
export function renderMoveMenu(
  previous: HTMLDivElement | null,
  block: Blockly.BlockSvg,
  items: ReadonlyArray<MenuItem>,
  getBlockRect: BlockRectResolver,
): HTMLDivElement {
  previous?.remove();
  const el = document.createElement('div');
  // Share the action-menu class for visual consistency; an extra
  // marker class lets us narrow CSS overrides later if needed.
  el.className = 'switch-scan-action-menu switch-scan-move-menu';
  for (let i = 0; i < items.length; i++) {
    const row = document.createElement('div');
    row.className = 'switch-scan-menu-item';
    row.setAttribute('data-scan-move-item', String(i));
    row.textContent = items[i].label;
    el.appendChild(row);
  }
  document.body.appendChild(el);
  anchorMenuToBlock(el, block, getBlockRect);
  return el;
}

/**
 * (Re)build the dropdown-values overlay and anchor it adjacent to
 * `anchor`. Image options render as `<img>` so direction arrows etc.
 * show pictographically; string options render as text.
 *
 * `anchor` is either a workspace `BlockSvg` (Block-Edit path) or an
 * `HTMLElement` (header-dropdown path — the `#pegmanButton` /
 * `<select id="languageSelect">`). Both yield a viewport rect via
 * different helpers; the same below-the-anchor / fallback-right
 * placement applies.
 *
 * @param previous Previous menu element to remove (caller-owned), or null.
 * @param anchor Block or DOM element to drop the menu beneath.
 * @param options Rows to render, in display order.
 * @param getBlockRect Resolver for a block's viewport rect (only used
 *     when `anchor` is a `BlockSvg`; ignored for `HTMLElement`).
 * @returns The newly created menu element; caller stores it.
 */
export function renderDropdownMenu(
  previous: HTMLDivElement | null,
  anchor: HTMLElement | Blockly.BlockSvg,
  options: ReadonlyArray<DropdownOption>,
  getBlockRect: BlockRectResolver,
): HTMLDivElement {
  previous?.remove();
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
  anchorMenuToAnchor(el, anchor, getBlockRect);
  return el;
}

/**
 * Position `menuEl` adjacent to `block`. Default: just below the block,
 * left-aligned. Fallback: if the menu would overflow the viewport
 * bottom, anchor to the right of the block instead.
 *
 * Uses the single-block viewport rect (via `getBlockRect`) rather than
 * the SVG `<g>` root rect — the latter visually contains the entire
 * connected stack, so anchoring off it drops the menu at the bottom of
 * the chain instead of directly below the block being acted on.
 */
function anchorMenuToBlock(
  menuEl: HTMLElement,
  block: Blockly.BlockSvg,
  getBlockRect: BlockRectResolver,
): void {
  const r = getBlockRect(block);
  if (!r) return;
  placeMenuByRect(menuEl, r);
}

/**
 * Position `menuEl` adjacent to a polymorphic `anchor` — either a
 * Blockly `BlockSvg` (Block-Edit dropdown) or an `HTMLElement` (header
 * dropdown). Both resolve to a viewport rect; the same below-the-anchor
 * / fallback-right placement applies.
 *
 * Kept separate from {@link anchorMenuToBlock} so the action-menu /
 * move-menu callers can keep passing a `BlockSvg` directly without the
 * TypeScript widening dance.
 */
function anchorMenuToAnchor(
  menuEl: HTMLElement,
  anchor: HTMLElement | Blockly.BlockSvg,
  getBlockRect: BlockRectResolver,
): void {
  let rect: DOMRect | null = null;
  if (anchor instanceof HTMLElement) {
    rect = anchor.getBoundingClientRect();
  } else {
    rect = getBlockRect(anchor);
  }
  if (!rect) return;
  placeMenuByRect(menuEl, rect);
}

/**
 * Shared placement heuristic: drop the menu below the anchor with an
 * 8px gap; if that would overflow the viewport bottom, anchor right of
 * the anchor instead. The fixed-position styling on the menu itself
 * means viewport coords are what we want.
 */
function placeMenuByRect(menuEl: HTMLElement, r: DOMRect): void {
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
