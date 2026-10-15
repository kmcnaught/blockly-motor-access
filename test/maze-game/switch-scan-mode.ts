/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Switch Scan Controller for the Maze game.
 *
 * Drives a step-scanning input mode for users with severe motor
 * impairments who access the page via physical switches (or assigned
 * keys sent by assistive software such as Grid 3). An advance key
 * cycles a visible highlight across scannable regions/items; a select
 * key acts on the current target; an optional back key pops one frame.
 * A single-switch auto-scan mode is also supported, where a timer
 * drives advance and the one bound key doubles as select.
 *
 * Activation + key bindings come from URL params (read in `index.ts`,
 * forwarded via {@link SwitchScanOptions}); the settings modal lets
 * the user re-bind keys and toggle mode / audio live without reload.
 *  - `inputMode=switch-scan` — activate the controller. When unset,
 *    the controller is NEVER instantiated and binds NO listeners — the
 *    default-mode page behaves exactly as before.
 *  - `switchAdvance` — advance key (`KeyboardEvent.key` or the alias
 *    `'Space'`). Default `' '` (Space).
 *  - `switchSelect` — select key (two-switch mode only). Default
 *    `'Enter'`.
 *  - `switchBack` — optional back key; default `'Escape'`. Set empty
 *    to disable.
 *  - `scanMode` — `'step'` (default) or `'auto'` for single-switch.
 *  - `scanSpeedMs` — auto-scan interval in milliseconds.
 *  - `scanAudio` — `'on'` to enable TTS announcements.
 *
 * Mutual exclusion with grid-coding mode (`?grid=1`): `index.ts` only
 * instantiates one input-augmentation controller at a time.
 *
 * Scannable surface: the top-level cycle discovers DOM regions tagged
 * `data-scan-region` (header, instruction-bar, practice-controls,
 * maze-actions) plus the Blockly toolbox and workspace. Selecting a
 * region enters a sub-scan: a generic DOM-item sub-scan for the DOM
 * regions, a Blockly-block sub-scan for the toolbox flyout and the
 * workspace. Selecting a workspace block opens an inline action menu
 * (Select / Edit / Move / Delete). Edit opens a dropdown-values sub-
 * scan over the first editable `Blockly.FieldDropdown` on the block;
 * Move opens a candidate-connections sub-scan with a floating Cancel
 * chip. Header dropdown-source items (character, language, stage) open
 * a value-picker overlay instead of the native popover. All action
 * commits pop straight back to the top-level frame so the next advance
 * reads as a clean transition rather than dropping the user mid-scan.
 *
 * Scanning pauses while the maze program runs (highlight, sentinel,
 * and any open menus are torn down; key input short-circuits) and
 * resumes on a clean top-level frame (header, index 0) when the run
 * finishes via any path — success, failure, timeout, error, or reset
 * interrupt — all surfaced through a single
 * `MazeGame.onExecutionStateChange` subscription.
 *
 * TTS (optional, off by default): when wired via
 * {@link SwitchScanController#setTts}, each advance / sub-scan entry
 * speaks the current item's label via the Web Speech API. The TTS
 * helper owns the enabled flag and the cancel-and-replace contract;
 * this controller derives the label and forwards it on every
 * interactive render.
 *
 * Known limitations (not bugs, scope boundaries):
 *  - Workspace block editing is dropdown-only. Non-dropdown fields
 *    (text input, number) can be selected / deleted / moved but not
 *    edited via switch — the Edit action only wires through to
 *    `Blockly.FieldDropdown` instances.
 *  - Multi-dropdown blocks only expose the FIRST editable dropdown.
 *    Reaching a second dropdown would need a field-picker step.
 *  - Nested header dropdowns aren't scanned. Top-level pickers
 *    (character / language / stage) open a value-picker sub-scan, but
 *    hierarchical sub-menus below those aren't reachable.
 *  - Auto-scan doesn't auto-descend into sub-scans — a Select is still
 *    required to enter a region even in single-switch mode.
 */

import * as Blockly from 'blockly/core';
import {scrollBoundsIntoView} from '../../src/workspace_utilities';
import {MazeGame} from './maze';
import {insertBlockAfterCursor} from './block-insertion';
import {
  renderActionMenu,
  renderDropdownMenu,
} from './switch-scan-menus';
import {
  type ScanRegion,
  discoverRegions,
  discoverFlyoutBlocks,
  discoverWorkspaceBlocks,
  discoverDomRegionItems,
  getConnectionViewportRect,
  getSingleBlockViewportRect,
} from './switch-scan-regions';

/**
 * Minimal contract the controller needs from the settings panel. Kept
 * as a structural type (rather than importing `SwitchScanSettings`
 * directly) so the two modules don't get a hard cyclic dependency —
 * the controller doesn't care about the rest of the settings API, only
 * whether a live key-capture is currently in flight (Step D).
 */
interface SwitchScanSettingsLike {
  isCapturing(): boolean;
}

/**
 * Minimal contract the controller needs from the TTS helper (Phase 5).
 * Kept as a structural type so the controller doesn't pull in
 * `SpeechSynthesisUtterance` types or care about the feature-detect
 * branch — it just speaks / cancels and lets the helper figure out
 * whether to actually emit sound.
 */
interface SwitchScanTtsLike {
  speak(label: string): void;
  cancel(): void;
  isEnabled(): boolean;
}

/**
 * One end of the header-dropdown wiring (Phase 3 Step 2).
 *
 * A header button tagged `data-scan-dropdown-source="<name>"` (e.g.
 * `#pegmanButton`, `#languageSelect`) opens a NATIVE popover when
 * clicked — which switch users can't reach. The controller instead
 * intercepts the select press at the dom-items frame, looks up the
 * source by name in {@link SwitchScanOptions.headerDropdowns}, and
 * pushes a `dropdown-values` sub-scan over the options returned by
 * `getOptions()`. Selecting an option calls `commit(value)`.
 *
 * Why a per-source provider object instead of letting the controller
 * peek at `#pegmanMenu` / `<select>` directly:
 *  - The controller has no business knowing about skin IDs, locales,
 *    or how the host page chooses to apply each change (changePegman
 *    vs `location.href = ...`). The provider keeps that policy in
 *    `index.ts` and the controller stays focused on the scan loop.
 *  - The same shape can serve future header dropdowns (level picker,
 *    audio voice, etc.) without growing the controller's API.
 */
export interface HeaderDropdownSource {
  /**
   * Build the option list shown in the sub-scan, in display order.
   * Each option is `[labelOrImage, value]` matching the existing
   * `dropdown-values` frame shape. Labels are strings; image-style
   * labels render as `<img>` with `alt` used as the TTS / a11y text.
   */
  getOptions(): Array<
    [string | {src: string; width: number; height: number; alt: string}, string]
  >;
  /**
   * Apply the user's pick. For the character source this calls
   * `changePegman(parseInt(value))`; for the language source it
   * mutates `languageSelect.value` and dispatches `change` (which
   * triggers the full page reload that swaps the Blockly locale).
   */
  commit(value: string): void;
}

/**
 * Options for configuring the switch scan controller.
 * Keys use `KeyboardEvent.key` string values (e.g. `' '` for Space,
 * `'Enter'` for Enter). Human-readable aliases like `'Space'` are also
 * accepted (see {@link normalizeKey}).
 *
 * Phase 4: `scanMode` toggles between two-switch step scan (the default)
 * and single-switch auto scan. In auto mode only the advance key is
 * consulted — the first press starts a self-paced timer that advances
 * the highlight every `scanSpeedMs` milliseconds; subsequent presses
 * select the currently highlighted item. The select key is ignored
 * entirely under `scanMode === 'auto'` (Switch B is hidden in the
 * settings panel and unused in this flow).
 *
 * Phase 3 Step 2: `headerDropdowns` registers per-source providers
 * keyed by the `data-scan-dropdown-source` attribute on a header
 * button. When the user selects such a button in the header sub-scan,
 * the controller opens a `dropdown-values` sub-scan over the source's
 * `getOptions()` instead of firing `.click()` (which would open a
 * native popover the switch scanner can't reach). Picking an option
 * calls the source's `commit()`. See {@link HeaderDropdownSource}.
 */
export interface SwitchScanOptions {
  switchAdvance?: string;
  switchSelect?: string;
  /**
   * Optional third "Back" switch. When pressed, pops one frame off the
   * scan stack — finer-grained than the sub-scan sentinel, which pops
   * straight to the top frame. Useful when the user dropped into the
   * wrong nested menu (e.g. entered Edit when they meant Delete) and
   * wants to back out one level without losing the workspace block they
   * had selected. Default `'Escape'`. Set to `''` to disable the binding
   * entirely.
   */
  switchBack?: string;
  scanMode?: 'step' | 'auto';
  scanSpeedMs?: number;
  headerDropdowns?: Record<string, HeaderDropdownSource>;
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
 * Fixed-slot inset for the fallback chip position when a strategy
 * returns `null` for `groupRect`. Keeps the chip reachable in a
 * predictable bottom-right corner.
 */
const SENTINEL_FIXED_SLOT_INSET = 16;

/**
 * Inset applied when both the primary and the wrap placement overflow
 * the viewport (group is too big to host an adjacent chip). The chip
 * is anchored to the group's top-centre, inset from the top edge so
 * it doesn't straddle the group's edge.
 */
const SENTINEL_TOP_ANCHOR_INSET = 24;

/**
 * Gap between the group's trailing edge and the sentinel chip in the
 * natural-flow placement — the chip reads as "the next slot after the
 * last item" with a small amount of breathing room.
 */
const SENTINEL_NEXT_SLOT_GAP = 8;

/**
 * Guestimates of the sentinel chip's rendered dimensions. Used to
 * predict viewport overflow of the primary (and then the wrap) natural-
 * flow placement without needing a measure-reflow cycle: the chip has
 * fixed text + padding so the real size is close to these constants.
 */
const SENTINEL_CHIP_WIDTH_ESTIMATE = 200;
const SENTINEL_CHIP_HEIGHT_ESTIMATE = 50;

/**
 * Normalize a configured key string to its `KeyboardEvent.key` form so
 * `event.key === normalized` works regardless of whether the user wrote
 * `?switchAdvance=Space` or `?switchAdvance=+` in the URL.
 *
 * @param key
 */
/**
 * Negative-safe modulo for frame-index wrapping. Returns 0 when
 * `cycleLen` is 0 so a caller doesn't have to pre-check.
 *
 * @param index The raw index to wrap (may be negative or >= cycleLen).
 * @param cycleLen Length of the cycle to wrap within.
 */
function wrapIndex(index: number, cycleLen: number): number {
  if (cycleLen <= 0) return 0;
  return ((index % cycleLen) + cycleLen) % cycleLen;
}

function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

/**
 * Compute the smallest DOMRect enclosing every input rect. Zero-area
 * rects are dropped before the union — same defensive filter the
 * highlight path applies to the single-item case — so a transiently
 * unmeasurable element doesn't drag the union down to (0,0). Returns
 * `null` when no input survives the filter.
 *
 * Exposed on {@link __testOnly} for unit tests.
 *
 * @param rects Rects to combine; viewport coordinates throughout.
 */
function unionRects(rects: DOMRect[]): DOMRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let seen = false;
  for (const r of rects) {
    if (!r || r.width === 0 || r.height === 0) continue;
    seen = true;
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  if (!seen) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Position the sentinel chip relative to its group bounding box and
 * draw the accompanying grey mask. Pure DOM-side placement policy:
 * takes the two overlay elements, the group rect, and the viewport
 * dimensions; sets styles on the elements.
 *
 * Placement model — "natural flow": the chip appears where the next
 * item in the group's flow would've gone. Horizontal groups (bbox
 * wider than tall) → to the right of the group. Vertical groups →
 * below the group. If the primary direction would push the chip off
 * the viewport, wrap to the perpendicular direction instead. If both
 * directions overflow (group is too big to host an adjacent chip),
 * anchor the chip to the group's top-centre inside the bbox so it
 * stays visible and in semantic contact with the group.
 *
 * The grey mask always covers the group when a `groupRect` is
 * available — it's the "which group are you exiting" marker. The chip
 * sitting adjacent to the mask (rather than centred on it) reads as
 * the next slot in the cycle rather than a modal overlay.
 *
 * Null `groupRect` is the one escape hatch: no mask, chip parks in a
 * fixed bottom-right slot so it stays reachable.
 *
 * Exposed on {@link __testOnly} for unit tests.
 *
 * @param sentinelChip The "Back" chip element.
 * @param groupMaskEl The semi-transparent grey overlay element, or
 *     `null` if the controller hasn't created one.
 * @param groupRect Bounding box of the group the sentinel exits
 *     from, or `null` when the active strategy can't compute one.
 * @param viewportWidth Current viewport width in CSS pixels.
 * @param viewportHeight Current viewport height in CSS pixels.
 */
function applySentinelChip(
  sentinelChip: HTMLElement,
  groupMaskEl: HTMLElement | null,
  groupRect: DOMRect | null,
  viewportWidth: number,
  viewportHeight: number,
): void {
  if (!groupRect) {
    if (groupMaskEl) groupMaskEl.style.display = 'none';
    // Fixed-slot fallback — the strategy can't tell us where the
    // group lives, so the chip parks in a predictable corner.
    sentinelChip.style.transform = 'none';
    sentinelChip.style.top = '';
    sentinelChip.style.left = '';
    sentinelChip.style.bottom = `${SENTINEL_FIXED_SLOT_INSET}px`;
    sentinelChip.style.right = `${SENTINEL_FIXED_SLOT_INSET}px`;
    sentinelChip.style.display = 'block';
    return;
  }

  if (groupMaskEl) {
    groupMaskEl.style.display = 'block';
    groupMaskEl.style.top = `${groupRect.top}px`;
    groupMaskEl.style.left = `${groupRect.left}px`;
    groupMaskEl.style.width = `${groupRect.width}px`;
    groupMaskEl.style.height = `${groupRect.height}px`;
  }

  // Base styling common to every adjacent / inside placement — the
  // chip is anchored by its top-left corner (no translate).
  sentinelChip.style.transform = 'none';
  sentinelChip.style.bottom = '';
  sentinelChip.style.right = '';
  sentinelChip.style.display = 'block';

  const horizontal = groupRect.width > groupRect.height;
  const gap = SENTINEL_NEXT_SLOT_GAP;
  // Primary: continuation in the group's flow direction. Secondary:
  // perpendicular wrap when the primary doesn't fit. Each is a
  // {left, top} anchor for the chip's top-left corner.
  const primary = horizontal
    ? {left: groupRect.right + gap, top: groupRect.top}
    : {left: groupRect.left, top: groupRect.bottom + gap};
  const wrap = horizontal
    ? {left: groupRect.left, top: groupRect.bottom + gap}
    : {left: groupRect.right + gap, top: groupRect.top};

  const fits = (anchor: {left: number; top: number}): boolean =>
    anchor.left + SENTINEL_CHIP_WIDTH_ESTIMATE <= viewportWidth &&
    anchor.top + SENTINEL_CHIP_HEIGHT_ESTIMATE <= viewportHeight;

  if (fits(primary)) {
    sentinelChip.style.left = `${primary.left}px`;
    sentinelChip.style.top = `${primary.top}px`;
    return;
  }
  if (fits(wrap)) {
    sentinelChip.style.left = `${wrap.left}px`;
    sentinelChip.style.top = `${wrap.top}px`;
    return;
  }

  // Group is too big for an adjacent chip in either direction. Fall
  // back to anchoring inside the group's top-centre so the chip stays
  // visible and in semantic contact with the group.
  sentinelChip.style.transform = 'translateX(-50%)';
  sentinelChip.style.left = `${groupRect.left + groupRect.width / 2}px`;
  sentinelChip.style.top = `${groupRect.top + SENTINEL_TOP_ANCHOR_INSET}px`;
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
 *    resume on that region for both sentinel pops AND action-commit
 *    pops, so pressing Select again re-enters the same sub-scan. See
 *    {@link popToSameRegion}. {@link popToNextRegion} is reserved for
 *    degenerate empty-region skips only.
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
      // The `dropdown-values` frame is used for TWO entry paths that
      // share the same visual menu + cycle semantics:
      //  1. Block Edit (Phase 1): `block` + `field` are set, and the
      //     commit path calls `field.setValue(value)`. `anchor` is the
      //     workspace block being edited (menu sits below it).
      //  2. Header dropdown (Phase 3 Step 2 — Character / Language):
      //     `commitHandler` is set; `block` / `field` are absent. The
      //     anchor is the header button (`#pegmanButton` or the
      //     `<select id="languageSelect">`), so the menu drops below
      //     the right control instead of the workspace.
      // The single `commitHandler` discriminant keeps the frame shape
      // tight — when set, the select branch calls it instead of
      // `field.setValue` and skips the Blockly-field bookkeeping.
      kind: 'dropdown-values';
      block: Blockly.BlockSvg | null;
      field: Blockly.FieldDropdown | null;
      anchor: HTMLElement | Blockly.BlockSvg;
      options: Array<
        [string | {src: string; width: number; height: number; alt: string}, string]
      >;
      index: number;
      topLevelIndex: number;
      // Phase 3 Step 2: optional commit override for header dropdowns.
      // When set, takes precedence over `field.setValue`. The block-
      // Edit path leaves this unset, preserving the original behavior.
      commitHandler?: (value: string) => void;
    }
  | {
      // Switch-scan over the workspace's valid drop slots for `block`.
      // We enumerate every legal `(local, target)` connection pair
      // ourselves and the scan highlight jumps directly onto each target
      // connection — no inline "Next / Place" menu, no Blockly move mode.
      // Each advance moves to the next candidate; select commits via
      // `target.connect(local)`; the sentinel slot doubles as Cancel
      // (anchored by `cancelChipEl`).
      kind: 'move-candidates';
      block: Blockly.BlockSvg;
      candidates: Array<{local: Blockly.Connection; target: Blockly.Connection}>;
      cancelChipEl: HTMLElement;
      index: number;
      topLevelIndex: number;
    };

/**
 * One row in the inline action menu shown when the user selects a
 * workspace block. `key` drives behavior in {@link handleSelect}; the
 * human-readable `label` is what we render in the overlay.
 */
interface ActionItem {
  key: 'select' | 'edit' | 'move' | 'delete';
  label: string;
}

/**
 * Structural slice of {@link SwitchScanController} that per-kind frame
 * strategies are allowed to touch. Keeping it narrow — just the fields
 * and helpers the strategies actually need — means strategies can be
 * unit-tested against a hand-rolled stub without constructing a full
 * controller, and documents the dispatch surface rather than leaving
 * strategies with free rein over the controller internals.
 *
 * `rectAt` reads workspace plus the two menu-element fields; `labelAt`
 * / `cycleLen` only read `regions`; `handleSelect` reads every enter
 * helper, `popToSameRegion`, both menu fields, `headerDropdowns`, and
 * `findFirstEditableDropdown`.
 */
interface StrategyCtx {
  readonly workspace: Blockly.WorkspaceSvg;
  readonly regions: readonly ScanRegion[];
  readonly headerDropdowns: Readonly<Record<string, HeaderDropdownSource>>;
  readonly actionMenuEl: HTMLDivElement | null;
  readonly dropdownMenuEl: HTMLDivElement | null;
  enterDomRegionSubScan(name: string, topLevelIndex: number): void;
  enterToolboxSubScan(topLevelIndex: number): void;
  enterWorkspaceSubScan(topLevelIndex: number): void;
  enterActionMenu(block: Blockly.BlockSvg, topLevelIndex: number): void;
  enterDropdownValues(
    block: Blockly.BlockSvg,
    field: Blockly.FieldDropdown,
    topLevelIndex: number,
  ): void;
  enterHeaderDropdownValues(
    anchor: HTMLElement,
    source: HeaderDropdownSource,
    topLevelIndex: number,
  ): void;
  enterMoveCandidates(block: Blockly.BlockSvg, topLevelIndex: number): void;
  popToSameRegion(topLevelIndex: number): void;
  findFirstEditableDropdown(
    block: Blockly.BlockSvg,
  ): Blockly.FieldDropdown | null;
  getSingleBlockViewportRect(block: Blockly.BlockSvg): DOMRect | null;
}

/**
 * Per-kind behaviour bundle. One instance per `ScanFrame` kind; collected
 * into {@link STRATEGIES} and dispatched via {@link strategyFor}. The
 * `K` type parameter narrows every method's `frame` argument to the
 * matching variant, so strategy bodies see concrete fields without an
 * internal `switch(frame.kind)` guard.
 *
 * The six methods are the full per-kind dispatch surface: cycle length,
 * sentinel detection, TTS label, highlight rect, group bounding box,
 * and Select action. The controller's `cycleLen` / `atSentinel` /
 * `currentItemLabel` / `renderHighlight` / `handleSelect` methods are
 * thin delegators onto these.
 */
interface FrameStrategy<K extends ScanFrame['kind']> {
  cycleLen(frame: Extract<ScanFrame, {kind: K}>, ctx: StrategyCtx): number;
  atSentinel(frame: Extract<ScanFrame, {kind: K}>): boolean;
  labelAt(
    frame: Extract<ScanFrame, {kind: K}>,
    ctx: StrategyCtx,
  ): string | null;
  // Caller must gate on !atSentinel(frame).
  rectAt(
    frame: Extract<ScanFrame, {kind: K}>,
    ctx: StrategyCtx,
  ): DOMRect | null;
  /**
   * Viewport bounding box of the "group" this frame represents — the
   * union of its member items, used by the sentinel chip to anchor
   * itself over the thing the user is bailing out of. Returns `null`
   * when the frame has no visually coherent group (e.g. the `top`
   * frame, which has no sentinel in the first place) or when every
   * member is currently unmeasurable.
   */
  groupRect(
    frame: Extract<ScanFrame, {kind: K}>,
    ctx: StrategyCtx,
  ): DOMRect | null;
  handleSelect(
    frame: Extract<ScanFrame, {kind: K}>,
    ctx: StrategyCtx,
  ): void;
}

/**
 * Mapped type that forces one {@link FrameStrategy} entry per
 * {@link ScanFrame} kind. Adding a 7th kind to the union without
 * extending {@link STRATEGIES} fails the build with "Property '<kind>'
 * is missing in type …" — the exhaustiveness guard that motivated the
 * refactor.
 */
type Strategies = {[K in ScanFrame['kind']]: FrameStrategy<K>};

/**
 * Strategy registry. One entry per `ScanFrame` kind, enforced
 * exhaustive by the mapped-type annotation (`: Strategies`). Each
 * entry owns the per-kind body for cycle length, sentinel detection,
 * TTS label, highlight rect, and Select action; the controller's
 * delegators dispatch here via {@link strategyFor}.
 */
/* eslint-disable @typescript-eslint/naming-convention
   -- frame.kind strings are kebab-case by design; renaming them would
   break the discriminated-union discriminator everywhere else. */
const STRATEGIES: Strategies = {
  'top': {
    cycleLen: (frame, ctx) => ctx.regions.length,
    atSentinel: () => false,
    labelAt: (frame, ctx) => {
      const region = ctx.regions[frame.index];
      return region?.name ?? null;
    },
    rectAt: (frame, ctx) => ctx.regions[frame.index]?.getRect() ?? null,
    // Top-level frame has no sentinel, so no group to anchor onto.
    // Implemented for exhaustiveness.
    groupRect: () => null,
    handleSelect: (frame, ctx) => {
      // No sentinel at the top level — every index is a real region.
      const region = ctx.regions[frame.index];
      if (!region) return;
      if (
        region.name === 'header' ||
        region.name === 'maze-actions' ||
        region.name === 'instruction-bar' ||
        region.name === 'practice-controls'
      ) {
        ctx.enterDomRegionSubScan(region.name, frame.index);
      } else if (region.name === 'toolbox') {
        ctx.enterToolboxSubScan(frame.index);
      } else if (region.name === 'workspace') {
        ctx.enterWorkspaceSubScan(frame.index);
      } else {
        // Unknown region — keep the Step-3 log behavior so any future
        // region added to `discoverRegions` without a routing branch
        // surfaces in the console rather than silently no-op'ing.
        console.log('[switch-scan] selected region:', region.name);
      }
    },
  },
  'dom-items': {
    cycleLen: (frame) => frame.items.length + 1,
    atSentinel: (frame) => frame.index === frame.items.length,
    labelAt: (frame) => {
      if (frame.index === frame.items.length) return 'Back';
      const item = frame.items[frame.index];
      if (!item) return null;
      const aria = item.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const text = item.textContent?.trim();
      return text || null;
    },
    rectAt: (frame) =>
      frame.items[frame.index]?.getBoundingClientRect() ?? null,
    groupRect: (frame) =>
      unionRects(frame.items.map((el) => el.getBoundingClientRect())),
    handleSelect: (frame, ctx) => {
      if (frame.index === frame.items.length) {
        // Sentinel: bail out of the sub-scan without firing anything.
        // Land on the SAME region the user just left so they can re-enter
        // it (matches user's mental model of "back to top = let me try
        // again from where I was").
        ctx.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      // Phase 3 Step 2: header dropdowns. Some header items open a
      // native popover (`<select>`, the custom #pegmanMenu) that the
      // switch scanner can't reach. Those items are tagged with
      // `data-scan-dropdown-source="<name>"`; if a matching provider
      // was registered, open a dropdown-values sub-scan over its
      // options instead of firing `.click()`. Mouse users still get
      // the native popover because they never go through this dispatch
      // path — they click the element directly.
      const source = item?.getAttribute('data-scan-dropdown-source');
      if (source) {
        const provider = ctx.headerDropdowns[source];
        if (provider) {
          ctx.enterHeaderDropdownValues(
            item as HTMLElement,
            provider,
            frame.topLevelIndex,
          );
          return;
        }
        // No provider registered for this source name — fall through to
        // the default click() path. Logging would be noisy on every
        // mis-tag; the silent fallback keeps mouse users unaffected.
      }
      // Click first, then pop — if click() throws we still escape the
      // sub-scan rather than getting stuck on a broken item.
      try {
        item?.click();
      } finally {
        // Action completed: pop back to the SAME top-level region the
        // user entered from so pressing Select again re-enters the
        // sub-scan they were in — see popToSameRegion docstring for
        // the rationale.
        ctx.popToSameRegion(frame.topLevelIndex);
      }
    },
  },
  'blocks': {
    cycleLen: (frame) => frame.blocks.length + 1,
    atSentinel: (frame) => frame.index === frame.blocks.length,
    labelAt: (frame) => {
      if (frame.index === frame.blocks.length) return 'Back';
      const block = frame.blocks[frame.index];
      if (!block) return null;
      try {
        // Blockly's `toString` walks the block's message + fields and
        // produces a sentence-shaped string (e.g. "move forward",
        // "turn left", "repeat 5 times do") that respects the
        // localized messages already loaded into `Blockly.Msg`. If a
        // block has connected children, toString includes their text
        // too — fine for a scan label since the highlight visually
        // hugs only the head block; the audio identifies the block
        // and the visual identifies its scope.
        const s = block.toString?.();
        if (s && s.trim()) return s.trim();
      } catch (e) {
        // Defensive — toString shouldn't throw, but if it does we fall
        // through to the type-based fallback below.
      }
      return block.type || null;
    },
    rectAt: (frame, ctx) => {
      const block = frame.blocks[frame.index];
      if (frame.regionName === 'workspace' && block) {
        // For workspace blocks we want the outline to hug ONLY the
        // current block, not the connected stack below it. The block's
        // SVG root visually contains all descendants/next-blocks, so
        // its raw bounding rect over-covers. See
        // {@link getSingleBlockViewportRect} for the conversion.
        return ctx.getSingleBlockViewportRect(block);
      } else {
        // Toolbox flyout blocks aren't stacked, so the SVG root rect
        // already hugs just the one block. Scroll the flyout to bring
        // the current block into view first so long toolboxes don't
        // leave the scan highlight off-screen — mirrors the keyboard
        // flow (FlyoutCursor.setCurNode). The scroll helper no-ops
        // when the block is already visible, so this is safe on reflow.
        if (block) {
          const flyoutWs = ctx.workspace.getFlyout()?.getWorkspace();
          if (flyoutWs) {
            scrollBoundsIntoView(block.getBoundingRectangle(), flyoutWs);
          }
        }
        const svgRoot = block?.getSvgRoot();
        return svgRoot?.getBoundingClientRect() ?? null;
      }
    },
    groupRect: (frame, ctx) => {
      // Workspace: use the per-block viewport rect so the union hugs
      // just the head-block of every stack (not the stack-tail SVG that
      // over-covers). Toolbox: the flyout SVG root already hugs the one
      // block, matching the per-item rectAt branch above.
      const rects: DOMRect[] = [];
      for (const block of frame.blocks) {
        const r =
          frame.regionName === 'workspace'
            ? ctx.getSingleBlockViewportRect(block)
            : block.getSvgRoot()?.getBoundingClientRect() ?? null;
        if (r) rects.push(r);
      }
      return unionRects(rects);
    },
    handleSelect: (frame, ctx) => {
      if (frame.index === frame.blocks.length) {
        // Sentinel pop → stay on the same region for re-entry.
        ctx.popToSameRegion(frame.topLevelIndex);
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
            const inserted = insertBlockAfterCursor(ctx.workspace, block.type);
            // Commit the FocusManager cursor to the new block before
            // returning scan focus to the toolbox. Two reasons:
            //  1. The next insert chains after this block — the
            //     insertion heuristic in block-insertion.ts reads the
            //     FocusManager cursor, so without this update each
            //     chained insert would re-walk to the tail of the first
            //     top-block instead of advancing the cursor.
            //  2. Visual confirmation — Blockly paints its own focus
            //     indicator on the new block, giving the user a brief
            //     "you just added THIS one" signal that's distinct from
            //     the switch-scan highlight returning to the toolbox.
            // Wait for the render to settle so the focusable element
            // exists when focusNode looks for it (same pattern enter.ts
            // uses for its Enter-on-flyout insert).
            const newBlock = inserted as Blockly.BlockSvg;
            Blockly.renderManagement.finishQueuedRenders().then(() => {
              try {
                Blockly.getFocusManager().focusNode(newBlock);
              } catch (err) {
                console.warn('[switch-scan] focusNode after insert failed:', err);
              }
            });
          }
        } finally {
          // Pop back to the SAME region so the user can chain inserts
          // without re-cycling through every other region first. This
          // matches the general action-commit rule: pressing Select
          // again lands back in the same sub-scan they were just in.
          ctx.popToSameRegion(frame.topLevelIndex);
        }
        return;
      }
      // Workspace block frame: open the action sub-scan menu anchored
      // next to this block. The action-menu frame inherits this frame's
      // `topLevelIndex` (the workspace top-level index) so its own pop
      // helpers compute the correct same/next resume index.
      if (block) {
        ctx.enterActionMenu(block, frame.topLevelIndex);
      }
    },
  },
  'action-menu': {
    cycleLen: (frame) => frame.items.length + 1,
    atSentinel: (frame) => frame.index === frame.items.length,
    labelAt: (frame) => {
      if (frame.index === frame.items.length) return 'Back';
      // The menu rows carry their human-readable label directly. No
      // i18n today (matches the visual rendering — Phase 5 doesn't
      // localize menu chrome).
      const item = frame.items[frame.index];
      return item?.label ?? null;
    },
    rectAt: (frame, ctx) => {
      // Highlight the currently-focused menu row inside the overlay.
      // The block underneath is implicitly the subject of every action,
      // identifiable by the menu's anchor position next to it — so we
      // intentionally don't outline the block here.
      const itemEl = ctx.actionMenuEl?.querySelector<HTMLElement>(
        `[data-scan-action-item="${frame.index}"]`,
      );
      return itemEl?.getBoundingClientRect() ?? null;
    },
    // The menu is a single DOM container, so its bounding rect already
    // encloses every row — no per-item union needed.
    groupRect: (_frame, ctx) =>
      ctx.actionMenuEl?.getBoundingClientRect() ?? null,
    handleSelect: (frame, ctx) => {
      if (frame.index === frame.items.length) {
        // "Back" sentinel — bail out without acting on the block,
        // stay on the same top region (workspace) so the user can pick a
        // different block.
        ctx.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const item = frame.items[frame.index];
      const block = frame.block;
      if (!item) {
        // Defensive fallback — treat as a sentinel-style bail.
        ctx.popToSameRegion(frame.topLevelIndex);
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
        // Action committed → land back on workspace so the user can
        // act on another block immediately (press Select to re-enter).
        ctx.popToSameRegion(frame.topLevelIndex);
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
        // Action committed → land back on workspace so the user can
        // act on another block immediately (press Select to re-enter).
        ctx.popToSameRegion(frame.topLevelIndex);
        return;
      }
      if (item.key === 'edit') {
        // Push a nested dropdown-values frame. The Edit option is only
        // present when there's at least one editable FieldDropdown, so
        // this lookup should succeed; defensively fall back to pop-to-
        // top if it doesn't (treat as a bail → same region).
        const field = ctx.findFirstEditableDropdown(block);
        if (!field) {
          ctx.popToSameRegion(frame.topLevelIndex);
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
        ctx.enterDropdownValues(block, field, frame.topLevelIndex);
        return;
      }
      if (item.key === 'move') {
        // Enumerate the block's valid drop slots ourselves and push a
        // move-candidates frame so the scan highlight jumps directly
        // onto each slot. See {@link enterMoveCandidates}.
        ctx.enterMoveCandidates(block, frame.topLevelIndex);
        return;
      }
    },
  },
  'dropdown-values': {
    cycleLen: (frame) => frame.options.length + 1,
    atSentinel: (frame) => frame.index === frame.options.length,
    labelAt: (frame) => {
      if (frame.index === frame.options.length) return 'Back';
      const option = frame.options[frame.index];
      if (!option) return null;
      const label = option[0];
      if (typeof label === 'string') return label;
      // Image-labels: use `alt` (the same text Blockly's accessibility
      // path falls back to). If alt is missing, the option's `value`
      // string is the next best thing — at least the user hears
      // something distinguishable.
      return label.alt || option[1] || null;
    },
    rectAt: (frame, ctx) => {
      const itemEl = ctx.dropdownMenuEl?.querySelector<HTMLElement>(
        `[data-scan-dropdown-item="${frame.index}"]`,
      );
      return itemEl?.getBoundingClientRect() ?? null;
    },
    // Dropdown menu is a single DOM container — its bounding rect
    // encloses every option.
    groupRect: (_frame, ctx) =>
      ctx.dropdownMenuEl?.getBoundingClientRect() ?? null,
    handleSelect: (frame, ctx) => {
      if (frame.index === frame.options.length) {
        // Bail without changing the field's value. Pop both the
        // dropdown-values frame AND the action-menu frame beneath it;
        // stay on the same top region so the user can re-enter the
        // workspace sub-scan and try editing again. For header
        // dropdowns the action-menu frame isn't on the stack so this
        // also correctly lands the user back on the header region
        // they came from.
        ctx.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const option = frame.options[frame.index];
      if (option) {
        try {
          if (frame.commitHandler) {
            // Phase 3 Step 2 — header dropdowns. The provider owns the
            // semantics (changePegman vs. dispatch change on
            // languageSelect); we just hand it the chosen value.
            frame.commitHandler(option[1]);
          } else if (frame.field) {
            frame.field.setValue(option[1]);
          }
        } catch (err) {
          console.warn('[switch-scan] dropdown commit failed:', err);
        }
      }
      // Edit committed → land back on the SAME top-level region so the
      // user can immediately act again (re-edit, edit a sibling block,
      // re-open a header dropdown). For the language dropdown this pop
      // is technically moot because commit triggers a full page reload
      // (URL changes with the new lang param), but popping anyway
      // leaves the controller in a consistent state if the reload is
      // deferred or aborted by the browser.
      ctx.popToSameRegion(frame.topLevelIndex);
    },
  },
  'move-candidates': {
    cycleLen: (frame) => frame.candidates.length + 1,
    atSentinel: (frame) => frame.index === frame.candidates.length,
    labelAt: (frame) => {
      // Move-candidates uses a "Cancel" sentinel chip (it doesn't loop
      // back to the top — Select on it bails out of the move sub-scan).
      if (frame.index === frame.candidates.length) return 'Cancel';
      const pair = frame.candidates[frame.index];
      if (!pair) return null;
      const target = pair.target;
      const sourceBlock = target.getSourceBlock();
      let blockLabel = '';
      try {
        blockLabel = sourceBlock?.toString?.().trim() || sourceBlock?.type || '';
      } catch {
        blockLabel = sourceBlock?.type || '';
      }
      // Differentiate value-input slots from stack slots so the audio
      // disambiguates a connection nested INSIDE a block from a
      // connection AFTER one.
      if (target.type === Blockly.ConnectionType.INPUT_VALUE) {
        return blockLabel ? `input on ${blockLabel}` : 'input';
      }
      return blockLabel ? `slot after ${blockLabel}` : 'slot';
    },
    rectAt: (frame, ctx) => {
      // 'move-candidates': the scan highlight jumps directly onto each
      // valid drop slot in the workspace. The sentinel (Cancel chip)
      // case is handled by `renderHighlight` directly — callers must
      // gate on `!atSentinel(frame)` before invoking this.
      const pair = frame.candidates[frame.index];
      return pair
        ? getConnectionViewportRect(pair.target, ctx.workspace)
        : null;
    },
    groupRect: (frame, ctx) => {
      // Union of every drop-slot's small square rect — the cluster of
      // connection points around the moving block.
      const rects: DOMRect[] = [];
      for (const pair of frame.candidates) {
        const r = getConnectionViewportRect(pair.target, ctx.workspace);
        if (r) rects.push(r);
      }
      return unionRects(rects);
    },
    handleSelect: (frame, ctx) => {
      if (frame.index === frame.candidates.length) {
        // Cancel slot: nothing to undo (we never entered Blockly move
        // mode), just pop back to the same top-level region so the user
        // can pick a different block.
        ctx.popToSameRegion(frame.topLevelIndex);
        return;
      }
      const pair = frame.candidates[frame.index];
      if (!pair) {
        // Defensive fallback.
        ctx.popToSameRegion(frame.topLevelIndex);
        return;
      }
      // Commit the connection. Wrap in an Events group so undo treats
      // it as a single step (otherwise the disconnect-old + connect-new
      // pair would require two undos to revert).
      Blockly.Events.setGroup(true);
      try {
        pair.target.connect(pair.local);
      } catch (err) {
        console.warn('[switch-scan] connection commit failed:', err);
      } finally {
        Blockly.Events.setGroup(false);
      }
      ctx.popToSameRegion(frame.topLevelIndex);
    },
  },
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Dispatch helper: look up the strategy for `frame.kind` and return it
 * narrowed so the caller can pass `frame` straight through without a
 * second type assertion. Callers will typically pass `frame as never`
 * at the call site to satisfy the strategy's `Extract<…>` parameter
 * — the standard escape for the "narrowed-then-passed-generically"
 * pattern.
 *
 * @param frame The active frame to dispatch on.
 */
function strategyFor<F extends ScanFrame>(
  frame: F,
): FrameStrategy<F['kind']> {
  return STRATEGIES[frame.kind] as FrameStrategy<F['kind']>;
}

// Regression guard. STRATEGIES already carries the exhaustive `Strategies`
// annotation at its declaration site; this redundant assignment catches the
// specific regression of someone *weakening* that annotation in a future
// refactor (e.g. to `Partial<Strategies>` or dropping it entirely so the
// inferred type drifts). The companion demo in
// `scripts/verify-strategy-exhaustiveness.ts` documents the pattern with
// `@ts-expect-error` assertions for anyone wanting to see the mechanism.
// eslint-disable-next-line @typescript-eslint/naming-convention
const _STRATEGIES_EXHAUSTIVENESS_GUARD: Strategies = STRATEGIES;
void _STRATEGIES_EXHAUSTIVENESS_GUARD;

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
  // Subscription registered with mazeGame.onExecutionStateChange on
  // enable() and removed via offExecutionStateChange on disable(). The
  // reference must be stable across the pair, so it's bound once in the
  // constructor and reused.
  private boundExecutionStateHandler: (isExecuting: boolean) => void;

  // Key bindings (KeyboardEvent.key values). Defaults: Space / Enter /
  // Escape. `switchBack` is optional — set to '' (empty string) to
  // disable; the keydown dispatch treats an empty back-key as
  // "no binding" since no real `KeyboardEvent.key` value is ever empty.
  private switchAdvance = ' ';
  private switchSelect = 'Enter';
  private switchBack = 'Escape';

  // Phase 4 — single-switch auto-scan state.
  //
  // `scanMode === 'step'` is the original two-switch flow: advance key
  // bumps the highlight, select key acts on the current item. Behavior
  // is byte-identical to pre-Phase-4 for step-mode users.
  //
  // `scanMode === 'auto'` is the single-switch flow described in
  // PLAN_switch_scanning.md §"Auto-Scan Behavior (one-switch mode)":
  //  - on enable() the scanner is idle (no timer running);
  //  - the first advance press transitions to `'scanning'` and starts
  //    the auto-advance timer;
  //  - subsequent advance presses act as select against the currently
  //    highlighted item (same `handleSelect` dispatch step mode uses);
  //  - a run-start clears the timer and returns to `'idle'`;
  //  - a run-end leaves us in `'idle'` (per the design doc, the user
  //    presses their switch to restart scanning after Reset).
  //
  // The select key is ignored in auto mode — Switch B is hidden in
  // the settings panel and has no role in the one-switch flow.
  private scanMode: 'step' | 'auto' = 'step';
  private scanSpeedMs = 1500;
  private autoState: 'idle' | 'scanning' = 'idle';
  // Window.setInterval returns `number` in browsers; node typings
  // disagree (NodeJS.Timeout). We're DOM-only, so `number | null`.
  private autoTimerHandle: number | null = null;

  // Settings panel reference (Step D). Optional: only wired up when
  // switch-scan mode is active AND the settings module is constructed.
  // Used purely to consult `isCapturing()` so the controller can stand
  // down while the modal's live key-capture is reading the next press.
  private settings: SwitchScanSettingsLike | null = null;

  // TTS helper (Phase 5). Optional: when null, the controller never
  // emits speak calls. When set, every renderHighlight() will derive
  // a label for the current item and ask the helper to speak it; the
  // helper itself decides whether to emit based on its enabled flag.
  // Cancel-and-replace is owned by the helper, so the controller
  // doesn't need to worry about queueing.
  private tts: SwitchScanTtsLike | null = null;

  // Phase 3 Step 2 — providers for header dropdowns (Character /
  // Language). Keyed by the `data-scan-dropdown-source` attribute on
  // the header button. Populated from {@link SwitchScanOptions} at
  // construction; left as an empty record when no header dropdowns
  // are wired so a missing key is just a "no special handling" miss
  // and falls through to the standard `.click()` path.
  private headerDropdowns: Record<string, HeaderDropdownSource> = {};

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
  // Semi-transparent panel drawn over the sentinel's group bounding box
  // so the sentinel chip reads as an exit from the group rather than a
  // free-floating affordance. Hidden except when the active frame is at
  // its sentinel slot and a group rect is available.
  private groupMaskEl: HTMLDivElement | null = null;
  // Auto-scan idle affordance — visible only when scanMode === 'auto'
  // and autoState === 'idle' so the user sees a "press to start" hint
  // before the timer is running. Without this, an auto-mode page load
  // shows a static highlight with no visible cue that pressing starts
  // scanning. Hidden via display:none in every other state.
  private autoIdleChip: HTMLDivElement | null = null;

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
    if (options.switchBack !== undefined) {
      // Empty string is intentional ("no back key"); preserve it without
      // running through normalizeKey so callers can disable the binding
      // by passing '' rather than having to guess a sentinel value.
      this.switchBack = options.switchBack === ''
        ? ''
        : normalizeKey(options.switchBack);
    }
    if (options.scanMode !== undefined) {
      this.scanMode = options.scanMode;
    }
    if (options.scanSpeedMs !== undefined) {
      this.scanSpeedMs = options.scanSpeedMs;
    }
    if (options.headerDropdowns) {
      this.headerDropdowns = options.headerDropdowns;
    }

    // Bind handlers so add/removeEventListener get matching references.
    // setKeyBindings() relies on this being a stable reference so it can
    // detach the listener and re-attach it cleanly during live rebind.
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
   *
   * Phase 4: in auto mode the scanner enters in `autoState === 'idle'`
   * — no timer is started. The highlight is rendered at the initial
   * frame so the user sees WHERE they'll be when scanning begins, but
   * nothing cycles until the user's first switch press transitions to
   * `'scanning'`. This matches the design doc: "App load: scanner is
   * idle."
   */
  enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Discover regions and create overlay DOM.
    this.regions = discoverRegions(this.workspace);
    // Seed the stack with a fresh top-level frame at index 0.
    this.frameStack = [{kind: 'top', index: 0}];
    this.createOverlayElements();

    // Bind keyboard + viewport-change events.
    // Capture-phase keydown so we run BEFORE Blockly's container-level
    // shortcut handler. Required during Phase 3 Move mode: if the
    // user's Advance switch happens to be Space or Enter, those keys
    // are ALSO bound to Blockly's `finish_move` / `enter` shortcuts.
    // Without capture-phase intercept, pressing Advance during a move
    // would prematurely commit it via Blockly's handler before our
    // own `move_down_constrained` step ever fired. We only stop
    // propagation while a move-candidates frame is on top — every
    // other frame leaves the event to flow normally, preserving
    // pre-existing behavior for the action-menu / dropdown-values /
    // toolbox / workspace sub-scans.
    document.addEventListener('keydown', this.boundKeyHandler, true);
    window.addEventListener('resize', this.boundReflow);
    window.addEventListener('scroll', this.boundReflow, true);

    // Subscribe to maze execution state for the duration of this enable
    // session. disable() calls offExecutionStateChange with the same
    // bound reference so re-enabling never doubles up on MazeGame's
    // callback list.
    this.mazeGame.onExecutionStateChange(this.boundExecutionStateHandler);

    // If a run is somehow already in flight at enable() time (rare —
    // user toggled into switch-scan during a running program), reflect
    // that state immediately so we don't render a highlight on top of
    // the animation.
    if (this.mazeGame.isExecuting()) {
      this.executing = true;
      this.tearDownOverlaysForRun();
    } else {
      // Initial render so the user sees the highlight immediately.
      // Phase 5: don't speak here — there's been no user gesture yet,
      // so the browser would either silently swallow the utterance or
      // (worse) start talking the moment the page loads. The first
      // real speak happens on the user's first advance/select press.
      this.renderHighlight({speak: false});
    }
  }

  /**
   * Disable switch scan mode.
   */
  disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Unbind events.
    // Capture-phase flag must match `enable()` so removal cleans up
    // the right listener slot.
    document.removeEventListener('keydown', this.boundKeyHandler, true);
    window.removeEventListener('resize', this.boundReflow);
    window.removeEventListener('scroll', this.boundReflow, true);
    this.mazeGame.offExecutionStateChange(this.boundExecutionStateHandler);

    // Cancel any pending reflow frame.
    if (this.reflowRafHandle !== null) {
      cancelAnimationFrame(this.reflowRafHandle);
      this.reflowRafHandle = null;
    }

    // Phase 4: clear any auto-scan timer so a `disable()` mid-scanning
    // doesn't leave the interval firing into a torn-down controller.
    // Reset autoState so a subsequent enable() starts idle again
    // (matches `enable()`'s contract — fresh idle scanner per session).
    this.clearAutoTimer();
    this.autoState = 'idle';

    // Phase 5: silence any in-progress utterance so a disable doesn't
    // leave the voice talking over a now-hidden highlight.
    this.tts?.cancel();

    // Tear down overlay DOM. If a move-candidates frame is on the stack
    // its cancel chip is removed via teardownPoppedFrame during normal
    // pops; on disable we don't drive those pops — the cancel chip is
    // a body child, so removing the body's other overlay nodes plus
    // resetting the stack below is enough. Defensive cleanup: walk the
    // stack for any straggling cancel chips.
    for (const frame of this.frameStack) {
      if (frame.kind === 'move-candidates') {
        frame.cancelChipEl.remove();
      }
    }
    this.highlightEl?.remove();
    this.sentinelChip?.remove();
    this.groupMaskEl?.remove();
    this.autoIdleChip?.remove();
    this.actionMenuEl?.remove();
    this.dropdownMenuEl?.remove();
    this.highlightEl = null;
    this.sentinelChip = null;
    this.groupMaskEl = null;
    this.autoIdleChip = null;
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
   * Re-discover top-level regions and reset to a clean top-level frame.
   *
   * The region list is determined by which DOM elements are visible
   * (blocklyDiv toggling between coding/practice changes which of
   * toolbox/workspace vs. practice-controls is in the cycle). Mode
   * changes don't re-enable the controller, so the regions list would
   * otherwise stay frozen from the last `enable()` call. Call this from
   * the host page after `setExecutionMode` flips visibility.
   *
   * Frame stack is reset to top/index=0 because any sub-scan frame
   * referenced regions or elements that may no longer exist (e.g. a
   * workspace-blocks frame after switching into practice mode).
   * Re-enabling is more disruptive than necessary — we keep listeners
   * + overlay DOM and just refresh the discoverable set.
   */
  rediscoverRegions(): void {
    if (!this.enabled) return;
    this.regions = discoverRegions(this.workspace);
    this.frameStack = [{kind: 'top', index: 0}];
    this.renderHighlight({speak: false});
  }

  /**
   * Update the advance / select / back key bindings.
   * Keys use `KeyboardEvent.key` string values; aliases like `'Space'`
   * are normalized. Pass `''` for `switchBack` to disable the back
   * binding.
   *
   * @param switchAdvance
   * @param switchSelect
   * @param switchBack    Optional. Defaults to leaving the existing back
   *     binding in place if omitted.
   */
  setKeys(
    switchAdvance: string,
    switchSelect: string,
    switchBack?: string,
  ): void {
    this.setKeyBindings(switchAdvance, switchSelect, switchBack);
  }

  /**
   * Live re-bind the advance / select / back keys without tearing down
   * scan state. Used by the settings panel's Save handler so the user
   * sees their new bindings take effect immediately, no reload required.
   *
   * Even though `handleKeyDown` reads the field values at event time
   * (so mutating the fields would be enough), we explicitly detach +
   * re-attach the listener here. That keeps the contract obvious to
   * future readers ("re-bind" really means re-bind) and gives us a
   * clean hook if we ever want to swap the handler shape (e.g.
   * capture-phase vs bubble).
   *
   * Scan state — the frame stack, cursor index, highlight overlay —
   * is left untouched so the user resumes exactly where they were.
   *
   * Accepts either a raw `KeyboardEvent.key` value (`' '`) or the
   * friendly alias `'Space'`; the same `normalizeKey` helper used at
   * construction time handles both. Back key accepts `''` to disable.
   *
   * @param switchAdvance New advance key (raw or alias).
   * @param switchSelect New select key (raw or alias).
   * @param switchBack   Optional new back key. Pass `''` to disable.
   *     When omitted, the existing back binding is preserved.
   */
  setKeyBindings(
    switchAdvance: string,
    switchSelect: string,
    switchBack?: string,
  ): void {
    this.switchAdvance = normalizeKey(switchAdvance);
    this.switchSelect = normalizeKey(switchSelect);
    if (switchBack !== undefined) {
      this.switchBack = switchBack === '' ? '' : normalizeKey(switchBack);
    }

    // Re-attach the keydown listener so the rebind is explicit even
    // though the handler reads `this.switchAdvance` / `this.switchSelect`
    // dynamically. Only do this when we're actually listening — a
    // disabled controller has no listener to swap.
    if (this.enabled) {
      // Capture flag must match `enable()` — see the docstring there
      // for why we're at capture phase.
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      document.addEventListener('keydown', this.boundKeyHandler, true);
    }
  }

  /**
   * Phase 4 — update the scan mode (and optionally the auto-scan
   * speed) without tearing down scan state.
   *
   * Called by the settings panel's Save handler so a mode toggle takes
   * effect mid-session without requiring a reload. Scan position —
   * frame stack, cursor index, highlight overlay — is left untouched
   * so the user resumes exactly where they were; ONLY the timer +
   * autoState are reset.
   *
   * Transition rules:
   *  - any → step: clear the auto timer (it might be running) and
   *    reset `autoState` to idle. Switch B is now active again.
   *  - any → auto: clear the timer and drop to idle. We deliberately
   *    do NOT auto-start the timer here — the design contract is "the
   *    user's first press wakes the scanner up", and starting it from
   *    a settings-Save would surprise the user mid-modal-close.
   *  - same mode, new scanSpeedMs: if the timer is currently running,
   *    restart it with the new period so the change takes effect
   *    immediately. If idle, the new value will be picked up on the
   *    user's next start.
   *
   * @param mode The new scan mode.
   * @param scanSpeedMs Optional new auto-scan period in milliseconds.
   *     When omitted, the existing `scanSpeedMs` is preserved.
   */
  setMode(mode: 'step' | 'auto', scanSpeedMs?: number): void {
    const wasScanning =
      this.scanMode === 'auto' && this.autoState === 'scanning';
    const prevMode = this.scanMode;

    this.scanMode = mode;
    if (scanSpeedMs !== undefined) {
      this.scanSpeedMs = scanSpeedMs;
    }

    // Always clear the existing timer — both mode transitions and
    // mid-session speed changes need a clean restart. We re-arm below
    // only in the "still auto + still scanning + speed-only change"
    // case so the user's in-progress scan picks up the new period
    // without skipping a beat.
    this.clearAutoTimer();

    if (mode === 'auto' && prevMode === 'auto' && wasScanning) {
      // Live scanSpeedMs change (or no change) while already scanning —
      // re-arm at the new period so the user sees their setting take
      // effect immediately. autoState stays 'scanning'.
      this.startAutoTimer();
    } else {
      // Mode transition (step↔auto) or starting fresh in auto mode —
      // drop back to idle so the user's next press re-arms the timer
      // on their terms. In step mode `autoState` is a no-op but we
      // keep it tidy.
      this.autoState = 'idle';
    }
  }

  /**
   * Wire the controller to the Settings panel (Step D).
   *
   * The controller only needs the {@link SwitchScanSettingsLike#isCapturing}
   * getter — when it's `true`, the modal has attached its own capture
   * keydown listener at `capture: true` to grab the user's NEXT switch
   * press as the new binding, and the controller must stand down so it
   * doesn't ALSO interpret that press as an advance/select. We can't
   * just rely on the modal's `stopImmediatePropagation()` because both
   * listeners are at the document level and the order isn't guaranteed
   * across browsers — making `handleKeyDown` short-circuit on
   * `isCapturing()` is the belt-and-braces version.
   *
   * Settings is also our hook for push/pop modal sub-scan — index.ts
   * calls `pushModalSubScan` on open, the modal's Dialog onClose calls
   * `popModalSubScan`. Both are exposed below.
   *
   * @param settings The settings panel (or any object with `isCapturing`).
   */
  setSettings(settings: SwitchScanSettingsLike | null): void {
    this.settings = settings;
  }

  /**
   * Wire the controller to the TTS helper (Phase 5).
   *
   * Same structural-type pattern as {@link setSettings} — the
   * controller doesn't import {@link SwitchScanTts} directly so the
   * dependency graph stays one-way (host page → controller; host page
   * → tts). When the helper is unset OR its own `isEnabled()` returns
   * false, speak calls degrade to no-ops; callers don't branch.
   *
   * @param tts The TTS helper, or `null` to clear.
   */
  setTts(tts: SwitchScanTtsLike | null): void {
    this.tts = tts;
  }

  /**
   * Speak the label for the currently-highlighted item (Phase 5).
   *
   * Exposed publicly so the host page can confirm a settings toggle
   * by speaking the current label as soon as audio is enabled — the
   * common "did the toggle work?" feedback case. Internal callers
   * don't need this — `renderHighlight` already speaks on every
   * highlight move.
   */
  speakCurrentItemLabel(): void {
    if (!this.tts) return;
    const label = this.currentItemLabel();
    if (label) this.tts.speak(label);
  }

  /**
   * Push a `dom-items` frame for the named region (Step D entry point).
   *
   * The modal scan flow needs the same sub-scan plumbing the header /
   * maze-actions buttons already use — discover `[data-scan-item]`
   * descendants of the `[data-scan-region="<regionName>"]` wrapper,
   * push a frame, render the highlight inside the modal — but it's
   * driven by the modal's open/close lifecycle rather than a user
   * select. Hence this public entry point: index.ts calls it when the
   * settings modal opens, the controller treats the modal as a top-
   * level sub-scan target until {@link popModalSubScan} undoes it.
   *
   * Chose Option A from the plan: programmatically open a `dom-items`
   * sub-scan over the modal's region. The frame stack already supports
   * `dom-items`; we just bootstrap it from outside the normal `select`
   * path. The `topLevelIndex` we record is the user's current top-level
   * index — so the natural pop helper lands them where they came from
   * (typically header / settings button) if the modal closes via
   * sentinel-style bail.
   *
   * Idempotent: if the modal is already pushed (e.g. an open call
   * arrives while one is already active), no-op rather than stacking
   * duplicate frames.
   *
   * @param regionName The modal's `data-scan-region` value.
   */
  pushModalSubScan(regionName: string): void {
    if (!this.enabled) return;
    // Don't double-push: if there's already a dom-items frame for this
    // region on top, leave it alone. Avoids a stale frame if the modal
    // fires `open` twice during a race (e.g. open click + focus-trap
    // bounce).
    const active = this.activeFrame();
    if (
      active?.kind === 'dom-items' &&
      active.parentRegionName === regionName
    ) {
      return;
    }

    const items = discoverDomRegionItems(regionName);
    if (items.length === 0) {
      // No scannable controls inside the modal: nothing to push. We
      // deliberately don't error — the modal still works via mouse /
      // tab focus; the scanner just has nothing useful to do here.
      return;
    }

    // Anchor on whichever top-level index the user is currently on,
    // falling back to 0 if we somehow have no top frame. This is the
    // index pop helpers use for "resume here" — for the modal we want
    // the user to land back on the originating region (e.g. header
    // where the settings button lives) after close.
    const topFrame = this.frameStack[0];
    const topLevelIndex =
      topFrame && topFrame.kind === 'top' ? topFrame.index : 0;

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
   * Pop the modal sub-scan frame and resume top-level scanning (Step D).
   *
   * Called by index.ts from the Dialog's `onClose` hook, which fires
   * for every close path the modal supports (Cancel button, Save
   * button, ESC, backdrop click). We pop every non-`top` frame on the
   * stack (via {@link pop} with `target: 'top'`) so any nested frame
   * accumulated underneath is also cleared.
   *
   * Idempotent: a no-op if the stack is already at a clean top frame
   * (e.g. close fired without a corresponding open, or close fired
   * twice).
   */
  popModalSubScan(): void {
    if (!this.enabled) return;
    // Nothing to do if we're already at the top frame.
    if (this.frameStack.length <= 1) return;
    // Land back on whichever top-level index the modal-frame recorded
    // (typically header — that's where the settings button lives).
    let resumeIndex = 0;
    for (let i = this.frameStack.length - 1; i >= 0; i--) {
      const f = this.frameStack[i];
      if (f.kind === 'dom-items' || f.kind === 'blocks' ||
          f.kind === 'action-menu' || f.kind === 'dropdown-values') {
        resumeIndex = f.topLevelIndex;
        break;
      }
    }
    this.pop({target: 'top', resumeIndex});
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

    // Group mask is appended BEFORE the sentinel chip so later siblings
    // win paint order at the same stacking context; combined with the
    // mask's lower z-index this keeps the chip visually on top of its
    // greyed-out group.
    this.groupMaskEl = document.createElement('div');
    this.groupMaskEl.className = 'switch-scan-group-mask';
    this.groupMaskEl.style.display = 'none';
    document.body.appendChild(this.groupMaskEl);

    this.sentinelChip = document.createElement('div');
    this.sentinelChip.className = 'switch-scan-sentinel';
    this.sentinelChip.textContent = '↩ Back';
    this.sentinelChip.style.display = 'none';
    document.body.appendChild(this.sentinelChip);

    this.autoIdleChip = document.createElement('div');
    this.autoIdleChip.className = 'switch-scan-idle-chip';
    this.autoIdleChip.textContent = 'Press your switch to start scanning';
    this.autoIdleChip.style.display = 'none';
    document.body.appendChild(this.autoIdleChip);
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
   * Cycle length for a given frame.
   *
   * Sub-scan frames append a sentinel "Back" slot so the user has
   * an explicit way to bail out without committing an action. The top-
   * level frame does NOT carry a sentinel — wrapping past the last real
   * region already returns the user to the start, so an extra
   * "back to top" step would just add a dead beat to the cycle every
   * pass.
   *
   * @param frame
   */
  private cycleLen(frame: ScanFrame): number {
    return strategyFor(frame).cycleLen(frame as never, this.getStrategyCtx());
  }

  /**
   * `true` iff the frame's index points at its sentinel slot. Always
   * `false` for `top` frames, since the top-level cycle has no sentinel
   * (see {@link cycleLen}).
   *
   * @param frame
   */
  private atSentinel(frame: ScanFrame): boolean {
    return strategyFor(frame).atSentinel(frame as never);
  }

  /**
   * Derive a human-readable label for the currently-highlighted item
   * (Phase 5 TTS). Returns `null` when there's no meaningful string to
   * read (e.g. defensive cases where the active frame is missing).
   *
   * Label source by frame kind:
   *  - sentinel slot of any frame → "Back" (mirrors the chip's
   *    on-screen text so the audio + visual cues match).
   *  - `top` at a real region → the region's `name` ("header",
   *    "toolbox", "workspace", "maze-actions"). The names are
   *    intentionally terse and machine-flavored — there's no
   *    region-friendly map yet, and these strings happen to read fine
   *    out loud.
   *  - `dom-items` → the item's `aria-label`, falling back to its
   *    `textContent`. The settings modal's controls already carry
   *    sensible aria-labels via the existing markup; bare buttons
   *    fall back to their visible text.
   *  - `blocks` → `block.toString()` (Blockly's built-in
   *    structurally-renders the block to "move forward", "turn left",
   *    "repeat 5 times do", etc., respecting the message strings
   *    loaded from `messages.ts`). Falls back to `block.type` if
   *    toString returns empty.
   *  - `action-menu` → the item's explicit `label` field, set when
   *    the menu was constructed.
   *  - `move-candidates` → a short description of the target
   *    connection, e.g. `"slot after move forward"` for stack
   *    connections, `"input on repeat 5"` for value inputs.
   *  - `dropdown-values` → the string form of the option label
   *    (image-labels use their `alt` text, matching how Blockly
   *    itself reads them).
   */
  private currentItemLabel(): string | null {
    const frame = this.activeFrame();
    if (!frame) return null;
    return strategyFor(frame).labelAt(frame as never, this.getStrategyCtx());
  }

  /**
   * Reposition / show / hide the highlight + sentinel chip based on
   * the active frame's current index. Safe to call any number of times.
   *
   * Highlight target by frame kind:
   *  - `top` at a real region → region's `getRect()` outline.
   *  - `top` at sentinel       → sentinel chip.
   *  - `dom-items` at an item  → item's `getBoundingClientRect()`.
   *  - `dom-items` at sentinel → sentinel chip (same "Back"
   *    affordance — pops the frame instead of resetting index).
   *  - `blocks` at a block     → block SVG root's bounding rect
   *    (viewport coordinates work with our `position: fixed` outline).
   *  - `blocks` at sentinel    → sentinel chip.
   *
   * Phase 5: after positioning the highlight, also asks the TTS helper
   * to speak the current item's label (if non-null). The helper handles
   * the cancel-and-replace contract internally so rapid advances don't
   * queue a backlog. The `speak` option is set to `false` by the
   * resize/scroll reflow path so the user doesn't hear the same label
   * re-spoken just because they resized the window.
   *
   * @param options Render flags.
   * @param options.speak Whether to announce the current item via the
   *     TTS helper. Pass `false` to suppress (used by the resize /
   *     scroll reflow path). Defaults to true — every interactive
   *     render speaks.
   */
  private renderHighlight(options?: {speak?: boolean}): void {
    if (!this.highlightEl || !this.sentinelChip) return;
    const frame = this.activeFrame();
    if (!frame) {
      this.highlightEl.style.display = 'none';
      this.sentinelChip.style.display = 'none';
      if (this.groupMaskEl) this.groupMaskEl.style.display = 'none';
      if (this.autoIdleChip) this.autoIdleChip.style.display = 'none';
      return;
    }

    // Auto-scan idle affordance — visible only when we're in auto mode
    // AND the timer hasn't started yet AND a run isn't underway. Hide
    // for every other state so the chip doesn't linger over an active
    // scan or over a maze animation.
    if (this.autoIdleChip) {
      const showIdleChip =
        this.scanMode === 'auto' &&
        this.autoState === 'idle' &&
        !this.executing;
      this.autoIdleChip.style.display = showIdleChip ? 'block' : 'none';
    }

    // Phase 5: speak the current label, unless this render was
    // triggered by a non-user reflow (resize/scroll) where re-speaking
    // would be noisy. The helper handles cancel-and-replace and the
    // disabled-state no-op, so we don't branch on those here.
    const shouldSpeak = options?.speak !== false;

    const sentinel = this.atSentinel(frame);
    if (sentinel) {
      this.highlightEl.style.display = 'none';
      const group = strategyFor(frame).groupRect(
        frame as never,
        this.getStrategyCtx(),
      );
      this.applySentinelChip(group);
      if (shouldSpeak) this.speakCurrentLabel();
      return;
    }

    // Pointing at a concrete target — hide chip, position outline.
    this.sentinelChip.style.display = 'none';
    if (this.groupMaskEl) this.groupMaskEl.style.display = 'none';

    const rect = strategyFor(frame).rectAt(frame as never, this.getStrategyCtx());

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

    if (shouldSpeak) this.speakCurrentLabel();
  }

  /**
   * Position the sentinel chip relative to its group bounding box and
   * draw the accompanying grey mask when appropriate. Thin controller-
   * side wrapper around {@link applySentinelChip}; see that function
   * for the branch policy.
   *
   * @param groupRect Bounding box of the group the sentinel exits
   *     from, or `null` when the active strategy can't compute one.
   */
  private applySentinelChip(groupRect: DOMRect | null): void {
    if (!this.sentinelChip) return;
    applySentinelChip(
      this.sentinelChip,
      this.groupMaskEl,
      groupRect,
      window.innerWidth,
      window.innerHeight,
    );
  }

  /**
   * Internal helper — derive the current item's label and forward it
   * to the TTS helper. Public {@link speakCurrentItemLabel} is the
   * external API; this is the variant `renderHighlight` calls so the
   * speak path doesn't have to re-resolve `tts` defensively.
   */
  private speakCurrentLabel(): void {
    if (!this.tts) return;
    const label = this.currentItemLabel();
    if (label) this.tts.speak(label);
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
    // Phase 5: cut off any in-progress utterance so the speech voice
    // doesn't keep talking over the maze animation. The TTS helper's
    // own no-op-when-disabled behavior makes this safe to call
    // unconditionally.
    this.tts?.cancel();
    // Phase 4: pause the auto-scan timer and drop back to idle. The
    // scanner has no business cycling while the user watches their
    // program execute; `handleRunEnd` leaves us idle so the user
    // re-arms scanning with a fresh switch press, matching the design
    // doc's "resumes idle after Reset" semantics.
    this.clearAutoTimer();
    this.autoState = 'idle';
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
   *
   * Phase 4: in auto mode we leave `autoState === 'idle'` (handleRunStart
   * already cleared the timer). The user's next switch press re-arms
   * the timer, matching the design doc's "resumes idle after Reset" —
   * we interpret that as "the scanner becomes idle after any run end,
   * waiting for the user to press to restart" so a switch user doesn't
   * find their highlight cycling under them the moment the run banner
   * disappears.
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
    if (this.groupMaskEl) this.groupMaskEl.style.display = 'none';
    if (this.autoIdleChip) this.autoIdleChip.style.display = 'none';
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;
    this.dropdownMenuEl?.remove();
    this.dropdownMenuEl = null;
    // Remove any straggling cancel chips owned by an in-flight
    // move-candidates frame. handleRunEnd resets the frame stack to a
    // fresh top.
    for (const frame of this.frameStack) {
      if (frame.kind === 'move-candidates') {
        frame.cancelChipEl.remove();
      }
    }
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
      // Phase 5: reflow renders shouldn't re-speak the current item —
      // the scan position hasn't changed, only the geometry has.
      this.renderHighlight({speak: false});
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
   * {@link popToSameRegion} so the user lands back on the region
   * they came from — pressing Select again immediately re-enters
   * the same sub-scan (chain inserts, chain edits, etc.).
   * - sub-scan at sentinel → also pops via {@link popToSameRegion}:
   * sentinel and action-commit have the same pop target by design,
   * differing only in side effect (commit vs. no-op). The "Up one
   * level, stay where you were" model is consistent across both.
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

    // Step D: while the settings modal has a live key-capture in
    // flight, every press belongs to the capture handler (it's reading
    // the user's NEXT switch press as the new binding). Stand down so
    // the controller doesn't ALSO interpret that press as advance /
    // select — otherwise the user would simultaneously rebind Switch A
    // AND fire an advance, drifting the scan position invisibly.
    // We can't rely solely on the modal's capture-phase listener +
    // stopImmediatePropagation, because listener ordering across
    // browsers at the document level isn't strictly guaranteed; the
    // explicit short-circuit is the belt-and-braces version.
    if (this.settings?.isCapturing()) return;

    // Ignore if user is typing in an input field.
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const frame = this.activeFrame();
    if (!frame) return;

    const isAdvance = e.key === this.switchAdvance;
    const isSelect = e.key === this.switchSelect;
    // Empty back-key string means the back binding is disabled; the `&&`
    // short-circuits before comparing to a real keypress so `key === ''`
    // (impossible in practice but defensive) doesn't accidentally match.
    const isBack = this.switchBack !== '' && e.key === this.switchBack;
    if (!isAdvance && !isSelect && !isBack) return;

    // The controller has decided to consume this event — swallow it
    // unconditionally so the bound switch keys never leak to Blockly's
    // keyboard-nav handler or native field popovers. Previously only the
    // move-candidates frame called preventDefault/stopPropagation, which
    // let the configured advance/select keys fall through from every other
    // frame (action-menu, dropdown-values, toolbox, workspace, top) and
    // inadvertently trigger Blockly shortcuts or browser-native behavior.
    //
    // NB: when the back key is Escape AND a native <dialog> (e.g. the
    // settings modal) is open, the dialog's own Esc-to-close handler
    // still fires because it lives on the dialog element itself, not on
    // document. So pressing Esc inside the modal closes it AND pops our
    // frame — the modal's `close` event triggers popModalSubScan which
    // is a no-op if our pop already cleared the frame, so the two paths
    // coexist without fighting.
    e.stopPropagation();
    e.preventDefault();

    if (isBack) {
      // Back is mode-agnostic — works the same way in step and auto. In
      // auto mode an idle press still doesn't make sense as "back" (the
      // scanner hasn't started cycling yet), but popping to top is a
      // sensible no-op there: the user is already at the top frame.
      this.pop({target: 'parent'});
      return;
    }

    if (this.scanMode === 'auto') {
      // Phase 4: single-switch auto-scan. The advance key is the ONLY
      // input — its meaning depends on `autoState`:
      //  - `idle`  → start the timer (no other side effect; the user's
      //              press is consumed as the "wake up" gesture, NOT a
      //              select).
      //  - `scanning` → act on the currently highlighted item (same
      //              `handleSelect` dispatch step mode uses for its
      //              Switch B). The timer keeps running so the highlight
      //              continues to auto-cycle on whatever frame the
      //              select transitioned us into (e.g. a sub-scan that
      //              was just pushed).
      // The select key is intentionally ignored — Switch B is hidden in
      // the settings panel when scanMode === 'auto' and has no role.
      if (!isAdvance) return;
      if (this.autoState === 'idle') {
        this.startAutoTimer();
        // Polish: speak the current item immediately on the idle →
        // scanning transition so the user gets audible confirmation
        // the timer is running (and knows what they're starting
        // from). Without this, TTS users would hear nothing for the
        // full `scanSpeedMs` until the first auto-tick fires. The
        // call is a no-op when TTS is off or unsupported. Only fires
        // for THIS transition — speed changes via setMode don't
        // re-trigger it, since the user is already mid-scan and
        // already knows where they are.
        this.speakCurrentItemLabel();
        return;
      }
      // autoState === 'scanning' → select.
      this.handleSelect(frame);
      return;
    }

    if (isAdvance) {
      this.advance();
      return;
    }

    // isSelect
    this.handleSelect(frame);
  }

  /**
   * Advance the current frame's highlight by one slot and re-render.
   *
   * Shared between step mode (driven by the user's advance keypress) and
   * auto mode (driven by the internal interval timer). Extracted from
   * the original inline body in {@link handleKeyDown} so both paths
   * cycle identically — including the modulo over `cycleLen` (real
   * slots + 1 sentinel) and the TTS speak triggered by
   * {@link renderHighlight}.
   */
  private advance(): void {
    const frame = this.activeFrame();
    if (!frame) return;
    const len = this.cycleLen(frame);
    if (len <= 0) return;
    frame.index = wrapIndex(frame.index + 1, len);
    this.renderHighlight();
  }

  /**
   * Phase 4 — start the auto-advance interval timer.
   *
   * Idempotent: if a timer is already running, the existing one is
   * cleared first so we never end up with two intervals racing. The
   * caller is expected to have just transitioned `autoState` from
   * `'idle'` to `'scanning'` (or to be re-entering scanning after a
   * settings-driven scanSpeedMs change).
   *
   * Note we do NOT call `advance()` immediately — the user's
   * first press is intentionally a "wake up" gesture that just starts
   * the timer; the highlight stays parked on the initial frame until
   * the first tick fires `scanSpeedMs` later. This matches the design
   * doc: "First switch press: scanner starts at top level, highlights
   * cycle on `scanSpeedMs` interval, looping."
   */
  private startAutoTimer(): void {
    this.clearAutoTimer();
    this.autoState = 'scanning';
    this.autoTimerHandle = window.setInterval(
      () => this.advance(),
      this.scanSpeedMs,
    );
    // Hide the "press to start" idle chip immediately on transition —
    // waiting for the first timer tick would leave the chip visible
    // for up to `scanSpeedMs` after the user's press. speak=false
    // because the idle→scanning caller in handleKeyDown already
    // speaks the current label explicitly.
    this.renderHighlight({speak: false});
  }

  /**
   * Phase 4 — stop the auto-advance interval timer if one is running.
   *
   * Does NOT flip `autoState` — the caller owns that decision. Used by
   * `handleRunStart` (run pauses scanning), `handleRunEnd` (back to
   * idle), `disable()` (teardown), and {@link setMode} (mode/speed
   * change). Safe to call when no timer is running.
   */
  private clearAutoTimer(): void {
    if (this.autoTimerHandle !== null) {
      window.clearInterval(this.autoTimerHandle);
      this.autoTimerHandle = null;
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
    strategyFor(frame).handleSelect(frame as never, this.getStrategyCtx());
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
   *     from. Stored on the frame so {@link popToSameRegion} can resume
   *     the user on the same region after both sentinel-bail and
   *     action-commit pops, leaving Select pressed twice in a row as a
   *     "re-enter this sub-scan" gesture.
   */
  private enterDomRegionSubScan(
    regionName: string,
    topLevelIndex: number,
  ): void {
    const items = discoverDomRegionItems(regionName);

    if (items.length === 0) {
      // Nothing to scan — advance PAST the region so the user isn't
      // stuck. This is the one place we still call popToNextRegion:
      // it's a degenerate "this region is empty, skip it" path, not a
      // user-initiated action, so the "stay on same region" rule
      // doesn't apply — re-entering an empty region would just loop
      // here. The same fallback is used by the empty-toolbox and
      // empty-workspace branches in their respective enter* helpers.
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
   * Used for BOTH sentinel pops AND action-commit pops — the scan focus
   * always pops "up one level" without moving forward, so pressing
   * Select again re-enters the sub-scan the user just came from. This
   * matters for chained actions: chain-inserting blocks from the
   * toolbox, chain-editing dropdowns on different workspace blocks,
   * clicking multiple maze-actions in a row, etc.
   *
   * @param topLevelIndex Top-level region the sub-scan was entered from.
   */
  private popToSameRegion(topLevelIndex: number): void {
    this.pop({target: 'top', resumeIndex: topLevelIndex});
  }

  /**
   * Pop every non-`top` frame off the stack and resume the top frame at
   * the NEXT top-level region (wrapping past the sentinel, modulo cycle
   * length).
   *
   * Reserved for degenerate empty-region skips: when a user enters a
   * sub-scan whose item list turns out to be empty, advancing past the
   * region prevents an infinite "select → empty → re-enter empty" loop.
   * All user-initiated action commits use {@link popToSameRegion}
   * instead, so the scan focus consistently pops up exactly one level.
   *
   * @param topLevelIndex Top-level region the sub-scan was entered from.
   */
  private popToNextRegion(topLevelIndex: number): void {
    this.pop({target: 'top', resumeIndex: topLevelIndex + 1});
  }

  /**
   * Tear down overlay DOM owned by a frame that's just been popped off
   * the stack. Centralised so {@link pop} doesn't repeat the per-kind
   * teardown switch; any future frame kind that owns a standalone
   * overlay adds its cleanup here.
   *
   * @param popped The frame that was just removed from `frameStack`.
   */
  private teardownPoppedFrame(popped: ScanFrame): void {
    if (popped.kind === 'action-menu') {
      this.actionMenuEl?.remove();
      this.actionMenuEl = null;
    } else if (popped.kind === 'dropdown-values') {
      this.dropdownMenuEl?.remove();
      this.dropdownMenuEl = null;
    } else if (popped.kind === 'move-candidates') {
      // Floating Cancel chip created in enterMoveCandidates. No Blockly
      // move state to unwind — the new flow commits via
      // `connection.connect()` directly without entering move mode.
      popped.cancelChipEl.remove();
    }
  }

  /**
   * Pop frames off the scan stack.
   *
   * `target: 'parent'` — the "back" switch handler. Pops exactly one
   * frame so the user walks UP one level: dropdown-values →
   * action-menu, action-menu → blocks, first-level sub-scan → top.
   * At `top` already, this is a no-op (quiet "I'm at the highest
   * level" affordance).
   *
   * `target: 'top'` — sub-scan commit / modal close / empty-region
   * skip. Drains every non-`top` frame and resumes the top frame at
   * `resumeIndex` (wrapped). Popping all non-`top` frames in one go
   * matters for the action-menu flow: a Select/Delete from
   * `action-menu` must skip past the workspace `blocks` frame
   * underneath, whose `blocks[]` may hold a stale reference post-
   * delete.
   *
   * Overlay teardown fires for every popped frame via
   * {@link teardownPoppedFrame}. If the frame we land on is an
   * action-menu whose overlay was torn down on the way INTO the just-
   * popped frame (dropdown-values or move-candidates), it's re-
   * rendered here; other parents' highlights repaint via
   * {@link renderHighlight}.
   *
   * Prefer the named helpers {@link popToSameRegion} /
   * {@link popToNextRegion} for 'top' pops at call sites — they encode
   * the semantic intent (user action-commit vs degenerate empty-region
   * skip).
   *
   * @param opts Pop target: `'parent'` for one-level back-switch pops,
   *     or `'top'` with a `resumeIndex` for sub-scan commits and modal
   *     closes.
   */
  private pop(
    opts: {target: 'parent'} | {target: 'top'; resumeIndex: number},
  ): void {
    let lastPopped: ScanFrame | undefined;

    if (opts.target === 'parent') {
      if (this.frameStack.length <= 1) return;
      lastPopped = this.frameStack.pop();
      if (lastPopped) this.teardownPoppedFrame(lastPopped);
    } else {
      while (
        this.frameStack.length > 0 &&
        this.frameStack[this.frameStack.length - 1].kind !== 'top'
      ) {
        const popped = this.frameStack.pop();
        if (popped) this.teardownPoppedFrame(popped);
        lastPopped = popped;
      }
      const topFrame = this.frameStack[0];
      if (topFrame?.kind === 'top') {
        topFrame.index = wrapIndex(opts.resumeIndex, this.regions.length);
      }
    }

    const parent = this.activeFrame();
    if (
      parent?.kind === 'action-menu' &&
      (lastPopped?.kind === 'dropdown-values' ||
        lastPopped?.kind === 'move-candidates')
    ) {
      this.actionMenuEl = renderActionMenu(
        this.actionMenuEl,
        parent.block,
        parent.items,
        (b) => getSingleBlockViewportRect(b, this.workspace),
      );
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
    const blocks = discoverFlyoutBlocks(this.workspace);

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
    const blocks = discoverWorkspaceBlocks(this.workspace);

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
   * Push the action-menu sub-scan for `block`, anchored adjacent to it.
   *
   * Item set is determined here, not statically:
   * - `Select` and `Delete` are always present.
   * - `Edit` is conditional on the block having at least one editable
   * `Blockly.FieldDropdown` (v1 limitation: if there are multiple
   * editable dropdowns, we'll edit the FIRST one — see
   * {@link findFirstEditableDropdown}; multi-field handling is a
   * later-phase enhancement).
   * - `Move` is conditional on the block having at least one valid
   * alternative connection on the workspace — see
   * {@link enumerateValidConnectionTargets}. If there's nowhere else
   * the block could go, entering the move sub-scan would just leave the
   * user stuck cycling candidates that don't exist, so we hide the
   * option entirely (matches the design doc instruction "skip this
   * option").
   *
   * Order is `[Select, Edit, Move, Delete]` per the design doc —
   * Move sits between Edit and Delete so the most-destructive option
   * stays at the bottom of the menu where mis-selects are less likely.
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
    if (this.enumerateValidConnectionTargets(block).length > 0) {
      items.push({key: 'move', label: 'Move'});
    }
    items.push({key: 'delete', label: 'Delete'});

    this.frameStack.push({
      kind: 'action-menu',
      block,
      items,
      index: 0,
      topLevelIndex,
    });
    this.actionMenuEl = renderActionMenu(
      this.actionMenuEl,
      block,
      items,
      (b) => getSingleBlockViewportRect(b, this.workspace),
    );
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
      anchor: block,
      options,
      index: 0,
      topLevelIndex,
    });
    this.dropdownMenuEl = renderDropdownMenu(
      this.dropdownMenuEl,
      block,
      options,
      (b) => getSingleBlockViewportRect(b, this.workspace),
    );
    this.renderHighlight();
  }

  /**
   * Push a `dropdown-values` sub-scan over a HEADER dropdown source
   * (Phase 3 Step 2 — Character / Language).
   *
   * Mirrors {@link enterDropdownValues} for the Block-Edit case but
   * anchors the menu off the header button rather than a workspace
   * block, sources options via the provider's `getOptions()`, and
   * routes the commit through the provider's `commit()` instead of
   * `field.setValue`. The `block` / `field` slots on the frame stay
   * null so the select branch knows to take the commitHandler path.
   *
   * @param anchor    The header button the user just selected (used
   *     purely as the menu's anchor — its native click() is NOT
   *     fired, otherwise the native popover would appear behind our
   *     overlay).
   * @param source    The provider registered under the matching
   *     `data-scan-dropdown-source` name.
   * @param topLevelIndex Top-level index the user was on when they
   *     entered the header sub-scan — passed through so the standard
   *     same/next pop helpers compute correctly.
   */
  private enterHeaderDropdownValues(
    anchor: HTMLElement,
    source: HeaderDropdownSource,
    topLevelIndex: number,
  ): void {
    let options: Array<
      [string | {src: string; width: number; height: number; alt: string}, string]
    >;
    try {
      options = source.getOptions();
    } catch (err) {
      console.warn('[switch-scan] header dropdown getOptions failed:', err);
      this.popToSameRegion(topLevelIndex);
      return;
    }
    if (!options || options.length === 0) {
      // Nothing to pick — treat as a sentinel bail so the user lands
      // back on the same header region for another try (likely a
      // transient empty state).
      this.popToSameRegion(topLevelIndex);
      return;
    }

    this.frameStack.push({
      kind: 'dropdown-values',
      block: null,
      field: null,
      anchor,
      options,
      index: 0,
      topLevelIndex,
      commitHandler: (value) => source.commit(value),
    });
    this.dropdownMenuEl = renderDropdownMenu(
      this.dropdownMenuEl,
      anchor,
      options,
      (b) => getSingleBlockViewportRect(b, this.workspace),
    );
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
   * Enumerate every `(localConn, targetConn)` pair where one of
   * `block`'s own connections could legally connect to a connection on
   * some OTHER block on the workspace (excluding `block`'s own
   * descendants — they move with it, so they aren't valid attachment
   * targets).
   *
   * Returned in iteration order (outer: `block`'s own connections, inner:
   * every other workspace block's connections). Stable order is what
   * makes the switch-scan move sub-scan feel predictable across repeats —
   * the user can rely on "advance N times to reach the same slot" without
   * having to count past spurious reorderings.
   *
   * Used both as the source of truth for the move-candidates sub-scan and
   * (via `.length > 0`) as the predicate for whether the action menu's
   * "Move" entry should appear at all. Mirrors the same direction filter
   * as the maze game's normal-mode `hasValidConnections` in `index.ts`.
   *
   * @param block
   */
  private enumerateValidConnectionTargets(
    block: Blockly.BlockSvg,
  ): Array<{local: Blockly.Connection; target: Blockly.Connection}> {
    const pairs: Array<{local: Blockly.Connection; target: Blockly.Connection}> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localConnections = (block as any).getConnections_?.(false) as
      | Blockly.Connection[]
      | undefined;
    if (!localConnections || localConnections.length === 0) return pairs;

    const movingDescendants = block.getDescendants(true) as Blockly.BlockSvg[];
    const movingSet = new Set(movingDescendants);
    const allWorkspaceConnections: Blockly.Connection[] = [];
    for (const b of this.workspace.getAllBlocks(false)) {
      if (movingSet.has(b as Blockly.BlockSvg)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conns = (b as any).getConnections_?.(false) as Blockly.Connection[] | undefined;
      if (conns) allWorkspaceConnections.push(...conns);
    }
    if (allWorkspaceConnections.length === 0) return pairs;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectionChecker = (this.workspace as any).connectionChecker as
      | {
          canConnect(
            a: Blockly.Connection,
            b: Blockly.Connection,
            isDragging: boolean,
            distance: number,
          ): boolean;
        }
      | undefined;
    if (!connectionChecker) return pairs;

    for (const local of localConnections) {
      for (const ws of allWorkspaceConnections) {
        const sourceBlock = ws.getSourceBlock();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!sourceBlock || (sourceBlock as any).isInsertionMarker?.()) continue;
        const isValidDirection =
          (local.type === Blockly.ConnectionType.OUTPUT_VALUE &&
            ws.type === Blockly.ConnectionType.INPUT_VALUE) ||
          (local.type === Blockly.ConnectionType.PREVIOUS_STATEMENT &&
            ws.type === Blockly.ConnectionType.NEXT_STATEMENT) ||
          (local.type === Blockly.ConnectionType.NEXT_STATEMENT &&
            ws.type === Blockly.ConnectionType.PREVIOUS_STATEMENT);
        if (!isValidDirection) continue;
        if (connectionChecker.canConnect(local, ws, true, Infinity)) {
          pairs.push({local, target: ws});
        }
      }
    }
    return pairs;
  }

  /**
   * Enter the move-candidates sub-scan: the scan highlight jumps
   * directly onto each valid drop slot in the workspace; advance walks
   * the list; select commits via `target.connect(local)`. The +1
   * sentinel slot is a "Cancel" chip anchored near the block. We
   * deliberately do NOT enter Blockly's own move mode — bypassing it
   * means we don't have to keep an internal `Mover` cursor in lock-step
   * with our own index, and we don't have to unwind a drag-strategy
   * patch if the user backs out.
   *
   * @param block
   * @param topLevelIndex
   */
  private enterMoveCandidates(
    block: Blockly.BlockSvg,
    topLevelIndex: number,
  ): void {
    // Tear down the action menu first so the cancel chip doesn't visually
    // stack on top of it.
    this.actionMenuEl?.remove();
    this.actionMenuEl = null;

    const candidates = this.enumerateValidConnectionTargets(block);
    if (candidates.length === 0) {
      // Defensive: the action menu only surfaces Move when at least one
      // candidate exists, so we shouldn't get here. Bail back to the
      // same region so the user can try something else.
      this.popToSameRegion(topLevelIndex);
      return;
    }

    // Floating Cancel chip — visually the sentinel slot of the cycle.
    // Reuses the sentinel chip styling so the affordance reads
    // consistently with the rest of the scanner, with an inline bottom-
    // right anchor since the shared class leaves positioning to the
    // caller. The chip itself is what the highlight outlines when
    // index === candidates.length.
    const cancelChipEl = document.createElement('div');
    cancelChipEl.className = 'switch-scan-sentinel';
    cancelChipEl.textContent = '✕ Cancel';
    cancelChipEl.style.bottom = '16px';
    cancelChipEl.style.right = '16px';
    cancelChipEl.style.transform = 'none';
    document.body.appendChild(cancelChipEl);

    this.frameStack.push({
      kind: 'move-candidates',
      block,
      candidates,
      cancelChipEl,
      index: 0,
      topLevelIndex,
    });
    this.renderHighlight();
  }

  /**
   * Invoke a named shortcut from Blockly's `ShortcutRegistry` against
   * this controller's workspace. Returns true iff the shortcut existed,
   * its preconditionFn (if any) passed, AND its callback ran. We don't
   * synthesize a real `KeyboardEvent` here — the move-mode shortcut
   * callbacks all ignore the event/scope arguments and only read the
   * workspace, so an empty fake event is sufficient.
   *
   * @param name
   */
  private invokeShortcut(name: string): boolean {
    const registry = Blockly.ShortcutRegistry.registry.getRegistry();
    const shortcut = registry[name];
    if (!shortcut || !shortcut.callback) return false;
    try {
      if (shortcut.preconditionFn && !shortcut.preconditionFn(this.workspace, {})) {
        return false;
      }
      return !!shortcut.callback(
        this.workspace,
        // The move-mode callbacks never read the event; an empty
        // synthetic KeyboardEvent satisfies the type without
        // triggering any DOM side-effects.
        new KeyboardEvent('keydown'),
        shortcut,
        {workspace: this.workspace},
      );
    } catch (err) {
      console.warn(`[switch-scan] shortcut "${name}" threw:`, err);
      return false;
    }
  }

  /**
   * Wrap the imported {@link getSingleBlockViewportRect} helper as a
   * method so it's reachable through {@link StrategyCtx} without the
   * strategies needing to know about the module-scope import or the
   * `workspace` second argument.
   *
   * @param block
   */
  private getSingleBlockViewportRect(
    block: Blockly.BlockSvg,
  ): DOMRect | null {
    return getSingleBlockViewportRect(block, this.workspace);
  }

  /**
   * Return `this` as the structural {@link StrategyCtx} the strategies
   * expect. The controller already exposes everything StrategyCtx needs;
   * the cast narrows to the structural shape without duplicating field
   * bindings.
   */
  private getStrategyCtx(): StrategyCtx {
    return this as unknown as StrategyCtx;
  }
}

/**
 * Internal surface exposed for unit tests only. Not for production use —
 * the strategy registry, union helper, and sentinel-chip placement
 * function are module-private because the controller is the only
 * production caller. Tests reach them through this handle so the
 * strategy policy and chip-branch policy can be exercised without
 * standing up a full controller + Blockly workspace.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __testOnly = {
  STRATEGIES,
  unionRects,
  applySentinelChip,
};
