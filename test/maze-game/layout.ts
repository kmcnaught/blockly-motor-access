/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Layout pipeline: panel sizing, page zoom, compact mode,
 * collapsible sidebar, and ResizeObserver wiring.
 */

import * as Blockly from 'blockly/core';

// ========== LAYOUT CONSTANTS ==========

const MIN_BLOCKLY_FLYOUT_MULTIPLIER = 2.2;
const MIN_GAME_FLYOUT_MULTIPLIER = 1.5;
/** Min left-panel width in practice mode (command buttons + 24px padding each side). */
const PRACTICE_LEFT_PANEL_MIN_WIDTH = 320;
/**
 * Minimum game panel width (px) to keep Run+Reset buttons on a single row.
 * Run (~138px) + gap (12px) + Reset (~98px) + game-container h-padding (32px) ≈ 280px.
 * Used as a floor in computePanelWidths and as the horizontal minMaze in computeFitZoom.
 */
const MIN_GAME_PANEL_WIDTH = 280;

// ========== MODE VISIBILITY CONFIG ==========
// Single source of truth for what is visible / active in each layout mode.
// Add a new entry here when adding a new mode; applyModeUI() reads this table.

export type LayoutMode = 'coding' | 'practice' | 'grid-practice' | 'grid-coding';

export interface ModeSpec {
  blocklyDiv: boolean;
  runButton: boolean;
  gridCodingControls: boolean;
  immediateController: 'enable' | 'disable';
  gridCodingController: 'enable' | 'disable';
  /**
   * Min left-panel width for layout purposes.
   * 'flyout'  — use 2.2× flyout-width heuristic (coding modes with visible toolbox).
   * number    — fixed px minimum (e.g. practice mode command buttons).
   * 'skip'    — left panel hidden by CSS; applyPanelWidths returns early, never calls
   *             computePanelWidths for this mode.
   */
  leftPanelMinWidth: number | 'flyout' | 'skip';
}

export const MODE_SPECS: Record<LayoutMode, ModeSpec> = {
  // Normal coding: Blockly + maze side by side, run/reset visible
  'coding': {
    blocklyDiv: true,
    runButton: true,
    gridCodingControls: false,
    immediateController: 'disable',
    gridCodingController: 'disable',
    leftPanelMinWidth: 'flyout',
  },
  // Practice: command-button panel + maze side by side, run hidden
  'practice': {
    blocklyDiv: false,
    runButton: false,
    gridCodingControls: false,
    immediateController: 'enable',
    gridCodingController: 'disable',
    leftPanelMinWidth: PRACTICE_LEFT_PANEL_MIN_WIDTH,
  },
  // Grid + practice: just the maze (blockly-container hidden by CSS body.grid-mode)
  'grid-practice': {
    blocklyDiv: false,
    runButton: false,
    gridCodingControls: false,
    immediateController: 'enable', // handles keyboard events from Grid3
    gridCodingController: 'disable',
    leftPanelMinWidth: 'skip', // applyPanelWidths returns early for isGridMode; never reaches computePanelWidths
  },
  // Grid + coding: workspace + maze, no toolbox (Grid3 provides it)
  'grid-coding': {
    blocklyDiv: true,
    runButton: false,
    gridCodingControls: true,
    immediateController: 'disable',
    gridCodingController: 'enable',
    leftPanelMinWidth: 'flyout',
  },
};

// ========== DEPS ==========

export interface LayoutDeps {
  workspace: Blockly.WorkspaceSvg;
  redraw: () => void;
  isGridMode: boolean;
  isGridCodingMode: boolean;
  getExecutionMode: () => 'practice' | 'coding';
}

let d: LayoutDeps;

/** Which layout mode is currently active. */
export function getCurrentLayoutMode(): LayoutMode {
  if (!d) return 'coding';
  if (d.isGridMode) return 'grid-practice';
  if (d.isGridCodingMode) return 'grid-coding';
  return d.getExecutionMode() === 'practice' ? 'practice' : 'coding';
}

// ========== LAYOUT STATE ==========

// layoutPending flag — declared at module scope so scheduleLayout calls before
// initLayout (e.g. from the workspace FINISHED_LOADING listener) don't throw.
let layoutPending = false;
let initialized = false;

// DOM refs — set once in initLayout
let blocklyContainer: HTMLElement;
let gameContainer: HTMLElement;
let mainContainer: HTMLElement;

// ========== GRID MODE LEVEL VISIBILITY ==========

// Hide level label when viewport is too small (works regardless of zoom level)
function checkGridModeLevelVisibility(): void {
  if (!d.isGridMode) return;

  const gridModeLevel = document.getElementById('gridModeLevel');
  if (!gridModeLevel) return;

  // Hide level label when viewport height is under threshold
  // This handles zoom, small screens, or any situation where space is limited
  const hideThreshold = 600; // pixels

  if (window.innerHeight < hideThreshold) {
    gridModeLevel.style.display = 'none';
  } else {
    gridModeLevel.style.display = '';
  }
}

// ========== COMPACT MODE ==========

/**
 * Check if compact mode should be enabled based on available space.
 * Compact mode overlays the level navigation buttons on the canvas
 * instead of showing them above it, saving vertical space.
 *
 * Uses the actual container height (in CSS layout pixels) so this responds
 * correctly to in-page zoom: at high zoom the container shrinks even though
 * window.innerHeight is unchanged.
 */
function checkCompactMode() {
  if (!gameContainer || !mainContainer) return;

  // Use the container's layout height — this accounts for in-page zoom
  // (the scale wrapper shrinks when zoomed in, so CSS pixel heights decrease).
  // Threshold: level-selector (~74px) + canvas (min 200px) + game-controls (~76px)
  // + padding (48px) + instrBar (~50px) + header (~65px) = ~513px; use 540 for safety.
  const containerHeight = mainContainer.offsetHeight;
  const compactThreshold = 540;

  if (containerHeight < compactThreshold) {
    gameContainer.classList.add('compact');
  } else {
    gameContainer.classList.remove('compact');
  }
}

// ========== COLLAPSIBLE SIDEBAR ==========

let sidebarCollapsed = false;

/**
 * Collapse the sidebar (game panel).
 */
function collapseSidebar() {
  if (!mainContainer) return;
  mainContainer.classList.add('sidebar-collapsed');
  sidebarCollapsed = true;
  // Trigger layout after CSS transition completes
  setTimeout(() => scheduleLayout(), 400);
}

/**
 * Expand the sidebar (game panel).
 */
function expandSidebar() {
  if (!mainContainer) return;
  mainContainer.classList.remove('sidebar-collapsed');
  sidebarCollapsed = false;
  // Schedule layout after CSS transition completes
  setTimeout(() => scheduleLayout(), 400);
}

/**
 * Toggle the sidebar collapsed state.
 */
export function toggleSidebar() {
  if (sidebarCollapsed) {
    expandSidebar();
  } else {
    collapseSidebar();
  }
}

// ========== LAYOUT PIPELINE ==========
// scheduleLayout/doLayout coalesce all layout work (panel reflow, Blockly SVG
// resize, narrow-class toggle, grid min-height) into a single rAF per frame.

export function scheduleLayout(): void {
  if (layoutPending) return;
  layoutPending = true;
  requestAnimationFrame(() => {
    layoutPending = false;
    if (!initialized) return;
    doLayout();
  });
}

function doLayout(): void {
  // Enforce the fit-zoom ceiling before distributing panels. This covers cases
  // where enforceFitZoom isn't triggered by a window resize — e.g. the user
  // increases screen padding, or a level change widens the Blockly flyout.
  const fit = fitZoomStep();
  if (pageZoom > fit) applyPageZoom(fit);

  checkCompactMode();                       // must run before applyPanelWidths (affects measureGameChromeV)
  applyPanelWidths();                       // re-distribute panels for current viewport
  Blockly.svgResize(d.workspace);           // exactly once per layout cycle
  checkBlocklyWidth();                      // narrow class toggle
  updateGridCodingMinHeight();              // no-op in normal mode (guards on isGridCodingMode internally)
  validateLayout();                         // dev-mode invariant check
  // Defer redraw to next frame so CSS transitions (e.g. panel width change) have
  // settled and wrapper.clientWidth/clientHeight return final values.
  requestAnimationFrame(() => d.redraw());
}

function validateLayout(): void {
  if (process.env.NODE_ENV === 'production') return;
  const wrapper = document.getElementById('page-scale-wrapper');
  if (!wrapper) return;
  const wr = wrapper.getBoundingClientRect();
  for (const id of ['runButton', 'resetButton', 'zoomInBtn', 'zoomOutBtn']) {
    const el = document.getElementById(id);
    if (!el || el.closest('.hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > wr.bottom + 2 || r.top < wr.top - 2) {
      console.warn(`[layout] #${id} is outside visible area`, r, wr);
    }
  }
}

// ========== PANEL WIDTHS ==========

/**
 * Measure the vertical space inside .game-container that is not the canvas.
 * Reads from the DOM so it stays accurate when CSS changes.
 * Elements have stable natural heights independent of the canvas size.
 */
function measureGameChromeV(): number {
  const levelSel = gameContainer?.querySelector('.level-selector') as HTMLElement | null;
  const gameCtrl = gameContainer?.querySelector('.game-controls') as HTMLElement | null;
  if (!gameContainer || !levelSel || !gameCtrl) return 208; // fallback matches old hardcoded value
  const gcStyle = getComputedStyle(gameContainer);
  const lsStyle = getComputedStyle(levelSel);
  // In compact mode the level-selector is position:absolute — it leaves the flex flow
  // and contributes zero height to the layout. Only count it when it's in-flow.
  const isCompact = gameContainer.classList.contains('compact');
  const levelSelFlexH = isCompact
    ? 0
    : levelSel.offsetHeight + parseFloat(lsStyle.marginTop) + parseFloat(lsStyle.marginBottom);
  // Use a minimum floor for game-controls height: on first layout the element may
  // not yet have reflowed with its correct width, so offsetHeight can be 0.
  // The controls are a single row of buttons with padding:16px 0 (~78px total).
  const MIN_GAME_CTRL_H = 78;
  const gameCtrlH = Math.max(MIN_GAME_CTRL_H, gameCtrl.offsetHeight);
  return (
    parseFloat(gcStyle.paddingTop) + parseFloat(gcStyle.paddingBottom) +   // game-container V padding
    levelSelFlexH +
    gameCtrlH
  );
}

function computePanelWidths(): { blocklyWidth: number; gameWidth: number } {
  const containerWidth  = mainContainer.offsetWidth;
  const containerHeight = mainContainer.offsetHeight;

  if (containerWidth === 0) return { blocklyWidth: 0, gameWidth: 0 };

  const flyout = d.workspace.getFlyout();
  const flyoutWidth = flyout?.getWidth() ?? 100;
  const modeMinWidth = MODE_SPECS[getCurrentLayoutMode()].leftPanelMinWidth;
  if (modeMinWidth === 'skip') {
    // applyPanelWidths returns early for this mode — computePanelWidths should not be reached
    return { blocklyWidth: 0, gameWidth: 0 };
  }
  const minBlocklyWidth = modeMinWidth === 'flyout'
    ? Math.max(280, Math.ceil(flyoutWidth * MIN_BLOCKLY_FLYOUT_MULTIPLIER))
    : modeMinWidth;

  if (getCurrentLayoutMode() === 'grid-coding') {
    // Grid coding mode: give blockly as much as possible, game panel constrained by height
    const idealMaze = containerHeight;
    const gameWidth = Math.min(Math.round(containerWidth * 0.45), idealMaze);
    return { blocklyWidth: containerWidth - gameWidth, gameWidth };
  }

  // Normal mode: size game panel to fit maze squarely with controls visible
  const availableForMaze = containerHeight - measureGameChromeV();
  const idealMazeSize = Math.max(200, availableForMaze);
  const GAME_H_PADDING = 32; // game-container left+right padding
  // Enforce MIN_GAME_PANEL_WIDTH so Run+Reset buttons always fit on a single row.
  let gameWidth = Math.max(MIN_GAME_PANEL_WIDTH, idealMazeSize + GAME_H_PADDING);
  let blocklyWidth = containerWidth - gameWidth;

  if (blocklyWidth < minBlocklyWidth) {
    blocklyWidth = minBlocklyWidth;
    gameWidth = containerWidth - minBlocklyWidth;
  }

  // On wide screens, cap blockly at 60% and give surplus to game panel
  const maxBlocklyWidth = Math.round(containerWidth * 0.60);
  if (blocklyWidth > maxBlocklyWidth) {
    blocklyWidth = maxBlocklyWidth;
    gameWidth = containerWidth - maxBlocklyWidth;
  }

  return { blocklyWidth, gameWidth };
}

function applyPanelWidths(): void {
  if (!blocklyContainer || !gameContainer) return;

  const canvasWrapper = gameContainer.querySelector('.canvas-wrapper') as HTMLElement | null;

  if (d.isGridMode || sidebarCollapsed) {
    // Clear explicit widths/heights; CSS handles these modes
    blocklyContainer.style.flex = '';
    blocklyContainer.style.width = '';
    gameContainer.style.flex = '';
    gameContainer.style.width = '';
    gameContainer.style.height = '';
    if (canvasWrapper) {
      canvasWrapper.style.flex = '';
      canvasWrapper.style.height = '';
    }
    return;
  }
  const { blocklyWidth, gameWidth } = computePanelWidths();
  if (blocklyWidth <= 0 || gameWidth <= 0) return; // container not yet laid out
  blocklyContainer.style.flex = 'none';
  blocklyContainer.style.width = `${blocklyWidth}px`;
  gameContainer.style.flex = 'none';
  gameContainer.style.width = `${gameWidth}px`;
  gameContainer.style.height = '';
  // Explicitly set canvas-wrapper height so getCanvasSize() reads the correct
  // value. Without this the canvas sizes to its full width when the panel is
  // wider than tall, overflowing the game-controls below.
  // measureGameChromeV uses a minimum floor for game-controls so it's stable
  // even on first render before game-controls has reflowed with its final width.
  if (canvasWrapper) {
    const containerH = mainContainer.clientHeight;
    const canvasWrapperH = Math.max(100, containerH - measureGameChromeV());
    canvasWrapper.style.flex = 'none';
    canvasWrapper.style.height = `${canvasWrapperH}px`;
  }
}

// ========== PAGE ZOOM CONTROLS ==========

const ZOOM_KEY = 'mazePageZoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

let pageZoom = 1;

export function computeFitZoom(): number {
  // Horizontal constraint — minimum total width needed by the two panels.
  // Use mode-aware minimums so practice mode isn't over-constrained by flyout width.
  const modeMinWidth = MODE_SPECS[getCurrentLayoutMode()].leftPanelMinWidth;
  const flyout = d.workspace.getFlyout();
  const flyoutWidth = flyout ? flyout.getWidth() : 100;
  const minBlockly = (modeMinWidth === 'flyout' || modeMinWidth === 'skip')
    ? Math.ceil(flyoutWidth * MIN_BLOCKLY_FLYOUT_MULTIPLIER)
    : modeMinWidth;
  // Minimum game-panel width: maze side + horizontal padding
  const minMaze = modeMinWidth === 'skip'
    ? 200 // grid-practice: full viewport for maze
    : Math.max(MIN_GAME_PANEL_WIDTH, Math.ceil(flyoutWidth * MIN_GAME_FLYOUT_MULTIPLIER));
  // Screen padding elements (vw-based) consume layout space and reduce the
  // content area available for the two panels. Their offsetWidth is in real CSS
  // pixels (transforms don't affect layout), which is the same coordinate space
  // as innerWidth, so we can subtract them directly.
  const leftPad  = document.getElementById('leftPadding') as HTMLElement | null;
  const rightPad = document.getElementById('rightPadding') as HTMLElement | null;
  const paddingPx = (leftPad?.offsetWidth ?? 0) + (rightPad?.offsetWidth ?? 0);
  // Use innerWidth (CSS pixels) — the same unit as vw-based padding and layout.
  const fitH = window.innerWidth / (minBlockly + minMaze + paddingPx);

  // Vertical constraint — prevent game-controls from being clipped at the bottom.
  const headerEl = document.querySelector('header') as HTMLElement | null;
  const instrBar = document.getElementById('instructionBar') as HTMLElement | null;
  const fixedVertical = (headerEl?.offsetHeight ?? 65)
                      + (instrBar?.offsetHeight ?? 50)
                      + measureGameChromeV();
  const MIN_MAZE_SIZE = 200; // minimum usable canvas
  const fitV = window.innerHeight / (fixedVertical + MIN_MAZE_SIZE);

  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(fitH, fitV)));
}

/** Fit zoom floored to the nearest ZOOM_STEP — the ceiling used by applyPageZoom. */
function fitZoomStep(): number {
  return Math.floor(computeFitZoom() / ZOOM_STEP) * ZOOM_STEP;
}

function updateZoomButtons() {
  const fitZoom = fitZoomStep();
  const zoomOutBtn = document.getElementById('zoomOutBtn') as HTMLButtonElement;
  const zoomInBtn = document.getElementById('zoomInBtn') as HTMLButtonElement;
  if (zoomOutBtn) zoomOutBtn.disabled = pageZoom <= ZOOM_MIN;
  if (zoomInBtn) zoomInBtn.disabled = pageZoom >= Math.min(ZOOM_MAX, fitZoom);
}

export function applyPageZoom(zoom: number) {
  // Clamp to the fit ceiling (floored to nearest step) so pageZoom never causes overflow after rounding.
  // ZOOM_MAX is already enforced inside computeFitZoom, so fitZoomStep() never exceeds it.
  pageZoom = Math.round(Math.max(ZOOM_MIN, Math.min(fitZoomStep(), zoom)) * 10) / 10;

  const wrapper = document.getElementById('page-scale-wrapper')!;
  const size = 100 / pageZoom;
  wrapper.style.width = `${size}vw`;
  wrapper.style.height = `${size}vh`;
  wrapper.style.transform = `scale(${pageZoom})`;

  // Remove any body zoom/size styles left over from previous approach
  (document.body.style as any)['zoom'] = '';
  document.body.style.width = '';
  document.body.style.height = '';

  // Expose zoom level as a CSS variable so overlay divs outside the scale wrapper
  // (e.g. .blocklyDropDownDiv, .blocklyWidgetDiv) can apply a matching transform.
  document.documentElement.style.setProperty('--page-zoom', String(pageZoom));

  localStorage.setItem(ZOOM_KEY, String(pageZoom));
  const label = document.getElementById('zoomLabel');
  if (label) label.textContent = `${Math.round(pageZoom * 100)}%`;
  updateZoomButtons();
}

// ========== NARROW BLOCKLY DETECTION ==========

/**
 * Check if Blockly workspace is narrow and hide controls if so.
 * When the workspace is too narrow, the trash can and zoom controls
 * overlap with blocks, so we hide them.
 */
function checkBlocklyWidth() {
  if (!blocklyContainer) return;

  // 500px is roughly the minimum width where Blockly's built-in controls
  // (trashcan, zoom buttons) don't overlap with the flyout and workspace blocks
  const narrowThreshold = 500;
  const width = blocklyContainer.offsetWidth;

  if (width < narrowThreshold) {
    blocklyContainer.classList.add('narrow');
  } else {
    blocklyContainer.classList.remove('narrow');
  }
}

/**
 * In grid coding mode, manage layout based on available space.
 * - Sets min-height based on width to maintain aspect ratio
 * - Toggles compact mode when content doesn't fit vertically
 * - Hides instruction bar when even more space is needed
 */
function updateGridCodingMinHeight() {
  if (!d.isGridCodingMode || !gameContainer) return;

  // Set min-height to 40% of width - allows vertical shrinking while maintaining proportion.
  // Guard the write so ResizeObserver doesn't fire when the value hasn't changed.
  const minHeight = gameContainer.offsetWidth * 0.4;
  const minHeightPx = `${minHeight}px`;
  if (gameContainer.style.minHeight !== minHeightPx) {
    gameContainer.style.minHeight = minHeightPx;
  }

  // Check if content overflows - if so, enable compact mode
  const canvas = document.getElementById('mazeCanvas');
  const instructionBar = document.getElementById('instructionBar');
  if (!canvas) return;

  // clientHeight forces a synchronous reflow, so the minHeight write above is
  // already reflected in this read — no extra rAF needed.
  const availableHeight = gameContainer.clientHeight;
  const canvasHeight = canvas.offsetHeight;
  const controlsHeight = 40; // approximate height of controls
  const gaps = gameContainer.classList.contains('compact') ? 8 : 16;

  // Calculate needed height based on current state (without label if compact)
  const neededHeight = canvasHeight + controlsHeight + gaps;
  const isCompact = gameContainer.classList.contains('compact');
  const isInstructionBarHidden = instructionBar?.classList.contains('hidden');

  // Use hysteresis: collapseAt > expandBelow creates a 20px dead zone to prevent oscillation
  const collapseAt = availableHeight;
  const expandBelow = availableHeight - 20;

  if (neededHeight > collapseAt && !isCompact) {
    gameContainer.classList.add('compact');
  } else if (neededHeight < expandBelow && isCompact) {
    gameContainer.classList.remove('compact');
    // Restore instruction bar when expanding
    if (instructionBar && isInstructionBarHidden) {
      instructionBar.classList.remove('hidden');
    }
  }

  // Second level: hide instruction bar if still too tight even in compact mode
  if (isCompact && neededHeight > availableHeight && instructionBar && !isInstructionBarHidden) {
    instructionBar.classList.add('hidden');
  }
}

function enforceFitZoom(): void {
  const fit = fitZoomStep();
  if (pageZoom > fit) {
    applyPageZoom(fit);
  }
  updateZoomButtons();
  scheduleLayout();
}

// ========== INIT ==========

export function initLayout(deps: LayoutDeps): void {
  d = deps;

  // Query DOM elements
  blocklyContainer = document.querySelector('.blockly-container') as HTMLElement;
  gameContainer = document.querySelector('.game-container') as HTMLElement;
  mainContainer = document.querySelector('.container') as HTMLElement;

  // Clean up stale localStorage keys from the old PanelResizer
  localStorage.removeItem('mazeBlocklyPanelWidth');
  localStorage.removeItem('mazeGamePanelWidth');

  // Load saved zoom
  pageZoom = parseFloat(localStorage.getItem(ZOOM_KEY) ?? '1');

  // Wire resize listeners
  window.addEventListener('resize', enforceFitZoom);
  window.addEventListener('resize', checkCompactMode);
  window.addEventListener('resize', checkGridModeLevelVisibility);

  // Wire sidebar toggle
  const sidebarToggle = document.getElementById('sidebarToggle');
  sidebarToggle?.addEventListener('click', toggleSidebar);

  // Wire zoom buttons
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
    applyPageZoom(pageZoom - ZOOM_STEP);
    scheduleLayout();
  });
  document.getElementById('zoomInBtn')?.addEventListener('click', () => {
    applyPageZoom(pageZoom + ZOOM_STEP);
    scheduleLayout();
  });

  // ResizeObserver drives the layout cycle: any container size change (browser
  // zoom, window resize) fires scheduleLayout, which runs doLayout once per
  // animation frame. doLayout calls applyPanelWidths(), which freshly computes
  // widths from screen geometry — no stored state, no feedback loop.
  // (layoutPending deduplicates concurrent scheduleLayout calls.)
  const resizeObserver = new ResizeObserver(scheduleLayout);
  if (mainContainer) {
    resizeObserver.observe(mainContainer);
  }

  // enforceFitZoom is wired to window 'resize' rather than the ResizeObserver
  // because applyPageZoom changes the wrapper dimensions, which would re-fire
  // the ResizeObserver and cause a cascade.

  initialized = true;

  // Initial setup
  applyPageZoom(Math.min(pageZoom, fitZoomStep()));
  scheduleLayout();
  checkCompactMode();
  checkGridModeLevelVisibility();
}
