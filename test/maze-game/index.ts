/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Maze game with keyboard navigation support.
 * Simple maze game adapted from blockly-games.
 */

declare const __BUILD_SHA__: string;
(document.getElementById('build-sha') as HTMLElement).textContent = __BUILD_SHA__;

// Suppress "ResizeObserver loop limit exceeded" — a benign browser notification
// (it retries automatically next frame) that webpack-dev-server's overlay mishandles
// because the global error event has no .error object, only a message string.
window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation();
  }
}, true);

import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {KeyboardNavigation, TriggerMode} from '../../src/index';
import {registerFlyoutCursor} from '../../src/flyout_cursor';
import {registerNavigationDeferringToolbox} from '../../src/navigation_deferring_toolbox';
import {registerMazeBlocks, setCurrentSkin} from './blocks';
import {MazeGame, getMaxBlocksForLevel, getStageForLevel, getFirstLevelIndexForStage, getLevelsForStage, getLevelConfig, STAGES, CODING_LEVELS, GRID_STAGES, getGridStageConfig, type ResultType, type GridStageConfig} from './maze';
import {loadMessages, getBrowserLocale, msg, type SupportedLocale} from './messages';
import {ImmediateModeController} from './immediate-mode';
import {GridCodingModeController} from './grid-coding-mode';
import {SwitchScanController, type HeaderDropdownSource} from './switch-scan-mode';
import {SwitchScanSettings} from './switch-scan-settings';
import {SwitchScanTts} from './switch-scan-tts';
import {PaddingControlsManager} from './padding-controls';
import {Dialog, AutoCloseDialog} from './dialogs';
import {launchConfetti} from './confetti';
import {MODE_SPECS, getCurrentLayoutMode, initLayout, scheduleLayout} from './layout';

// ========== URL PARAMETER UTILITIES ==========

/**
 * Get a string parameter from the URL, or return a default value.
 */
function getStringParamFromUrl(name: string, defaultValue: string): string {
  const val = window.location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
  return val ? decodeURIComponent(val[1].replace(/\+/g, '%20')) : defaultValue;
}

/**
 * Get an integer parameter from the URL, clamped to min/max bounds.
 */
function getIntegerParamFromUrl(name: string, minValue: number, maxValue: number): number {
  const val = Math.floor(Number(getStringParamFromUrl(name, 'NaN')));
  return isNaN(val) ? minValue : Math.max(minValue, Math.min(val, maxValue));
}

// Execution modes
type ExecutionMode = 'practice' | 'coding';

/**
 * Get the execution mode from URL parameter or localStorage.
 * URL parameter takes precedence over localStorage.
 * Accepts 'practice' or 'practise' (British spelling) for practice mode, 'coding' for coding mode.
 */
function getInitialExecutionMode(): ExecutionMode {
  const urlMode = getStringParamFromUrl('mode', '');
  // Accept both "practice" and "practise" (British spelling)
  if (urlMode === 'practice' || urlMode === 'practise') {
    return 'practice';
  }
  if (urlMode === 'coding') {
    return 'coding';
  }

  // Fall back to localStorage
  const savedMode = localStorage.getItem('mazeExecutionMode') as ExecutionMode;
  if (savedMode === 'practice' || savedMode === 'coding') {
    return savedMode;
  }

  // Default to coding mode
  return 'coding';
}

// Current execution mode (practice = direct control, coding = Blockly programming)
let currentExecutionMode: ExecutionMode = getInitialExecutionMode();

// Grid mode flag (active when grid=1 URL param AND mode=practice)
// Used inside Grid 3 AAC software where all interaction comes via keyboard from a gridset
const isGridMode = getStringParamFromUrl('grid', '0') === '1' && getInitialExecutionMode() === 'practice';

// Grid coding mode flag (active when grid=1 URL param AND mode=coding)
// Keyboard commands insert blocks AND execute immediately
const isGridCodingMode = getStringParamFromUrl('grid', '0') === '1' && getInitialExecutionMode() === 'coding';

// Switch-scan input mode (Phase 1 scaffold).
// Activated by ?inputMode=switch-scan. Mutually exclusive with grid coding mode.
// Key bindings use KeyboardEvent.key values: ' ' (Space) and 'Enter' by default.
// See PLAN_switch_scanning.md for the full design.
const inputMode = getStringParamFromUrl('inputMode', '');
const isSwitchScanMode = inputMode === 'switch-scan';

// ========== SWITCH SCAN SETTINGS RESOLUTION (Phase 2 Step C) ==========
// localStorage keys for persisted switch-scan settings. The `mazeSwitchScan.`
// prefix matches PLAN_switch_scanning.md lines 189-190. Values are stored as
// raw KeyboardEvent.key strings (so Space is the literal " ", not "Space");
// SwitchScanController.normalizeKey() still handles the friendly URL alias.
const SWITCH_SCAN_LS_KEYS = {
  advance: 'mazeSwitchScan.switchAdvance',
  select: 'mazeSwitchScan.switchSelect',
  mode: 'mazeSwitchScan.mode',
  // Phase 5: TTS on/off. Stored as the literal string 'on' / 'off'
  // so the resolver helper can compare without parsing.
  audio: 'mazeSwitchScan.audio',
  // Phase 4: auto-scan period in ms. Stored as a string ("1500") so the
  // resolveSwitchScanSetting helper can reuse its string-typed plumbing;
  // parsing / clamping happens at the call site.
  scanSpeedMs: 'mazeSwitchScan.scanSpeedMs',
} as const;

// Phase 4 — auto-scan timing bounds. Match the slider's `min`/`max`/
// `step` in `index.html` so a hand-edited URL or stale localStorage
// can't push the timer to an unusably fast (<500ms) or slow (>4s) period.
const SCAN_SPEED_MIN_MS = 500;
const SCAN_SPEED_MAX_MS = 4000;
const SCAN_SPEED_DEFAULT_MS = 1500;

type SwitchScanModeValue = 'step' | 'auto';

/**
 * Resolve a switch-scan setting using URL > localStorage > default
 * precedence. Pulled out so all three settings (advance key, select
 * key, mode) share the same resolution rule and so a unit test or
 * future caller can hit it directly.
 *
 * The URL value, if present, wins outright — we don't normalize or
 * validate it here; the controller's normalizeKey() handles the
 * Space alias and the rest is passed through verbatim.
 *
 * @param urlParam URL query-string parameter name (e.g. 'switchAdvance').
 * @param lsKey    localStorage key (e.g. 'mazeSwitchScan.switchAdvance').
 * @param defaultValue Fallback when neither source has a value.
 */
function resolveSwitchScanSetting(
  urlParam: string,
  lsKey: string,
  defaultValue: string,
): string {
  // URL wins.
  const urlVal = getStringParamFromUrl(urlParam, '');
  if (urlVal !== '') return urlVal;

  // Else localStorage. An empty string in storage is treated as
  // "not set" — the setter never writes an empty value, so this is
  // either a corrupted/manual entry or genuinely missing.
  try {
    const lsVal = window.localStorage?.getItem(lsKey);
    if (lsVal !== null && lsVal !== '') return lsVal;
  } catch (e) {
    // Storage access can throw in SecurityError contexts — fall through.
  }

  return defaultValue;
}

// Whether any switch-scan URL param is currently in effect. Drives the
// "URL settings active" note in the settings modal so users understand
// why a Save doesn't show up after reload while ?switchAdvance=… is
// still in the URL.
const switchScanUrlOverrideActive =
  getStringParamFromUrl('switchAdvance', '') !== '' ||
  getStringParamFromUrl('switchSelect', '') !== '' ||
  getStringParamFromUrl('scanMode', '') !== '' ||
  // Phase 5: scanAudio joins the URL-override family so the modal's
  // "URL settings active" note appears whenever audio is being forced.
  getStringParamFromUrl('scanAudio', '') !== '' ||
  // Phase 4: scanSpeedMs joins the family for the same reason — a
  // ?scanSpeedMs=… URL override should surface the "URL settings active"
  // note so the user understands why their saved value isn't winning.
  getStringParamFromUrl('scanSpeedMs', '') !== '';

const switchAdvanceKey = resolveSwitchScanSetting(
  'switchAdvance',
  SWITCH_SCAN_LS_KEYS.advance,
  ' ',
);
const switchSelectKey = resolveSwitchScanSetting(
  'switchSelect',
  SWITCH_SCAN_LS_KEYS.select,
  'Enter',
);
const switchScanInitialMode: SwitchScanModeValue = (() => {
  const v = resolveSwitchScanSetting(
    'scanMode',
    SWITCH_SCAN_LS_KEYS.mode,
    'step',
  );
  return v === 'auto' ? 'auto' : 'step';
})();

// Phase 5 TTS — resolve `?scanAudio=on/off` > localStorage > 'off'.
// Stored as string ('on' / 'off') so the same resolver helper works;
// converted to boolean here for the controller / settings interface.
// Default is intentionally OFF (design doc lines 223-235): switch
// users with audio off should see ZERO change from non-TTS builds.
const switchScanInitialAudio: boolean = (() => {
  const v = resolveSwitchScanSetting(
    'scanAudio',
    SWITCH_SCAN_LS_KEYS.audio,
    'off',
  );
  return v === 'on';
})();

// Phase 4 — resolve `?scanSpeedMs=…` > localStorage > 1500.
// Stored as a string for resolver consistency; parseInt + NaN fallback +
// clamp to the slider's [SCAN_SPEED_MIN_MS, SCAN_SPEED_MAX_MS] range
// keeps a corrupted LS entry or hand-edited URL from producing a runaway
// (sub-100ms) or stalled (multi-second) timer.
const switchScanInitialScanSpeedMs: number = (() => {
  const v = resolveSwitchScanSetting(
    'scanSpeedMs',
    SWITCH_SCAN_LS_KEYS.scanSpeedMs,
    String(SCAN_SPEED_DEFAULT_MS),
  );
  const parsed = parseInt(v, 10);
  if (!Number.isFinite(parsed)) return SCAN_SPEED_DEFAULT_MS;
  return Math.min(
    SCAN_SPEED_MAX_MS,
    Math.max(SCAN_SPEED_MIN_MS, parsed),
  );
})();

// Current grid stage (1 = immediate execution, 2 = delayed execution)
// Only used when isGridCodingMode is true
let currentGridStage = getIntegerParamFromUrl('stage', 1, GRID_STAGES.length);

/**
 * Get the current grid stage configuration.
 * @returns The grid stage config for the current grid stage
 */
function getCurrentGridStageConfig(): GridStageConfig {
  return getGridStageConfig(currentGridStage) || GRID_STAGES[0];
}

// Level transition lock - declared early to avoid temporal dead zone issues
let isTransitioning = false;

// Initialize locale (URL param > localStorage > browser detection)
const urlLang = getStringParamFromUrl('lang', '');
let currentLocale: SupportedLocale =
  (urlLang === 'en' || urlLang === 'fr') ? urlLang :
  (localStorage.getItem('mazeGameLocale') as SupportedLocale) || getBrowserLocale();

// Load internationalized messages
loadMessages(currentLocale);

// Override help prompt to focus on field navigation instead of general help
Blockly.Msg['HELP_PROMPT'] = 'Press → to move to block fields';

// Register maze-specific blocks
registerMazeBlocks();

// ========== PROGRAM STORAGE ==========
// Storage key format: "mazeProgram" + level number

const PROGRAM_STORAGE_PREFIX = 'mazeProgram';

// The workspace position the block stack is always anchored to after a drag.
// Keeps the stack at a consistent, predictable location in both grid coding
// mode and regular coding mode. Values chosen to give comfortable padding from
// the top-left of the visible canvas area.
const STACK_ANCHOR_X = 25;
const STACK_ANCHOR_Y = 60;

/**
 * Save the current workspace program to localStorage for a specific level.
 * Only used in coding mode.
 * @param level The level number to save the program for.
 * @param workspaceRef The Blockly workspace to save from.
 */
function saveProgram(level: number, workspaceRef: Blockly.WorkspaceSvg): void {
  if (!window.localStorage) return;
  const xml = Blockly.Xml.workspaceToDom(workspaceRef, true);
  // Remove x/y coordinates from single block stacks for cleaner storage
  if (workspaceRef.getTopBlocks(false).length === 1) {
    const block = xml.querySelector('block');
    if (block) {
      block.removeAttribute('x');
      block.removeAttribute('y');
    }
  }
  const text = Blockly.Xml.domToText(xml);
  try {
    window.localStorage.setItem(PROGRAM_STORAGE_PREFIX + level, text);
  } catch (e) {
    // Ignore storage errors (SecurityError, QuotaExceededError)
  }
}

/**
 * Load a saved program from localStorage for a specific level.
 * @param level The level number to load the program for.
 * @returns The saved XML string, or null if no saved program exists.
 */
function loadProgram(level: number): string | null {
  if (!window.localStorage) return null;
  try {
    return window.localStorage.getItem(PROGRAM_STORAGE_PREFIX + level);
  } catch (e) {
    return null;
  }
}

/**
 * Restore a saved program to the workspace.
 * @param savedXml The XML string to restore.
 * @param workspaceRef The Blockly workspace to restore to.
 */
function restoreProgram(savedXml: string, workspaceRef: Blockly.WorkspaceSvg): void {
  try {
    const dom = Blockly.utils.xml.textToDom(savedXml);
    Blockly.Xml.domToWorkspace(dom, workspaceRef);
    workspaceRef.scroll(0, 0);
    workspaceRef.clearUndo();
  } catch (e) {
    // If XML is corrupt, just start fresh (workspace already cleared)
  }
}

/**
 * Update all UI text elements with internationalized messages
 */
function updateUIText() {
  // Update page title
  const pageTitle = document.querySelector('h1');
  if (pageTitle) {
    pageTitle.textContent = msg('MAZE_TITLE');
  }

  // Update button text
  const runButton = document.getElementById('runButton');
  if (runButton) {
    runButton.textContent = msg('MAZE_RUN_PROGRAM');
  }

  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.textContent = msg('MAZE_RESET_PROGRAM');
  }

  const deleteBlockBtn = document.getElementById('deleteBlockBtn');
  if (deleteBlockBtn) {
    deleteBlockBtn.textContent = msg('MAZE_DELETE_BLOCK');
  }

  const clearWorkspaceBtn = document.getElementById('clearWorkspaceBtn');
  if (clearWorkspaceBtn) {
    clearWorkspaceBtn.textContent = msg('MAZE_CLEAR_WORKSPACE');
  }

  // Update stage dropdown label and options
  const stageLabel = document.getElementById('stageLabel');
  if (stageLabel) {
    stageLabel.textContent = msg('MAZE_STAGE') + ':';
  }

  const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
  if (stageDropdown) {
    // Clear existing options and repopulate with localized text
    stageDropdown.innerHTML = '';
    STAGES.forEach((stageConfig) => {
      const option = document.createElement('option');
      option.value = String(stageConfig.id);
      option.textContent = `${stageConfig.id} - ${msg(stageConfig.name)}`;
      stageDropdown.appendChild(option);
    });
  }
}

// Update UI text on load
updateUIText();

// CRITICAL: Register keyboard navigation components BEFORE Blockly injection
KeyboardNavigation.registerKeyboardNavigationStyles();
registerFlyoutCursor();
registerNavigationDeferringToolbox();

/**
 * Get the toolbox configuration for a specific level.
 * Blocks are progressively unlocked based on the stage configuration.
 *
 * Stage 1: moveForward, turn (basic sequencing)
 * Stage 2: + repeatTimes (bounded loops)
 * Stage 3: + forever (unbounded loops)
 * Stage 4: + ifColor (colored conditionals - single branch)
 * Stage 5: + ifColorElse, ifElse (if-else with both branches)
 * Stage 6: + advanced combinations
 */
function getToolboxForLevel(level: number): Blockly.utils.toolbox.ToolboxDefinition {
  const isPractice = MazeGame.isPracticeModeEnabled();
  const stage = getStageForLevel(level - 1, isPractice);
  const stageConfig = STAGES.find(s => s.id === stage) || STAGES[0];
  const levelConfig = isPractice ? null : CODING_LEVELS[level - 1];

  // Use level-specific blocks if defined, otherwise fall back to stage default
  const blocks = levelConfig?.blocks || stageConfig.blocks;

  const contents: Blockly.utils.toolbox.ToolboxItemInfo[] = [
    {kind: 'label', text: msg('MAZE_STAGE') + ' ' + stage + ': ' + msg(stageConfig.name)},
  ];

  // Add blocks based on level or stage configuration
  for (const blockType of blocks) {
    switch (blockType) {
      case 'maze_moveForward':
        contents.push({kind: 'block', type: 'maze_moveForward'});
        break;
      case 'maze_turn':
        contents.push({kind: 'block', type: 'maze_turn', fields: {DIR: 'turnLeft'}});
        contents.push({kind: 'block', type: 'maze_turn', fields: {DIR: 'turnRight'}});
        break;
      case 'maze_repeatTimes':
        contents.push({kind: 'block', type: 'maze_repeatTimes', fields: {TIMES: '5'}});
        break;
      case 'maze_forever':
        contents.push({kind: 'block', type: 'maze_forever'});
        break;
      case 'maze_ifColor':
        contents.push({kind: 'block', type: 'maze_ifColor', fields: {COLOR: 'red'}});
        // Only add blue variant for non-challenge stages
        if (stage < 6) {
          contents.push({kind: 'block', type: 'maze_ifColor', fields: {COLOR: 'blue'}});
        }
        break;
      case 'maze_ifColorElse':
        contents.push({kind: 'block', type: 'maze_ifColorElse', fields: {COLOR: 'red'}});
        break;
      case 'maze_if':
        // For first levels of Stage 5, preset to isPathLeft for easier learning
        if (level <= 19) { // First level of Stage 5
          contents.push({kind: 'block', type: 'maze_if', fields: {DIR: 'isPathLeft'}});
        } else {
          contents.push({kind: 'block', type: 'maze_if'});
        }
        break;
      case 'maze_ifElse':
        contents.push({kind: 'block', type: 'maze_ifElse'});
        break;
    }
  }

  return {kind: 'flyoutToolbox', contents};
}

// Initialize level from URL param or default to 1
// In grid coding mode, restrict to Stage 1 (Sequencing) levels only
const maxLevelForMode = isGridCodingMode
  ? getLevelsForStage(1, false).length  // Stage 1 has 5 levels (A1-A5)
  : MazeGame.getMaxLevel();

/**
 * Get the initial level from URL params.
 * level= takes precedence. If not specified, stage= can be used to load first level of that stage.
 */
function getInitialLevel(): number {
  const levelParam = getStringParamFromUrl('level', '');
  if (levelParam) {
    // level= explicitly provided, use it (clamped to valid range)
    return getIntegerParamFromUrl('level', 1, maxLevelForMode);
  }

  // No level= param, check for stage= param (for non-grid mode)
  // In grid coding mode, stage= controls grid stage, not content stage
  if (!isGridCodingMode) {
    const stageParam = getStringParamFromUrl('stage', '');
    if (stageParam) {
      const stageId = parseInt(stageParam, 10);
      if (stageId >= 1 && stageId <= STAGES.length) {
        const isPractice = currentExecutionMode === 'practice';
        const firstLevelIndex = getFirstLevelIndexForStage(stageId, isPractice);
        if (firstLevelIndex >= 0) {
          return firstLevelIndex + 1; // Convert to 1-based
        }
      }
    }
  }

  // Default to level 1
  return 1;
}

const initialLevel = getInitialLevel();
const initialMaxBlocks = getMaxBlocksForLevel(initialLevel - 1, currentExecutionMode === 'practice');

// Initialize Blockly workspace with level-specific configuration
const workspace = Blockly.inject('blocklyDiv', {
  renderer: 'zelos',
  toolbox: getToolboxForLevel(initialLevel),
  trashcan: false,
  maxBlocks: initialMaxBlocks === Infinity ? undefined : initialMaxBlocks,
  zoom: {
    controls: false,
    wheel: true,
    startScale: 1.2,
    maxScale: 3,
    minScale: 0.3,
    scaleSpeed: 1.2,
  },
  move: {
    scrollbars: { vertical: true, horizontal: false },
    drag: false,   // disable canvas panning by mouse drag
    wheel: true,   // keep vertical scroll wheel
  },
});

// Patch Blockly's Field.getScaledBBox to use getBoundingClientRect() for the full bounds.
// The default implementation uses offsetWidth/offsetHeight which are not affected by CSS
// transforms, causing dropdowns to open offset when page zoom != 1.
// Using getBoundingClientRect() correctly accounts for the CSS scale on #page-scale-wrapper.
{
  const origGetScaledBBox = (Blockly.Field.prototype as any).getScaledBBox;
  (Blockly.Field.prototype as any).getScaledBBox = function() {
    const clickTarget: Element | null = (this as any).getClickTarget_?.() ?? null;
    if (clickTarget) {
      const rect = clickTarget.getBoundingClientRect();
      const sx = window.pageXOffset || 0;
      const sy = window.pageYOffset || 0;
      return new Blockly.utils.Rect(
        rect.top + sy,
        rect.bottom + sy,
        rect.left + sx,
        rect.right + sx,
      );
    }
    return origGetScaledBBox.call(this);
  };
}

// Load saved program for initial level (coding mode only)
if (currentExecutionMode !== 'practice') {
  const savedXml = loadProgram(initialLevel);
  if (savedXml) {
    restoreProgram(savedXml, workspace);
  }
}

// Listen for workspace finished loading (when XML is restored)
workspace.addChangeListener((event) => {
  if (event.type === Blockly.Events.FINISHED_LOADING) {
    scheduleLayout();
  }
});

/**
 * Get the scroll X position to use in grid coding mode.
 * Returns a negative offset to compensate for the hidden flyout space,
 * which still reserves width even when hidden via CSS/JS.
 */
function getGridCodingModeScrollX(): number {
  if (!isGridCodingMode) return 0;

  const flyout = workspace.getFlyout();
  if (flyout) {
    return -flyout.getWidth();
  }
  return 0;
}

/**
 * Update the capacity bubble display based on remaining block capacity.
 */
function updateCapacityBubble() {
  const capacityBubble = document.getElementById('capacityBubble');
  if (!capacityBubble) return;

  // Hide bubble entirely in practice mode (no block limits apply)
  if (currentExecutionMode === 'practice') {
    capacityBubble.classList.add('hidden');
    return;
  }

  const currentLevel = mazeGame.getLevel();
  const maxBlocks = getMaxBlocksForLevel(currentLevel - 1, MazeGame.isPracticeModeEnabled());

  // Hide bubble if no limit
  if (maxBlocks === Infinity) {
    capacityBubble.classList.add('hidden');
    return;
  }

  const remaining = workspace.remainingCapacity();
  capacityBubble.classList.remove('hidden', 'warning', 'error');

  if (remaining <= 0) {
    capacityBubble.textContent = msg('MAZE_CAPACITY', 0);
    capacityBubble.classList.add('error');
  } else if (remaining === 1) {
    capacityBubble.textContent = msg('MAZE_CAPACITY_1', remaining);
    capacityBubble.classList.add('warning');
  } else if (remaining <= 2) {
    capacityBubble.textContent = msg('MAZE_CAPACITY', remaining);
    capacityBubble.classList.add('warning');
  } else {
    capacityBubble.textContent = msg('MAZE_CAPACITY', remaining);
  }
}

// Listen for workspace changes to update capacity
workspace.addChangeListener((event) => {
  if (event.type === Blockly.Events.BLOCK_CREATE ||
      event.type === Blockly.Events.BLOCK_DELETE ||
      event.type === Blockly.Events.BLOCK_MOVE) {
    updateCapacityBubble();
  }
});

// Reset scroll when workspace becomes empty or the very first block is added.
// This ensures blocks appear at a predictable location for assistive tech users.
// NOTE: topBlocks.length is always 1 in the maze (single connected stack is enforced),
// so we track wasEmpty to distinguish "first block ever added" from "block added to stack".
let workspaceWasEmpty = true;
workspace.addChangeListener((event) => {
  if (event.type !== Blockly.Events.BLOCK_CREATE &&
      event.type !== Blockly.Events.BLOCK_DELETE) {
    return;
  }

  const topBlocks = workspace.getTopBlocks(false);
  const isEmpty = topBlocks.length === 0;

  // If workspace just became empty, reset scroll and record empty state.
  if (isEmpty) {
    workspace.scroll(getGridCodingModeScrollX(), 0);
    workspaceWasEmpty = true;
    return;
  }

  // If the first block was just added from an empty workspace, reset scroll.
  if (event.type === Blockly.Events.BLOCK_CREATE && workspaceWasEmpty) {
    workspace.scroll(getGridCodingModeScrollX(), 0);
    workspaceWasEmpty = false;
  }
});

// Enforce: blocks must always remain in one connected stack.
// If a drag ends with >1 top-level block, the drop was invalid — undo it.
// If a drag ends with 1 top-level block, snap it back to the preferred position.
// This handles two cases:
//   1. Dragging the top block (whole stack moves with it) — stack ends up at wrong position.
//   2. Moving the top block into the middle of the stack — a previously-child block becomes
//      the new top at an unexpected workspace coordinate.
workspace.addChangeListener((event) => {
  if (event.type === Blockly.Events.BLOCK_DRAG) {
    const dragEvent = event as Blockly.Events.BlockDrag;
    if (!dragEvent.isStart) {
      const topBlocks = workspace.getTopBlocks(false);
      if (topBlocks.length > 1) {
        // Block was dropped floating — undo the whole drag (including any heal)
        workspace.undo(false);
      } else if (topBlocks.length === 1) {
        // Snap the stack back to the preferred starting position and reset scroll,
        // so the top of the stack is always at a predictable location.
        // Applies in all modes (grid coding and regular) — the maze invariant
        // is always one connected stack, so a fixed anchor position is safe.
        const topBlock = topBlocks[0] as Blockly.BlockSvg;
        topBlock.moveTo(new Blockly.utils.Coordinate(STACK_ANCHOR_X, STACK_ANCHOR_Y));
        workspace.scroll(getGridCodingModeScrollX(), 0);
      }
    }
  }
});

/**
 * Update workspace configuration for a new level.
 * This updates both the toolbox and the maxBlocks limit.
 */
function updateWorkspaceForLevel(level: number) {
  const maxBlocks = getMaxBlocksForLevel(level - 1, MazeGame.isPracticeModeEnabled());

  // Update toolbox with level-appropriate blocks
  workspace.updateToolbox(getToolboxForLevel(level));

  // Update max blocks - need to set the option and refresh
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options = workspace.options as any;
  options.maxBlocks = maxBlocks === Infinity ? Infinity : maxBlocks;

  // Clear workspace when changing levels
  workspace.clear();
  workspace.scroll(getGridCodingModeScrollX(), 0);

  // Load saved program for this level (coding mode only, not grid coding mode)
  if (!MazeGame.isPracticeModeEnabled() && !isGridCodingMode) {
    const savedXml = loadProgram(level);
    if (savedXml) {
      restoreProgram(savedXml, workspace);
    }
  }

  // Update capacity display
  updateCapacityBubble();
}

// Initialize keyboard navigation plugin
const keyboardNavigation = new KeyboardNavigation(workspace, {
  highlightConnections: true,
});

// Configure for "click n stick" style:
// - FOCUSED_CLICK: click a focused block to enter move mode
keyboardNavigation.setTriggerMode(TriggerMode.FOCUSED_CLICK);

// Load saved block movement preferences from localStorage
type BlockMovementMode = 'both' | 'click-to-move' | 'drag';
const savedMovementMode = localStorage.getItem('mazeBlockMovementMode') as BlockMovementMode | null;
const blockMovementMode: BlockMovementMode = savedMovementMode ?? 'both';
const clickToMoveEnabled = blockMovementMode !== 'drag';
const mouseDragEnabled = blockMovementMode !== 'click-to-move';

// Load saved highlight size preference from localStorage
type HighlightSize = 'minimal' | 'medium' | 'large';
const savedHighlightSize = localStorage.getItem('mazeHighlightSize') as HighlightSize | null;
const highlightSize: HighlightSize = savedHighlightSize ?? 'large';

// Apply saved block movement preferences
keyboardNavigation.setKeepBlockOnMouse(false);
keyboardNavigation.setAllowDropOnEmptyWorkspace(false);
keyboardNavigation.setClickToMoveEnabled(clickToMoveEnabled);
keyboardNavigation.setMouseDragEnabled(mouseDragEnabled);
keyboardNavigation.setSingleBlockDragMode(true);
keyboardNavigation.setConnectionSize(highlightSize);

// Monkey-patch Blockly's BlockDragStrategy to respect single-block drag setting
// This makes the setting work for both mouse drags and keyboard drags
(Blockly.dragging.BlockDragStrategy.prototype as any).shouldHealStack = function(e: PointerEvent | undefined): boolean {
  // @ts-ignore - accessing private property
  const block = this.block;

  // If block has no previous connection, can't heal to stack (always single-block)
  if (!block.previousConnection) {
    return false;
  }

  // Single-block drag is always on; Ctrl/Cmd toggles to stack drag
  const isCtrlPressed = e?.ctrlKey || e?.metaKey || false;
  return !isCtrlPressed;
};

// Enable keyboard navigation mode from the start so focus indicators show on tab
Blockly.keyboardNavigationController.setIsActive(true);

// ========== MOVE MODE HINTS ==========

// Track hint display (resets on page refresh)
let clickConnectionHintShown = false;
let keyboardMoveHintShown = false;

/**
 * Check if a block has any valid connection targets on the workspace.
 * @param block The block to check for valid connections.
 * @returns True if there are valid connections, false otherwise.
 */
function hasValidConnections(block: Blockly.BlockSvg): boolean {
  // Get connections from the moving block
  const localConnections = block.getConnections_(false);
  if (localConnections.length === 0) {
    return false;
  }

  // Get all connections on the workspace (excluding the moving block and its descendants)
  const movingDescendants = block.getDescendants(true);
  const allWorkspaceConnections = workspace
    .getAllBlocks(false)
    .filter((b) => !movingDescendants.includes(b as Blockly.BlockSvg))
    .flatMap((b) => b.getConnections_(false));

  // Check if any local connection can connect to any workspace connection
  const connectionChecker = workspace.connectionChecker;

  for (const localConn of localConnections) {
    for (const workspaceConn of allWorkspaceConnections) {
      // Skip insertion markers
      const sourceBlock = workspaceConn.getSourceBlock();
      if (!sourceBlock || sourceBlock.isInsertionMarker()) continue;

      // Only check where the moving block can attach TO other blocks
      const isValidDirection =
        (localConn.type === Blockly.ConnectionType.OUTPUT_VALUE &&
          workspaceConn.type === Blockly.ConnectionType.INPUT_VALUE) ||
        (localConn.type === Blockly.ConnectionType.PREVIOUS_STATEMENT &&
          workspaceConn.type === Blockly.ConnectionType.NEXT_STATEMENT) ||
        (localConn.type === Blockly.ConnectionType.NEXT_STATEMENT &&
          workspaceConn.type === Blockly.ConnectionType.PREVIOUS_STATEMENT);

      if (!isValidDirection) continue;

      // Check type compatibility
      if (connectionChecker.canConnect(localConn, workspaceConn, true, Infinity)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Show a hint when entering move mode via click.
 * Shown once per page load.
 */
function showClickMoveModeHint(block: Blockly.BlockSvg) {
  // Show connection hint (once)
  if (clickConnectionHintShown) return;
  clickConnectionHintShown = true;
  Blockly.Toast.show(workspace, {
    message: 'Click a connection to move block there',
    id: 'maze_move_mode_hint',
  });
}

/**
 * Show a hint when entering move mode via keyboard.
 * Only shown once per page load.
 */
function showKeyboardMoveModeHint() {
  if (keyboardMoveHintShown) return;

  Blockly.Toast.show(workspace, {
    message: 'Use arrows to move block, or Esc to exit move mode',
    id: 'maze_move_mode_hint',
  });

  keyboardMoveHintShown = true;
}

// Wire up move mode hint callbacks
keyboardNavigation.setOnStickyModeEnterCallback((block) => {
  showClickMoveModeHint(block);
});

keyboardNavigation.setOnKeyboardMoveCallback(() => {
  showKeyboardMoveModeHint();
});

// Dismiss toast when move mode exits
keyboardNavigation.setOnStickyModeExitCallback(() => {
  Blockly.Toast.hide(workspace, 'maze_move_mode_hint');
});

keyboardNavigation.setOnMoveFinishedCallback(() => {
  Blockly.Toast.hide(workspace, 'maze_move_mode_hint');
});

// Initialize maze game (URL param > localStorage > default)
const urlSkin = getIntegerParamFromUrl('skin', -1, 3);
const savedSkin = urlSkin >= 0 ? urlSkin : parseInt(localStorage.getItem('mazeGameSkin') || '0', 10);
setCurrentSkin(savedSkin, workspace); // Set initial skin for block icons

// Set up practice mazes if starting in practice mode
// This must be done BEFORE creating MazeGame so it uses the correct maze set
MazeGame.setPracticeModeEnabled(currentExecutionMode === 'practice');

const mazeGame = new MazeGame('mazeCanvas', initialLevel, savedSkin);

// ========== SOUND MUTE STATE ==========

// Load saved sound preference from localStorage (default: enabled)
const savedSoundEnabled = localStorage.getItem('mazeSoundEnabled');
let soundEnabled = savedSoundEnabled !== 'false'; // Default to true if not set

// Apply saved sound state to maze game
mazeGame.setSoundEnabled(soundEnabled);

// Initialize mute button UI state
const muteButton = document.getElementById('muteButton');

/**
 * Update the mute button UI to reflect current sound state.
 */
function updateMuteButtonUI(): void {
  if (!muteButton) return;

  if (soundEnabled) {
    muteButton.classList.remove('muted');
    muteButton.setAttribute('aria-pressed', 'false');
    muteButton.setAttribute('aria-label', msg('MAZE_UNMUTE') || 'Mute sound');
  } else {
    muteButton.classList.add('muted');
    muteButton.setAttribute('aria-pressed', 'true');
    muteButton.setAttribute('aria-label', msg('MAZE_MUTE') || 'Unmute sound');
  }
}

/**
 * Toggle sound on/off and persist the setting.
 */
function toggleSound(): void {
  soundEnabled = !soundEnabled;
  mazeGame.setSoundEnabled(soundEnabled);
  localStorage.setItem('mazeSoundEnabled', String(soundEnabled));
  updateMuteButtonUI();
}

// Initialize mute button UI
updateMuteButtonUI();

// Wire up mute button click handler
muteButton?.addEventListener('click', toggleSound);

// ========== URL STATE MANAGEMENT ==========

/**
 * Build a URL with current game state parameters.
 * Preserves any URL parameters we don't explicitly manage (like grid, stage, etc.)
 */
function buildGameUrl(overrides: {level?: number, skin?: number, lang?: string, mode?: string} = {}): string {
  // Start with current URL params to preserve any we don't explicitly manage
  const params = new URLSearchParams(window.location.search);

  // Update managed parameters
  params.set('lang', overrides.lang ?? currentLocale);
  params.set('level', String(overrides.level ?? mazeGame.getLevel()));
  params.set('skin', String(overrides.skin ?? mazeGame.getSkin()));

  // Handle mode parameter
  const mode = overrides.mode ?? currentExecutionMode;
  if (mode === 'coding') {
    params.delete('mode'); // coding is the default, don't need it in URL
  } else {
    params.set('mode', mode);
  }

  return location.pathname + '?' + params.toString();
}

/**
 * Update URL to reflect current game state without page reload.
 */
function updateUrlState() {
  history.replaceState(null, '', buildGameUrl());
}

// Initialize immediate mode controller for direct control in early levels
const immediateModeController = new ImmediateModeController(
  'immediateModePanel',
  mazeGame
);

// Initialize Grid coding mode controller (only created if in Grid coding mode).
// Mutually exclusive with switch-scan mode — don't instantiate both.
let gridCodingModeController: GridCodingModeController | null = null;

if (isGridCodingMode && !isSwitchScanMode) {
  gridCodingModeController = new GridCodingModeController(workspace, mazeGame);

  // Set initial execution mode based on grid stage
  const initialGridStageConfig = getCurrentGridStageConfig();
  gridCodingModeController.setImmediateExecution(initialGridStageConfig.immediateExecution);

  // Register block count callback for Grid coding mode
  gridCodingModeController.onBlockCountChange((count) => {
    const blockCountEl = document.getElementById('gridCodingBlockCount');
    if (blockCountEl) {
      blockCountEl.textContent = msg('MAZE_GRID_BLOCKS', count);
    }
  });
}

// Register instruction count callback for Grid mode
if (isGridMode) {
  immediateModeController.onInstructionCountChange((count) => {
    const instructionCountEl = document.getElementById('gridModeInstructionCount');
    if (instructionCountEl) {
      instructionCountEl.textContent = msg('MAZE_GRID_INSTRUCTIONS', count);
    }
  });
}

// Register completion callback for immediate mode
immediateModeController.onLevelComplete((success) => {
  if (success) {
    const currentLevel = mazeGame.getLevel();
    const maxLevel = MazeGame.getMaxLevel();

    if (isGridMode) {
      // Grid mode: launch confetti first, then show success dialog after delay
      launchConfetti();
      setTimeout(() => {
        showGridModeSuccess(immediateModeController.getInstructionCount());
      }, 1500);
    } else if (MazeGame.isPracticeModeEnabled() && currentLevel >= maxLevel) {
      // Check if this was the last practice level
      // Show graduation modal after a short delay
      setTimeout(() => {
        showGraduationModal();
      }, 1500);
    } else {
      // Auto-advance to next level after a short delay
      setTimeout(() => {
        goToNextLevel();
      }, 1500);
    }
  }
});

// Register completion callback for Grid coding mode
// Track if we're replaying (to skip showing success dialog again)
let isGridCodingReplay = false;

if (gridCodingModeController) {
  gridCodingModeController.onLevelComplete((success) => {
    if (success) {
      // Skip dialog on replay - just reset the flag
      if (isGridCodingReplay) {
        isGridCodingReplay = false;
        return;
      }

      const currentLevel = mazeGame.getLevel();
      // Grid coding mode supports Stage 1 levels (A1-A5)
      const maxGridCodingLevel = getLevelsForStage(1, false).length;

      // Launch confetti first
      launchConfetti();

      if (currentLevel >= maxGridCodingLevel) {
        // Last level completed - show appropriate dialog based on grid stage
        setTimeout(() => {
          // Skip if user already started running again
          if (mazeGame.isExecuting()) return;
          if (currentGridStage === 1) {
            // A1 complete - show transition to A2 dialog
            showGridCodingA1Complete();
          } else {
            // A2 complete - show final stage completion
            showGridCodingModeStageGraduation();
          }
        }, 1500);
      } else {
        // Show success message
        setTimeout(() => {
          // Skip if user already started running again
          if (mazeGame.isExecuting()) return;
          showGridCodingSuccess(gridCodingModeController!.getBlockCount());
        }, 1500);
      }
    }
  });
}

/**
 * Get the current execution mode.
 */
function getExecutionMode(): ExecutionMode {
  return currentExecutionMode;
}

/**
 * Set the execution mode and update the UI.
 * When switching modes, resets to level 1 since practice and coding have different level sets.
 */
function setExecutionMode(mode: ExecutionMode): void {
  const previousMode = currentExecutionMode;
  currentExecutionMode = mode;
  localStorage.setItem('mazeExecutionMode', mode);

  // Switch maze sets and reset to level 1 when changing modes
  const isPractice = mode === 'practice';
  if (MazeGame.isPracticeModeEnabled() !== isPractice) {
    MazeGame.setPracticeModeEnabled(isPractice);
    // Reset to level 1 when switching between practice and coding
    mazeGame.setLevel(1);
    updateWorkspaceForLevel(1);
    updateLevelDisplay();
  }

  updateModeUI();
  updateModeToggleButton();
  // Update instruction bar to show appropriate instructions for the mode
  updateInstructionBar();
  // Update URL to reflect mode change
  updateUrlState();
  // Update padding controls visibility based on mode
  paddingManager?.setMode(false, false); // Neither grid mode nor grid coding mode in normal toggle
}

/**
 * Toggle between practice and coding modes.
 */
function toggleExecutionMode(): void {
  const newMode = currentExecutionMode === 'practice' ? 'coding' : 'practice';
  setExecutionMode(newMode);
}

/**
 * Update the mode toggle button appearance.
 */
function updateModeToggleButton(): void {
  const modeToggle = document.getElementById('modeToggle');
  const modeLabel = document.getElementById('modeLabel');
  const modeAction = document.getElementById('modeAction');
  if (modeToggle) {
    modeToggle.classList.toggle('practice', currentExecutionMode === 'practice');
    modeToggle.classList.toggle('coding', currentExecutionMode === 'coding');
  }
  if (modeLabel) {
    modeLabel.textContent = currentExecutionMode === 'practice'
      ? msg('MAZE_MODE_PRACTICE')
      : msg('MAZE_MODE_CODING');
  }
  if (modeAction) {
    // Show what clicking will switch TO (opposite of current mode)
    modeAction.textContent = currentExecutionMode === 'practice'
      ? msg('MAZE_SWITCH_TO_CODING')
      : msg('MAZE_SWITCH_TO_PRACTICE');
  }
}

/**
 * Apply UI visibility rules for the current layout mode.
 * Reads from MODE_SPECS — add new mode behaviour there, not here.
 */
function updateModeUI(): void {
  const spec = MODE_SPECS[getCurrentLayoutMode()];

  document.getElementById('blocklyDiv')?.classList.toggle('hidden', !spec.blocklyDiv);
  document.getElementById('runButton')?.classList.toggle('hidden', !spec.runButton);
  document.getElementById('ghostRunButton')?.classList.add('hidden');     // shown by result handler only
  document.getElementById('capacityBubble')?.classList.add('hidden');     // managed by updateCapacityBubble
  document.getElementById('gridCodingControls')?.classList.toggle('hidden', !spec.gridCodingControls);

  if (spec.immediateController === 'enable') {
    immediateModeController.setMazeGame(mazeGame);
    immediateModeController.enable();
  } else {
    immediateModeController.disable();
  }

  if (spec.gridCodingController === 'enable' && gridCodingModeController) {
    gridCodingModeController.setMazeGame(mazeGame);
    gridCodingModeController.enable();
  } else {
    gridCodingModeController?.disable();
  }

  if (spec.runButton) updateCapacityBubble();

  scheduleLayout();
}

// Register block highlighting callback for code execution visualization
mazeGame.onHighlight((blockId) => {
  workspace.highlightBlock(blockId);
});

// Register execution state callback to disable/enable Run button during execution
mazeGame.onExecutionStateChange((isExecuting) => {
  const runButton = document.getElementById('runButton') as HTMLButtonElement;
  if (runButton) {
    runButton.disabled = isExecuting;
  }
  const ghostRunButton = document.getElementById('ghostRunButton') as HTMLButtonElement;
  if (ghostRunButton) {
    ghostRunButton.disabled = isExecuting;
  }
});

/**
 * Format a level number as "Level" + stage letter + level within stage (e.g., Level A1, Level B2).
 * @param level The 1-based level number
 * @param isPractice Whether we're in practice mode
 * @returns Formatted level string like "Level A1", "Level B2", etc.
 */
function formatLevelLabel(level: number, isPractice: boolean): string {
  if (isGridCodingMode) {
    // Grid coding mode: show "Level A1-1", "Level A2-3", etc.
    // All grid stages use Stage A (Sequencing) levels
    return `${msg('MAZE_LEVEL')} A${currentGridStage}-${level}`;
  }
  const stage = getStageForLevel(level - 1, isPractice);
  const stageLetter = String.fromCharCode(64 + stage); // 65 is 'A'
  const firstLevelIndex = getFirstLevelIndexForStage(stage, isPractice);
  const levelInStage = level - firstLevelIndex;
  return `${msg('MAZE_LEVEL')} ${stageLetter}${levelInStage}`;
}

/**
 * Populate the stage dropdown with letter-based options (A, B, C, etc.).
 * In grid coding mode, shows grid stages (A1, A2) instead of content stages.
 */
function populateStageDropdown(): void {
  const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
  if (!stageDropdown) return;

  // Clear existing options
  stageDropdown.innerHTML = '';

  if (isGridCodingMode) {
    // Grid coding mode: show grid stages (A1 - Guided, A2 - Challenge)
    GRID_STAGES.forEach((gridStage) => {
      const option = document.createElement('option');
      option.value = String(gridStage.id);
      const stageName = msg(gridStage.name);
      option.textContent = `A${gridStage.id} - ${stageName}`;
      stageDropdown.appendChild(option);
    });
    // Set current grid stage
    stageDropdown.value = String(currentGridStage);
  } else {
    // Normal mode: show content stages (A, B, C, etc.)
    STAGES.forEach((stage, index) => {
      const option = document.createElement('option');
      option.value = String(stage.id);
      const stageLetter = String.fromCharCode(65 + index); // A, B, C, etc.
      const stageName = msg(stage.name);
      option.textContent = `${stageLetter} - ${stageName}`;
      stageDropdown.appendChild(option);
    });
  }
}

// Update level display
function updateLevelDisplay() {
  const currentLevel = mazeGame.getLevel();
  const maxLevel = MazeGame.getMaxLevel();
  const isPractice = MazeGame.isPracticeModeEnabled();
  const stage = getStageForLevel(currentLevel - 1, isPractice);

  const levelDisplay = document.getElementById('levelDisplay');
  const prevButton = document.getElementById('prevLevel') as HTMLButtonElement;
  const nextButton = document.getElementById('nextLevel') as HTMLButtonElement;
  const stageSelector = document.getElementById('stageSelector');
  const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;

  // Show level display as A1, A2, B1, etc.
  if (levelDisplay) {
    levelDisplay.textContent = formatLevelLabel(currentLevel, isPractice);
  }

  // Update stage dropdown
  if (stageSelector) {
    // Hide stage selector in practice mode (non-grid)
    if (isPractice && !isGridCodingMode) {
      stageSelector.classList.add('hidden');
    } else {
      stageSelector.classList.remove('hidden');
    }
  }

  // Sync stage dropdown with current level/grid stage
  if (stageDropdown) {
    if (isGridCodingMode) {
      // Grid coding mode: sync with current grid stage
      stageDropdown.value = String(currentGridStage);
    } else if (!isPractice) {
      // Normal coding mode: sync with content stage
      stageDropdown.value = String(stage);
    }
  }

  if (prevButton) {
    prevButton.disabled = currentLevel <= 1;
  }

  if (nextButton) {
    // In practice mode, keep enabled on last level to show graduation modal
    nextButton.disabled = currentLevel >= maxLevel && !MazeGame.isPracticeModeEnabled();
  }

  // Update level instruction based on current level
  updateLevelInstruction(currentLevel);
}

/**
 * Update the level instruction text based on the current level.
 */
function updateLevelInstruction(level: number) {
  const instructionEl = document.getElementById('levelInstruction');
  if (instructionEl) {
    const instructionKey = `MAZE_INSTRUCTION_${level}`;
    const instruction = msg(instructionKey);
    // Only show if we have a valid instruction (not just the key back)
    if (instruction !== instructionKey) {
      instructionEl.textContent = instruction;
    } else {
      // Fallback to a generic instruction
      instructionEl.textContent = msg('MAZE_INSTRUCTION_1');
    }
  }
}

// Previous level button handler (uses shared function, resetHintState called there)
document.getElementById('prevLevel')?.addEventListener('click', goToPreviousLevel);

// Next level button handler (uses shared function, resetHintState called there)
document.getElementById('nextLevel')?.addEventListener('click', goToNextLevel);

// Stage dropdown handler - navigate to first level of selected stage
document.getElementById('stageDropdown')?.addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement;
  const selectedId = parseInt(select.value, 10);

  if (isGridCodingMode) {
    // Grid coding mode: switching between grid stages (immediate/delayed)
    const gridStageConfig = getGridStageConfig(selectedId);
    if (gridStageConfig) {
      currentGridStage = selectedId;
      // Re-enable controller with new execution mode
      if (gridCodingModeController) {
        gridCodingModeController.setImmediateExecution(gridStageConfig.immediateExecution);
        // Reset to level 1 and clear workspace
        performLevelTransition(1, true, true);
      }
    }
  } else {
    // Normal mode: navigate to first level of selected content stage
    const isPractice = MazeGame.isPracticeModeEnabled();
    const firstLevelIndex = getFirstLevelIndexForStage(selectedId, isPractice);

    if (firstLevelIndex >= 0) {
      // Convert to 1-based level number
      const newLevel = firstLevelIndex + 1;

      // Use performLevelTransition with showStageIntro=true
      // This will show the stage intro dialog if stage changes
      performLevelTransition(newLevel, true, true);
    }
  }
});

// Setup the Pegman button and menu
const pegmanButton = document.getElementById('pegmanButton');
const pegmanImg = pegmanButton?.querySelector('img');
const pegmanMenu = document.getElementById('pegmanMenu');
const skins = MazeGame.getSkins();

// Set initial character sprite in button
if (pegmanImg) {
  pegmanImg.src = skins[savedSkin].sprite;
}

// Initialize Christmas theme if Rudolph was saved as preferred skin
// (RUDOLPH_SKIN_ID will be 4 - index of Rudolph in SKINS array)
if (savedSkin === 4) {
  // Defer to ensure DOM is ready
  setTimeout(() => setChristmasTheme(true), 100);
}

// Skins that are enabled in the character selector
// To re-enable hidden characters, add their indices back:
// 4=Rudolph, 5=Football Chase, 6=Football Dribble
const ENABLED_SKIN_IDS = [0, 1, 2, 3]; // Astro, Wheelchair, Panda, Pegman

// Build the character menu (only show enabled skins)
if (pegmanMenu) {
  ENABLED_SKIN_IDS.forEach((skinId) => {
    const skin = skins[skinId];
    const div = document.createElement('div');
    const img = document.createElement('img');
    img.src = skin.sprite;
    div.appendChild(img);
    pegmanMenu.appendChild(div);

    div.addEventListener('click', () => {
      changePegman(skinId);
    });
  });
}

// Christmas theme constants
const RUDOLPH_SKIN_ID = 4; // Index of Rudolph in SKINS array
let snowflakesCreated = false;

/**
 * Create snowflake elements for the snow effect.
 */
function createSnowflakes() {
  if (snowflakesCreated) return;

  const snowContainer = document.getElementById('snowContainer');
  if (!snowContainer) return;

  // Clear existing snowflakes
  snowContainer.innerHTML = '';

  // Create 30 snowflakes with varied properties
  const snowflakeChars = ['❄', '❅', '❆', '•'];
  for (let i = 0; i < 30; i++) {
    const snowflake = document.createElement('div');
    snowflake.className = 'snowflake';
    snowflake.textContent = snowflakeChars[Math.floor(Math.random() * snowflakeChars.length)];

    // Random horizontal position
    snowflake.style.left = `${Math.random() * 100}%`;

    // Random size (0.5em to 1.5em)
    const size = 0.5 + Math.random() * 1;
    snowflake.style.fontSize = `${size}em`;

    // Random animation duration (5s to 15s for parallax effect)
    const duration = 5 + Math.random() * 10;
    snowflake.style.animationDuration = `${duration}s`;

    // Random delay so they don't all start at once
    snowflake.style.animationDelay = `${Math.random() * duration}s`;

    // Random opacity (0.5 to 1.0)
    snowflake.style.opacity = `${0.5 + Math.random() * 0.5}`;

    snowContainer.appendChild(snowflake);
  }

  snowflakesCreated = true;
}

/**
 * Enable or disable Christmas theme effects.
 */
function setChristmasTheme(enabled: boolean) {
  const header = document.querySelector('header');
  const snowContainer = document.getElementById('snowContainer');

  if (enabled) {
    // Enable Christmas theme
    header?.classList.add('christmas');
    if (snowContainer) {
      createSnowflakes();
      snowContainer.classList.add('active');
    }
  } else {
    // Disable Christmas theme
    header?.classList.remove('christmas');
    snowContainer?.classList.remove('active');
  }
}

// Function to change the character
function changePegman(skinId: number) {
  mazeGame.setSkin(skinId);
  localStorage.setItem('mazeGameSkin', skinId.toString());

  // Update button image
  if (pegmanImg) {
    pegmanImg.src = skins[skinId].sprite;
  }

  // Update block icons based on character
  setCurrentSkin(skinId, workspace);

  // Update immediate mode button icons
  immediateModeController.updateLabels();

  // Toggle Christmas theme based on skin
  setChristmasTheme(skinId === RUDOLPH_SKIN_ID);

  hidePegmanMenu();

  // Update URL to reflect skin change
  updateUrlState();
}

/**
 * Cycle to the next character in the enabled skins list.
 */
function cycleCharacterNext() {
  const currentSkin = mazeGame.getSkin();
  const currentIndex = ENABLED_SKIN_IDS.indexOf(currentSkin);
  const nextIndex = (currentIndex + 1) % ENABLED_SKIN_IDS.length;
  changePegman(ENABLED_SKIN_IDS[nextIndex]);
}

/**
 * Cycle to the previous character in the enabled skins list.
 */
function cycleCharacterPrevious() {
  const currentSkin = mazeGame.getSkin();
  const currentIndex = ENABLED_SKIN_IDS.indexOf(currentSkin);
  const prevIndex = (currentIndex - 1 + ENABLED_SKIN_IDS.length) % ENABLED_SKIN_IDS.length;
  changePegman(ENABLED_SKIN_IDS[prevIndex]);
}

/**
 * Cycle to the next language.
 */
function cycleLanguage() {
  const locales: SupportedLocale[] = ['en', 'fr'];
  const currentIndex = locales.indexOf(currentLocale);
  const nextIndex = (currentIndex + 1) % locales.length;
  const newLocale = locales[nextIndex];
  localStorage.setItem('mazeGameLocale', newLocale);
  location.href = buildGameUrl({lang: newLocale});
}

// Show pegman menu on button click
if (pegmanButton) {
  pegmanButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pegmanMenu) {
      if (pegmanMenu.style.display === 'block') {
        hidePegmanMenu();
      } else {
        showPegmanMenu();
      }
    }
  });
}

// Show menu function
function showPegmanMenu() {
  if (!pegmanButton || !pegmanMenu) return;

  pegmanButton.classList.add('buttonHover');
  const rect = pegmanButton.getBoundingClientRect();
  pegmanMenu.style.top = `${rect.bottom + 5}px`;
  pegmanMenu.style.left = `${rect.left}px`;
  pegmanMenu.style.display = 'block';

  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', hidePegmanMenu);
  }, 0);
}

// Hide menu function
function hidePegmanMenu() {
  if (!pegmanMenu || !pegmanButton) return;

  pegmanMenu.style.display = 'none';
  pegmanButton.classList.remove('buttonHover');
  document.removeEventListener('click', hidePegmanMenu);
}

// Hide menu on window resize
window.addEventListener('resize', hidePegmanMenu);

/**
 * Run the program - shared by main button, fullscreen button, and keyboard shortcuts.
 */
function runProgram() {
  if (mazeGame.isExecuting()) return;

  // In grid coding mode, dismiss success modal if visible and replay
  if (isGridCodingMode) {
    const resultModal = document.getElementById('resultModal') as HTMLDialogElement | null;
    if (resultModal && resultModal.open) {
      hideGridCodingSuccess(false);
      isGridCodingReplay = true;
    }
  }

  executeProgram();
}

function setGhostRunButtonVisible(visible: boolean): void {
  const btn = document.getElementById('ghostRunButton');
  if (visible) {
    btn?.classList.remove('hidden');
  } else {
    btn?.classList.add('hidden');
  }
}

/**
 * Ghost run - execute program ignoring wall collisions, to let users see
 * whether their overall logic is correct even if directions need fixing.
 */
function runGhostProgram() {
  executeProgram({ ghostRun: true });
}

function executeProgram(options?: { ghostRun?: boolean }): void {
  if (mazeGame.isExecuting()) return;
  setGhostRunButtonVisible(false);
  hasRun = true;
  hideHint();
  const code = javascriptGenerator.workspaceToCode(workspace);
  mazeGame.execute(code, options);
}

/**
 * Reset the maze - shared by main button and fullscreen button.
 */
function resetProgram() {
  setGhostRunButtonVisible(false);
  mazeGame.reset();
}

// Run button handler
document.getElementById('runButton')?.addEventListener('click', runProgram);

// Ghost Run button handler
document.getElementById('ghostRunButton')?.addEventListener('click', runGhostProgram);

// Reset button handler
document.getElementById('resetButton')?.addEventListener('click', resetProgram);

// Delete focused block button handler
// Prevent mousedown from stealing focus away from the workspace/block
document.getElementById('deleteBlockBtn')?.addEventListener('mousedown', (e) => {
  e.preventDefault();
});
document.getElementById('deleteBlockBtn')?.addEventListener('click', () => {
  const node = Blockly.getFocusManager().getFocusedNode();
  if (node instanceof Blockly.BlockSvg) {
    node.dispose(true);
  }
});

// Clear workspace button handler
document.getElementById('clearWorkspaceBtn')?.addEventListener('click', () => {
  workspace.clear();
  workspace.scroll(getGridCodingModeScrollX(), 0);
  mazeGame.reset();
  // Save empty program in coding mode (but not grid coding mode)
  if (!MazeGame.isPracticeModeEnabled() && !isGridCodingMode) {
    saveProgram(mazeGame.getLevel(), workspace);
  }
});

// Populate stage dropdown with letter-based options
populateStageDropdown();

// Initial level display update
updateLevelDisplay();

// Initialize padding controls manager for eye gaze accessibility
const paddingManager = new PaddingControlsManager({
  isGridMode,
  isGridCodingMode
});
paddingManager.init();

// Initialize layout pipeline (queries DOM, wires resize/zoom events, applies initial zoom).
// Must be called before updateModeUI() so getCurrentLayoutMode() has valid deps.
initLayout({
  workspace,
  redraw: () => mazeGame.redraw(),
  isGridMode,
  isGridCodingMode,
  getExecutionMode: () => currentExecutionMode,
});

// Initialize execution mode UI based on URL param or saved preference
updateModeUI();
updateModeToggleButton();

// Wire up mode toggle button
document.getElementById('modeToggle')?.addEventListener('click', toggleExecutionMode);

// Language selector handler
const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement;
if (languageSelect) {
  // Set the current language in the dropdown
  languageSelect.value = currentLocale;

  languageSelect.addEventListener('change', () => {
    const newLocale = languageSelect.value as SupportedLocale;

    // Save preference
    localStorage.setItem('mazeGameLocale', newLocale);

    // Navigate with all params preserved (page reload required for Blockly to re-register blocks)
    location.href = buildGameUrl({lang: newLocale});
  });
}

// ========== INSTRUCTION BAR SYSTEM ==========

/**
 * Display modes for the instruction bar.
 * - 'both': Show instructions and hints
 * - 'instructions': Show only level instructions
 * - 'none': Hide the instruction bar completely
 */
type DisplayMode = 'both' | 'instructions' | 'none';

// Load saved display mode or default to 'both'
let displayMode: DisplayMode =
  (localStorage.getItem('mazeDisplayMode') as DisplayMode) || 'both';

/**
 * Cycle through display modes: both -> instructions -> none -> both
 */
function cycleDisplayMode() {
  const modes: DisplayMode[] = ['both', 'instructions', 'none'];
  const currentIndex = modes.indexOf(displayMode);
  displayMode = modes[(currentIndex + 1) % modes.length];
  localStorage.setItem('mazeDisplayMode', displayMode);
  updateInstructionBar();
}

/**
 * Update the instruction bar based on current display mode and level.
 */
function updateInstructionBar() {
  const instructionBar = document.getElementById('instructionBar');
  const levelInstruction = document.getElementById('levelInstruction');
  const contextualHint = document.getElementById('contextualHint');

  if (!instructionBar || !levelInstruction) return;

  // Handle 'none' mode - hide the bar
  if (displayMode === 'none') {
    instructionBar.classList.add('hidden');
    return;
  }

  // Show the bar
  instructionBar.classList.remove('hidden');

  // Update level instruction
  const level = mazeGame.getLevel();
  // Practice mode (including grid mode) uses a single fixed instruction for all levels
  if (currentExecutionMode === 'practice') {
    levelInstruction.textContent = msg('MAZE_PRACTICE_INSTRUCTION');
  } else {
    // Coding mode - use instruction from level config if available, fall back to MAZE_INSTRUCTION_N
    const levelConfig = getLevelConfig(level - 1, false);
    if (levelConfig?.instruction) {
      levelInstruction.textContent = msg(levelConfig.instruction);
    } else {
      levelInstruction.textContent = msg(`MAZE_INSTRUCTION_${level}`);
    }
  }

  // Clear hints when instruction bar updates
  if (contextualHint) {
    contextualHint.textContent = '';
  }
}

/**
 * Update the contextual hint appended to the instruction.
 */
function updateContextualHint(hintKey: string | null) {
  const contextualHint = document.getElementById('contextualHint');
  if (!contextualHint) return;

  // Don't show hints if display mode is not 'both'
  if (displayMode !== 'both') {
    contextualHint.textContent = '';
    return;
  }

  // Append hint to instruction
  if (hintKey) {
    contextualHint.textContent = ' ' + msg(hintKey);
  } else {
    contextualHint.textContent = '';
  }
}

// ========== HINT SYSTEM ==========

// Track execution state for hints
let hasRun = false;
let lastResult: 'success' | 'failure' | 'error' | 'none' = 'none';
let hintTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a hint in the instruction bar.
 */
function showHint(messageKey: string) {
  updateContextualHint(messageKey);
}

/**
 * Hide the contextual hint.
 */
function hideHint() {
  updateContextualHint(null);
  if (hintTimeout) {
    clearTimeout(hintTimeout);
    hintTimeout = null;
  }
}

/**
 * Check if a specific hint should be shown based on workspace state.
 * This maps hint keys to their display conditions.
 */
function shouldShowHint(
  hintKey: string,
  blocks: Blockly.Block[],
  topBlocks: Blockly.Block[],
  remaining: number,
): boolean {
  // Helper to check if a block type exists
  const hasBlockType = (type: string) => blocks.some(b => b.type === type);

  // Helper to count blocks in a loop
  const getNestedBlockCount = (loopBlock: Blockly.Block): number => {
    let count = 0;
    let block = loopBlock.getInputTargetBlock('DO');
    while (block) {
      count++;
      block = block.getNextBlock();
    }
    return count;
  };

  switch (hintKey) {
    case 'MAZE_HINT_STACK':
      return blocks.length < 2;

    case 'MAZE_HINT_ONE_TOP_BLOCK':
      return topBlocks.length > 1;

    case 'MAZE_HINT_RUN':
      return !hasRun;

    case 'MAZE_HINT_RESET':
      return hasRun && lastResult === 'failure';

    case 'MAZE_HINT_REPEAT':
      return !hasBlockType('maze_forever') && remaining > 0;

    case 'MAZE_HINT_CAPACITY':
      return remaining === 0;

    case 'MAZE_HINT_REPEAT_MANY': {
      const foreverBlock = blocks.find(b => b.type === 'maze_forever');
      return foreverBlock ? getNestedBlockCount(foreverBlock) < 2 : false;
    }

    case 'MAZE_HINT_IF':
      return !hasBlockType('maze_if');

    case 'MAZE_HINT_MENU': {
      const ifBlock = blocks.find(b => b.type === 'maze_if');
      if (ifBlock) {
        const fieldValue = ifBlock.getFieldValue('DIR');
        return fieldValue === 'isPathForward';
      }
      return false;
    }

    case 'MAZE_HINT_IF_ELSE':
      return !hasBlockType('maze_ifElse');

    case 'MAZE_HINT_WALL_FOLLOW':
      return !localStorage.getItem('maze_level10_hint_shown');

    default:
      return false;
  }
}

/**
 * Determine which hint to show based on current level and workspace state.
 * Uses level-defined hints when available, falls back to legacy logic.
 */
function levelHelp() {
  // Don't show hints in practice mode - only show the single practice instruction
  if (currentExecutionMode === 'practice') return;

  // Don't show hints while executing
  if (mazeGame.isExecuting()) return;

  // Don't show hints in grid modes
  if (isGridMode || isGridCodingMode) return;

  const level = mazeGame.getLevel();
  const levelConfig = getLevelConfig(level - 1, false);

  hideHint(); // Clear any existing hint

  // Schedule hint with delay to avoid showing too quickly
  hintTimeout = setTimeout(() => {
    const blocks = workspace.getAllBlocks(false);
    const topBlocks = workspace.getTopBlocks(false);
    const remaining = workspace.remainingCapacity();

    // If level has hints defined, use them
    if (levelConfig?.hints && levelConfig.hints.length > 0) {
      for (const hintKey of levelConfig.hints) {
        if (shouldShowHint(hintKey, blocks, topBlocks, remaining)) {
          // Special handling for one-time hints
          if (hintKey === 'MAZE_HINT_WALL_FOLLOW') {
            localStorage.setItem('maze_level10_hint_shown', 'true');
          }
          showHint(hintKey);
          return;
        }
      }
    }
    // No hints defined for this level or none match - that's fine
  }, 2000); // 2 second delay before showing hints
}

// Listen for maze game completion events
mazeGame.onComplete((success: boolean) => {
  lastResult = success ? 'success' : 'failure';
  // Trigger hint check after a short delay
  setTimeout(levelHelp, 500);

  // Show confetti on success
  if (success) {
    launchConfetti();
  }

  // Handle grid coding delayed mode (A2) success dialog
  // In immediate mode (A1), the dialog is shown via gridCodingModeController.onLevelComplete()
  // In delayed mode (A2), we need to show it here when the run completes
  if (isGridCodingMode && gridCodingModeController && !gridCodingModeController.isImmediateExecution() && success) {
    // Skip dialog on replay
    if (isGridCodingReplay) {
      isGridCodingReplay = false;
      return;
    }

    const currentLevel = mazeGame.getLevel();
    const maxGridCodingLevel = getLevelsForStage(1, false).length;

    setTimeout(() => {
      if (mazeGame.isExecuting()) return;
      if (currentLevel >= maxGridCodingLevel) {
        showGridCodingModeStageGraduation();
      } else {
        showGridCodingSuccess(gridCodingModeController!.getBlockCount());
      }
    }, 1500);
  }
});

// ========== RESULT MODAL ==========

const resultModal = document.getElementById('resultModal')!;
const resultModalTitle = document.getElementById('resultModalTitle')!;
const resultModalMessage = document.getElementById('resultModalMessage')!;
const resultModalCancel = document.getElementById('resultModalCancel')!;
const resultModalOk = document.getElementById('resultModalOk')!;

// Track if this is a "next level" prompt (OK advances, Cancel stays)
let isNextLevelPrompt = false;

// Auto-close durations in milliseconds
const AUTO_CLOSE_SUCCESS = 7000; // 7 seconds for success - time to decide on next level
const AUTO_CLOSE_FAILURE = 5000; // 5 seconds for failure/timeout (need to read)

// Initialize result dialog using AutoCloseDialog
const resultDialog = new AutoCloseDialog('resultModal', {
  progressBarSelector: '.ok-progress',
  focusSelector: '#resultModalOk',
  onAutoClose: () => {
    if (isNextLevelPrompt) {
      goToNextLevel();
    }
  }
});

/**
 * Show the result modal with appropriate styling and message.
 * Modal will auto-close after a countdown.
 * For success on non-final levels, shows a "next level" prompt with Cancel/OK.
 */
function showResultModal(type: ResultType): void {
  const isGhost = mazeGame.isGhostRun();

  // Set styling class (success = green accent, failure/timeout = gray)
  resultModal.className = 'result-modal ' + (type === 'success' ? 'success' : 'failure');

  // Ghost runs never advance to next level - they're informational only
  const currentLevel = mazeGame.getLevel();
  const maxLevel = MazeGame.getMaxLevel();
  isNextLevelPrompt = !isGhost && type === 'success' && currentLevel < maxLevel;

  // Set title (short phrase)
  if (isGhost) {
    resultModalTitle.textContent = msg('MAZE_GHOST_RUN_TITLE');
  } else if (type === 'success') {
    resultModalTitle.textContent = msg('MAZE_CONGRATULATIONS');
  } else if (type === 'failure') {
    resultModalTitle.textContent = msg('MAZE_FAILURE_TITLE');
  } else if (type === 'timeout') {
    resultModalTitle.textContent = msg('MAZE_TIMEOUT_TITLE');
  } else {
    resultModalTitle.textContent = msg('MAZE_ERROR_TITLE');
  }

  // Set message (detailed explanation)
  if (isGhost) {
    if (type === 'success') {
      resultModalMessage.textContent = msg('MAZE_GHOST_RUN_SUCCESS');
    } else {
      resultModalMessage.textContent = msg('MAZE_GHOST_RUN_FAILURE');
    }
  } else if (type === 'success') {
    if (isNextLevelPrompt) {
      // Not the last level - ask about next level
      resultModalMessage.textContent = msg('MAZE_NEXT_LEVEL_PROMPT');
    } else {
      // Final level completed
      resultModalMessage.textContent = msg('MAZE_ALL_LEVELS_COMPLETE');
    }
  } else if (type === 'failure') {
    resultModalMessage.textContent = msg('MAZE_FAILURE_MESSAGE');
  } else if (type === 'timeout') {
    resultModalMessage.textContent = msg('MAZE_TIMEOUT_MESSAGE');
  } else {
    resultModalMessage.textContent = msg('MAZE_ERROR_MESSAGE');
  }

  // Show/hide Cancel button based on whether this is a next level prompt
  resultModalCancel.hidden = !isNextLevelPrompt;

  // Determine auto-close duration
  const duration = type === 'success' ? AUTO_CLOSE_SUCCESS : AUTO_CLOSE_FAILURE;

  // Show dialog with auto-close
  resultDialog.show(duration);
}

// Result modal event handlers

// Cancel button - just close the modal (stay on current level)
resultModalCancel.addEventListener('click', () => resultDialog.hide());

// OK button - advance to next level if this is a next level prompt, then close
resultModalOk.addEventListener('click', () => {
  if (isNextLevelPrompt) {
    goToNextLevel();
  }
  resultDialog.hide();
});

// Keyboard shortcuts
resultModal.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    // Cancel - just close the modal
    e.preventDefault();
    resultDialog.hide();
  } else if (e.key === 'Enter') {
    // OK - advance if next level prompt, then close
    e.preventDefault();
    if (isNextLevelPrompt) {
      goToNextLevel();
    }
    resultDialog.hide();
  }
});

// Listen for maze game result events to show the modal
mazeGame.onResult((result: ResultType) => {
  // Grid coding mode has its own success handler
  if (isGridCodingMode) {
    return;
  }
  // Save program on successful completion in coding mode
  if (result === 'success' && !MazeGame.isPracticeModeEnabled()) {
    saveProgram(mazeGame.getLevel(), workspace);
  }
  // Show ghost run button after a wall crash so user can see if their logic is right
  if (result === 'error' && !mazeGame.isGhostRun()) {
    setGhostRunButtonVisible(true);
  }
  showResultModal(result);
});

// ========== GRADUATION MODAL ==========
// Shown when user completes all practice levels

const graduationModal = document.getElementById('graduationModal')!;
const graduationModalTitle = document.getElementById('graduationModalTitle')!;
const graduationModalMessage = document.getElementById('graduationModalMessage')!;
const graduationTryCoding = document.getElementById('graduationTryCoding')!;
const graduationStay = document.getElementById('graduationStay')!;

// Initialize graduation dialog
const graduationDialog = new Dialog('graduationModal', {
  focusSelector: '#graduationTryCoding',
  closeOnEscape: true,
  closeOnBackdropClick: true
});

/**
 * Show the graduation modal after completing all practice levels.
 */
function showGraduationModal(): void {
  // Set localized text
  graduationModalTitle.textContent = msg('MAZE_PRACTICE_GRADUATION_TITLE');
  graduationModalMessage.textContent = msg('MAZE_PRACTICE_GRADUATION_MESSAGE');
  graduationTryCoding.textContent = msg('MAZE_PRACTICE_TRY_CODING');
  graduationStay.textContent = msg('MAZE_PRACTICE_STAY');

  // Show dialog
  graduationDialog.show();
}

// Graduation modal event handlers
graduationTryCoding.addEventListener('click', () => {
  graduationDialog.hide();
  // Switch to coding mode (this will reset to level 1 and use coding mazes)
  setExecutionMode('coding');
  // Show Stage 1 intro since user is starting coding mode
  showStageIntroModal(1);
});

graduationStay.addEventListener('click', () => {
  graduationDialog.hide();
  // Reset to level 1 of practice mode to replay
  mazeGame.setLevel(1);
  updateLevelDisplay();
});

graduationModal.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    // Just dismiss the modal without resetting level
    graduationDialog.hide();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // Same as clicking "Try Coding Mode"
    graduationTryCoding.click();
  }
});

// ========== STAGE INTRO MODAL ==========

const stageIntroModal = document.getElementById('stageIntroModal');
const stageIntroName = document.getElementById('stageIntroName');
const stageIntroConcept = document.getElementById('stageIntroConcept');
const stageIntroOk = document.getElementById('stageIntroOk');

// Initialize stage intro dialog
const stageIntroDialog = new Dialog('stageIntroModal', {
  focusSelector: '#stageIntroOk',
  closeOnEscape: true,
  closeOnBackdropClick: true
});

/**
 * Show the stage intro modal for a given stage.
 * @param stageId The stage ID (1-6)
 */
function showStageIntroModal(stageId: number): void {
  if (!stageIntroName || !stageIntroConcept) return;

  const stageConfig = STAGES.find(s => s.id === stageId);
  if (!stageConfig) return;

  // Set localized text - just stage name as heading, no "New Stage!" title
  stageIntroName.textContent = msg('MAZE_STAGE') + ' ' + stageId + ': ' + msg(stageConfig.name);
  stageIntroConcept.textContent = msg(stageConfig.concept);

  // Show dialog
  stageIntroDialog.show();
}

// Stage intro OK button handler
if (stageIntroOk) {
  stageIntroOk.addEventListener('click', () => stageIntroDialog.hide());
}

// ========== GRID CODING INTRO MODAL ==========

const gridCodingIntroModal = document.getElementById('gridCodingIntroModal')!;
const gridCodingIntroTitle = document.getElementById('gridCodingIntroTitle')!;
const gridCodingIntroLine1 = document.getElementById('gridCodingIntroLine1')!;
const gridCodingIntroLine2 = document.getElementById('gridCodingIntroLine2')!;
const gridCodingIntroLine3 = document.getElementById('gridCodingIntroLine3')!;

// Initialize grid coding intro dialog (closes on any key or click)
const gridCodingIntroDialog = new Dialog('gridCodingIntroModal', {
  closeOnEscape: true,
  closeOnBackdropClick: true
});

/**
 * Show the grid coding intro modal.
 * Dismisses on any key press or click.
 */
function showGridCodingIntroModal(): void {
  gridCodingIntroTitle.textContent = msg('MAZE_GRID_CODING_INTRO_TITLE');
  gridCodingIntroLine1.textContent = msg('MAZE_GRID_CODING_INTRO_LINE1');
  gridCodingIntroLine2.textContent = msg('MAZE_GRID_CODING_INTRO_LINE2');
  gridCodingIntroLine3.textContent = msg('MAZE_GRID_CODING_INTRO_LINE3');

  gridCodingIntroDialog.show();
}

// Dismiss on any keydown or click inside the dialog
gridCodingIntroModal.addEventListener('keydown', (e: KeyboardEvent) => {
  e.preventDefault();
  gridCodingIntroDialog.hide();
});

gridCodingIntroModal.addEventListener('click', () => {
  gridCodingIntroDialog.hide();
});

// ========== GRID PRACTICE INTRO MODAL ==========

const gridPracticeIntroModal = document.getElementById('gridPracticeIntroModal')!;
const gridPracticeIntroTitle = document.getElementById('gridPracticeIntroTitle')!;
const gridPracticeIntroLine1 = document.getElementById('gridPracticeIntroLine1')!;
const gridPracticeIntroLine2 = document.getElementById('gridPracticeIntroLine2')!;
const gridPracticeIntroLine3 = document.getElementById('gridPracticeIntroLine3')!;

// Initialize grid practice intro dialog (closes on any key or click)
const gridPracticeIntroDialog = new Dialog('gridPracticeIntroModal', {
  closeOnEscape: true,
  closeOnBackdropClick: true
});

/**
 * Show the grid practice intro modal.
 * Dismisses on any key press or click.
 */
function showGridPracticeIntroModal(): void {
  gridPracticeIntroTitle.textContent = msg('MAZE_GRID_PRACTICE_INTRO_TITLE');
  gridPracticeIntroLine1.textContent = msg('MAZE_GRID_PRACTICE_INTRO_LINE1');
  gridPracticeIntroLine2.textContent = msg('MAZE_GRID_PRACTICE_INTRO_LINE2');
  gridPracticeIntroLine3.textContent = msg('MAZE_GRID_PRACTICE_INTRO_LINE3');

  gridPracticeIntroDialog.show();
}

// Dismiss on any keydown or click inside the dialog
gridPracticeIntroModal.addEventListener('keydown', (e: KeyboardEvent) => {
  e.preventDefault();
  gridPracticeIntroDialog.hide();
});

gridPracticeIntroModal.addEventListener('click', () => {
  gridPracticeIntroDialog.hide();
});

// ========== SHORTCUTS INFO MODAL ==========

const shortcutsModal = document.getElementById('shortcutsModal')!;
const shortcutsModalClose = document.getElementById('shortcutsModalClose')!;
const infoBtn = document.getElementById('infoBtn')!;

// Initialize shortcuts dialog using Dialog class
const shortcutsDialog = new Dialog('shortcutsModal', {
  focusSelector: '#shortcutsModalClose',
  closeOnEscape: true,
  closeOnBackdropClick: true
});

// Info button click handler
infoBtn.addEventListener('click', () => shortcutsDialog.show());

// Close button handler
shortcutsModalClose.addEventListener('click', () => shortcutsDialog.hide());

// ========== BLOCK MOVEMENT MODE DROPDOWN ==========

const blockMovementSelect = document.querySelector<HTMLSelectElement>('#blockMovementSelect')!;
blockMovementSelect.value = blockMovementMode;

const highlightSizeRow = document.getElementById('highlightSizeRow')!;
const highlightSizeSelect = document.querySelector<HTMLSelectElement>('#highlightSizeSelect')!;
highlightSizeSelect.value = highlightSize;

function updateHighlightSizeRowVisibility(mode: BlockMovementMode) {
  highlightSizeRow.style.display = mode === 'drag' ? 'none' : '';
}

updateHighlightSizeRowVisibility(blockMovementMode);

blockMovementSelect.addEventListener('change', () => {
  const mode = blockMovementSelect.value as BlockMovementMode;
  localStorage.setItem('mazeBlockMovementMode', mode);
  const ctm = mode !== 'drag';
  const drag = mode !== 'click-to-move';
  keyboardNavigation.setClickToMoveEnabled(ctm);
  keyboardNavigation.setMouseDragEnabled(drag);
  keyboardNavigation.setKeepBlockOnMouse(false);
  updateHighlightSizeRowVisibility(mode);
});

highlightSizeSelect.addEventListener('change', () => {
  const size = highlightSizeSelect.value as HighlightSize;
  localStorage.setItem('mazeHighlightSize', size);
  keyboardNavigation.setConnectionSize(size);
});

// ========== CONFIRMATION MODAL ==========

const confirmationModal = document.getElementById('confirmationModal')!;
const confirmationModalTitle = document.getElementById('confirmationModalTitle')!;
const confirmationModalMessage = document.getElementById('confirmationModalMessage')!;
const confirmationModalCancel = document.getElementById('confirmationModalCancel')!;
const confirmationModalConfirm = document.getElementById('confirmationModalConfirm')!;

// Initialize confirmation dialog
const confirmationDialog = new Dialog('confirmationModal', {
  focusSelector: '#confirmationModalConfirm',
  closeOnEscape: true,
  closeOnBackdropClick: false  // Don't close on backdrop click for confirmations
});

/**
 * Show a confirmation modal with a custom message.
 * @param title The title of the confirmation dialog
 * @param message The confirmation message
 * @param onConfirm Callback to execute if user confirms
 */
function showConfirmationModal(title: string, message: string, onConfirm: () => void): void {
  // Hide any other open modals
  if (shortcutsDialog.isOpen()) {
    shortcutsDialog.hide();
  }

  confirmationModalTitle.textContent = title;
  confirmationModalMessage.textContent = message;

  // Set up one-time event listeners using { once: true }
  const confirmHandler = () => {
    confirmationDialog.hide();
    onConfirm();
  };

  const cancelHandler = () => {
    confirmationDialog.hide();
  };

  confirmationModalConfirm.addEventListener('click', confirmHandler, { once: true });
  confirmationModalCancel.addEventListener('click', cancelHandler, { once: true });

  // Keyboard shortcuts
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmHandler();
      confirmationModal.removeEventListener('keydown', keyHandler);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelHandler();
      confirmationModal.removeEventListener('keydown', keyHandler);
    }
  };
  confirmationModal.addEventListener('keydown', keyHandler);

  // Show dialog
  confirmationDialog.show();
}

/**
 * Dismiss all open game dialogs. Called before level transitions.
 */
function dismissOpenDialogs(): void {
  for (const d of [resultDialog, graduationDialog, stageIntroDialog,
                   gridCodingIntroDialog, gridPracticeIntroDialog, shortcutsDialog]) {
    if (d.isOpen()) d.hide();
  }
  // Reset resultModal button/message state in case grid coding success mode left them hidden
  resultModalOk.hidden = false;
  resultModalCancel.hidden = true;
  const msg2 = document.getElementById('resultModalMessage2');
  if (msg2) msg2.innerHTML = '';
}

// Delete user data button
const deleteUserDataBtn = document.getElementById('deleteUserDataBtn')!;
deleteUserDataBtn.addEventListener('click', () => {
  showConfirmationModal(
    'Delete All Data',
    'Delete all saved programs and settings? This cannot be undone.',
    () => {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('maze')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      window.location.reload();
    }
  );
});

// ========== GRID MODE SUCCESS ==========

let gridModeCountdownInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Show success message for Grid mode with instruction count and auto-advance.
 */
function showGridModeSuccess(instructionCount: number): void {
  // Get the result modal elements (reuse the existing result modal)
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

  // Set localized text with instruction count
  resultModalTitle.textContent = msg('MAZE_GRID_SUCCESS_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_SUCCESS_MESSAGE', instructionCount);
  okText.textContent = 'OK';

  // Add success styling
  resultModal.classList.add('success');
  resultModal.classList.remove('failure');

  // Hide cancel button
  resultModalCancel.hidden = true;

  // Show modal
  resultModal.showModal();
  resultModalOk.focus();

  // Start 5 second countdown with progress bar
  const countdownDuration = 5000;
  okProgress.style.animation = `countdown-progress ${countdownDuration}ms linear forwards`;
  resultModalOk.classList.add('countdown');

  gridModeCountdownInterval = setTimeout(() => {
    hideGridModeSuccess(true);
  }, countdownDuration);

  // Handle OK button click (advance immediately)
  const handleOk = () => {
    hideGridModeSuccess(true);
    resultModalOk.removeEventListener('click', handleOk);
  };
  resultModalOk.addEventListener('click', handleOk);
}

/**
 * Hide the Grid mode success modal.
 */
function hideGridModeSuccess(advance: boolean): void {
  // Clear timer
  if (gridModeCountdownInterval) {
    clearTimeout(gridModeCountdownInterval);
    gridModeCountdownInterval = null;
  }

  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

  resultModal.close();
  resultModalOk.classList.remove('countdown');
  okProgress.style.animation = '';

  if (advance) {
    // Reset instruction count and advance to next level
    immediateModeController.resetInstructionCount();
    goToNextLevel();

    // Update grid mode level display
    const gridModeLevel = document.getElementById('gridModeLevel');
    if (gridModeLevel) {
      gridModeLevel.textContent = formatLevelLabel(mazeGame.getLevel(), MazeGame.isPracticeModeEnabled());
    }
  }
}

// ========== GRID MODE GRADUATION ==========

/**
 * Show completion message for Grid mode after finishing all levels.
 * Dismissable with OK button or any key press.
 */
function showGridModeGraduation(): void {
  // Get the result modal elements (reuse the existing result modal)
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;

  // Set localized text
  resultModalTitle.textContent = msg('MAZE_GRID_GRADUATION_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_GRADUATION_MESSAGE');
  okText.textContent = 'OK';

  // Add success styling
  resultModal.classList.add('success');
  resultModal.classList.remove('failure');

  // Hide cancel button and countdown progress
  resultModalCancel.hidden = true;
  resultModalOk.classList.remove('countdown');

  // Show modal and focus for keyboard events
  resultModal.showModal();
  resultModal.focus();

  // Handle OK button click
  const handleOk = () => {
    hideGridModeGraduation();
    cleanup();
  };
  resultModalOk.addEventListener('click', handleOk);

  // Handle any key press to dismiss
  const handleKeydown = (e: KeyboardEvent) => {
    e.preventDefault();
    hideGridModeGraduation();
    cleanup();
  };
  resultModal.addEventListener('keydown', handleKeydown);

  function cleanup() {
    resultModalOk.removeEventListener('click', handleOk);
    resultModal.removeEventListener('keydown', handleKeydown);
  }
}

/**
 * Hide the Grid mode graduation modal.
 */
function hideGridModeGraduation(): void {
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  resultModal.close();
}

// ========== GRID CODING MODE STAGE GRADUATION ==========

// Track active modal for keyboard dismissal
let gridCodingModalActive = false;
let gridCodingModalKeyHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Show completion message for A1 (Guided) mode - encourages transition to A2 (Challenge).
 * Dismissable with any key or OK button.
 */
function showGridCodingA1Complete(): void {
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;

  // Set localized text
  resultModalTitle.textContent = msg('MAZE_GRID_CODING_A1_COMPLETE_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_CODING_A1_COMPLETE_MESSAGE');
  okText.textContent = 'OK';

  // Add success styling
  resultModal.classList.add('success');
  resultModal.classList.remove('failure');

  // Hide cancel button and countdown progress
  resultModalCancel.hidden = true;
  resultModalOk.classList.remove('countdown');

  // Show modal
  resultModal.showModal();
  resultModalOk.focus();
  gridCodingModalActive = true;

  // Handler to dismiss and progress to A2
  const dismissAndProgressToA2 = () => {
    hideGridCodingModal();
    // Progress to A2 (delayed execution mode)
    currentGridStage = 2;
    const gridStageConfig = getGridStageConfig(2)!;
    if (gridCodingModeController) {
      gridCodingModeController.setImmediateExecution(gridStageConfig.immediateExecution);
    }
    // Reset to level 1 and update UI
    performLevelTransition(1, true, true);
    // Update stage dropdown
    const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
    if (stageDropdown) {
      stageDropdown.value = '2';
    }
  };

  // Handle OK button click
  resultModalOk.addEventListener('click', dismissAndProgressToA2, {once: true});

  // Handle any key press to dismiss
  gridCodingModalKeyHandler = (e: KeyboardEvent) => {
    if (gridCodingModalActive) {
      e.preventDefault();
      e.stopPropagation();
      resultModalOk.removeEventListener('click', dismissAndProgressToA2);
      dismissAndProgressToA2();
    }
  };
  // Use setTimeout to avoid dismissing immediately from the key that opened the modal
  setTimeout(() => {
    document.addEventListener('keydown', gridCodingModalKeyHandler!, {capture: true});
  }, 100);
}

/**
 * Show completion message for A2 (Challenge) mode - end of grid coding.
 * Informational only - user needs a different gridset to continue to other stages.
 * Dismissable with any key or OK button.
 */
function showGridCodingModeStageGraduation(): void {
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;

  // Set localized text
  resultModalTitle.textContent = msg('MAZE_GRID_CODING_STAGE_COMPLETE_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_CODING_STAGE_COMPLETE_MESSAGE');
  okText.textContent = 'OK';

  // Add success styling
  resultModal.classList.add('success');
  resultModal.classList.remove('failure');

  // Hide cancel button and countdown progress
  resultModalCancel.hidden = true;
  resultModalOk.classList.remove('countdown');

  // Show modal
  resultModal.showModal();
  resultModalOk.focus();
  gridCodingModalActive = true;

  // Handle OK button click
  const handleOk = () => {
    hideGridCodingModal();
  };
  resultModalOk.addEventListener('click', handleOk, {once: true});

  // Handle any key press to dismiss
  gridCodingModalKeyHandler = (e: KeyboardEvent) => {
    if (gridCodingModalActive) {
      e.preventDefault();
      e.stopPropagation();
      hideGridCodingModal();
    }
  };
  // Use setTimeout to avoid dismissing immediately from the key that opened the modal
  setTimeout(() => {
    document.addEventListener('keydown', gridCodingModalKeyHandler!, {capture: true});
  }, 100);
}

/**
 * Hide the Grid coding mode completion modal.
 */
function hideGridCodingModal(): void {
  gridCodingModalActive = false;

  if (gridCodingModalKeyHandler) {
    document.removeEventListener('keydown', gridCodingModalKeyHandler, {capture: true});
    gridCodingModalKeyHandler = null;
  }

  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  resultModal.close();
}

// ========== GRID CODING MODE SUCCESS ==========

/**
 * Show success message for Grid coding mode with block count.
 * Dialog is dismissed by pressing the Run Code button (external keyboard shortcut).
 */
function showGridCodingSuccess(blockCount: number): void {
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalMessage2 = document.getElementById('resultModalMessage2')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;

  // Set text with play icon for "Press Run Code" message
  resultModalTitle.textContent = msg('MAZE_GRID_CODING_SUCCESS_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_CODING_SUCCESS_MESSAGE', blockCount);
  // Use innerHTML to include the green play triangle icon
  const playIcon = '<span class="play-icon" style="color: #4CAF50; font-size: 1.2em; vertical-align: middle;">&#9658;</span>';
  resultModalMessage2.innerHTML = msg('MAZE_GRID_CODING_SUCCESS_MESSAGE2').replace('%PLAY%', playIcon);

  // Hide both buttons - dismissal is via Run Code keyboard shortcut
  resultModalOk.hidden = true;
  resultModalCancel.hidden = true;

  // Add success styling
  resultModal.classList.add('success');
  resultModal.classList.remove('failure');

  // Show modal
  resultModal.showModal();
}

/**
 * Hide the Grid coding mode success modal.
 * @param advance If true, clears workspace and advances to next level.
 */
function hideGridCodingSuccess(advance: boolean): void {
  const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const resultModalMessage2 = document.getElementById('resultModalMessage2')!;

  resultModal.close();
  // Reset button visibility for other dialogs
  resultModalOk.hidden = false;
  resultModalCancel.hidden = true;
  resultModalMessage2.innerHTML = '';

  if (advance) {
    // Clear workspace and advance to next level
    gridCodingModeController?.clear();
    goToNextLevel();

    // Update grid coding level display
    const gridCodingLevel = document.getElementById('gridCodingLevel');
    if (gridCodingLevel) {
      gridCodingLevel.textContent = formatLevelLabel(mazeGame.getLevel(), MazeGame.isPracticeModeEnabled());
    }
  }
}

/**
 * Initialize Grid mode UI if active.
 */
function initializeGridMode(): void {
  if (!isGridMode) return;

  // Add grid-mode class to body for CSS targeting
  document.body.classList.add('grid-mode');

  // Show grid mode level label
  const gridModeLevel = document.getElementById('gridModeLevel');
  if (gridModeLevel) {
    gridModeLevel.classList.remove('hidden');
    gridModeLevel.textContent = formatLevelLabel(mazeGame.getLevel(), MazeGame.isPracticeModeEnabled());
  }

  // Show instruction count
  const instructionCountEl = document.getElementById('gridModeInstructionCount');
  if (instructionCountEl) {
    instructionCountEl.classList.remove('hidden');
    instructionCountEl.textContent = msg('MAZE_GRID_INSTRUCTIONS', 0);
  }

  // Update instruction bar text for grid mode
  const levelInstruction = document.getElementById('levelInstruction');
  if (levelInstruction) {
    levelInstruction.textContent = msg('MAZE_GRID_INSTRUCTION');
  }

  // Show practice mode intro
  showGridPracticeIntroModal();
}

// Initialize Grid mode if active
initializeGridMode();

/**
 * Initialize Grid coding mode UI if active.
 */
function initializeGridCodingMode(): void {
  if (!isGridCodingMode) return;

  // Add grid-coding-mode class to body for CSS targeting
  document.body.classList.add('grid-coding-mode');

  // Show grid coding level label
  const gridCodingLevel = document.getElementById('gridCodingLevel');
  if (gridCodingLevel) {
    gridCodingLevel.classList.remove('hidden');
    gridCodingLevel.textContent = formatLevelLabel(mazeGame.getLevel(), MazeGame.isPracticeModeEnabled());
  }

  // Show block count
  const blockCountEl = document.getElementById('gridCodingBlockCount');
  if (blockCountEl) {
    blockCountEl.classList.remove('hidden');
    blockCountEl.textContent = msg('MAZE_GRID_BLOCKS', 0);
  }

  // Show grid coding controls
  const gridCodingControls = document.getElementById('gridCodingControls');
  if (gridCodingControls) {
    gridCodingControls.classList.remove('hidden');
  }

  // Update instruction bar text for grid coding mode
  const levelInstruction = document.getElementById('levelInstruction');
  if (levelInstruction) {
    levelInstruction.textContent = msg('MAZE_GRID_CODING_INSTRUCTION');
  }

  // Enable the controller
  if (gridCodingModeController) {
    gridCodingModeController.enable();
  }

  // Hide the toolbox/flyout by setting an empty toolbox
  // Grid3 provides the block selection UI externally
  workspace.updateToolbox({kind: 'flyoutToolbox', contents: []});

  // Also try to hide the flyout directly
  const flyout = workspace.getFlyout();
  if (flyout) {
    flyout.hide();
  }

  // Show intro dialog explaining what coding mode is
  showGridCodingIntroModal();

  // Resize Blockly workspace to fit new layout after a short delay
  // (allows CSS to be applied first)
  setTimeout(() => {
    // Capture the settled flyout width (after updateToolbox([]) has been processed)
    // and use it to drive the CSS transform that hides the dead space.
    const settledFlyout = workspace.getFlyout();
    const flyoutWidth = settledFlyout ? settledFlyout.getWidth() : 0;
    document.getElementById('blocklyDiv')
      ?.style.setProperty('--flyout-width', `${flyoutWidth}px`);
    // Resize AFTER setting the CSS variable so Blockly measures the
    // correctly-sized div (widened by flyoutWidth to fill the dead-space gap).
    Blockly.svgResize(workspace);
    workspace.scroll(getGridCodingModeScrollX(), 0);
  }, 100);
}

// Initialize Grid coding mode if active
initializeGridCodingMode();

/**
 * Phase 3 Step 2 — build the per-source providers the switch-scan
 * controller uses to open a sub-scan over header dropdowns.
 *
 * Two sources are registered:
 *  - `character`: tags `#pegmanButton`. Options are the
 *    {@link ENABLED_SKIN_IDS} list, each with a short display name
 *    keyed off the existing comment in this file. The skin object
 *    itself has no `name` field — we keep the labels here rather than
 *    threading a name into the Skin interface, since these labels are
 *    UI strings and not part of the maze runtime.
 *  - `language`: tags `<select id="languageSelect">`. Options are
 *    read straight off the DOM (`<option>` text + value pairs) so
 *    adding a new locale to the markup picks up here automatically.
 *    Commit mutates the select's value and dispatches `change` so the
 *    existing handler (which persists the locale and reloads the page
 *    with the new `lang` param) fires unchanged.
 */
function buildHeaderDropdownSources(): Record<string, HeaderDropdownSource> {
  // Indexed by skinId — order matches the SKINS array in maze.ts. The
  // Skin interface itself carries no `name` field (the maze runtime
  // doesn't need one), so the UI labels live here. Keeping the table
  // as a plain array dodges the @typescript-eslint/naming-convention
  // rule that numeric object-literal keys trip, and an unknown skinId
  // falls back to the generic "Skin N" label below.
  const SKIN_NAMES: string[] = [
    'Astro',
    'Wheelchair',
    'Panda',
    'Pegman',
    'Rudolph',
    'Footballer (chase)',
    'Footballer (dribble)',
  ];
  return {
    character: {
      getOptions: () =>
        ENABLED_SKIN_IDS.map<
          [string, string]
        >((id) => [SKIN_NAMES[id] ?? `Skin ${id}`, String(id)]),
      commit: (value) => {
        const id = parseInt(value, 10);
        if (Number.isFinite(id)) changePegman(id);
      },
    },
    language: {
      getOptions: () => {
        const select = document.getElementById(
          'languageSelect',
        ) as HTMLSelectElement | null;
        if (!select) return [];
        const opts: Array<[string, string]> = [];
        for (const opt of Array.from(select.options)) {
          // Use the visible textContent so localized language names
          // (e.g. "Français") read correctly via TTS and visually
          // match what mouse users see in the native dropdown.
          const label = opt.textContent?.trim() || opt.value;
          opts.push([label, opt.value]);
        }
        return opts;
      },
      commit: (value) => {
        const select = document.getElementById(
          'languageSelect',
        ) as HTMLSelectElement | null;
        if (!select) return;
        // Mirror the mouse-user flow: set value, then fire the native
        // `change` event so the existing handler at line ~1660 runs
        // (persists locale to localStorage + navigates to a new URL
        // with the updated `lang` param — Blockly needs the full
        // reload to re-register blocks with the new locale).
        select.value = value;
        select.dispatchEvent(new Event('change'));
      },
    },
  };
}

// Initialize switch-scan controller if active (Phase 1 scaffold).
// Mutually exclusive with grid coding mode; instantiation above is guarded.
let switchScanController: SwitchScanController | null = null;
let switchScanSettings: SwitchScanSettings | null = null;
// Phase 5: a single TTS helper instance owned by the page for the
// life of the session. The controller speaks via setTts(); the
// settings panel persists the on/off state via onSave + setEnabled.
// Constructed unconditionally even though it's only used in switch-
// scan mode — the helper is cheap and feature-detects internally.
let switchScanTts: SwitchScanTts | null = null;
if (isSwitchScanMode) {
  switchScanTts = new SwitchScanTts();
  switchScanTts.setEnabled(switchScanInitialAudio);

  switchScanController = new SwitchScanController(workspace, mazeGame, {
    switchAdvance: switchAdvanceKey,
    switchSelect: switchSelectKey,
    // Phase 4: seed the auto-scan state machine. `step` is the default
    // so existing two-switch users see zero behavior change; `auto`
    // starts idle and waits for the user's first press to begin
    // cycling.
    scanMode: switchScanInitialMode,
    scanSpeedMs: switchScanInitialScanSpeedMs,
    // Phase 3 Step 2: providers for the Character (#pegmanButton) and
    // Language (<select id="languageSelect">) header dropdowns. Both
    // normally open native popovers that switch users can't reach;
    // registering them here makes the controller intercept a switch-
    // scan select on the tagged element and open a values sub-scan
    // over our own dark .switch-scan-dropdown-menu instead.
    headerDropdowns: buildHeaderDropdownSources(),
  });
  // Wire TTS BEFORE enable() so the initial highlight render — which
  // doesn't speak anyway (see SwitchScanController.enable) — already
  // sees the helper, and the very first user keypress can fire a
  // speak call without a re-attach race.
  switchScanController.setTts(switchScanTts);
  switchScanController.enable();

  // Phase 2 Step A: surface the dedicated Switch Scan Settings button
  // in the header (it's `.hidden` in markup so non-switch-scan users
  // never see it) and wire it to open the settings modal.
  // Phase 2 Step B: pass current keybindings + an onSave callback so
  // the modal has live key-capture.
  // Phase 2 Step C: Save now persists to localStorage and lives re-binds
  // the controller via setKeyBindings(). The `urlOverrideActive` flag
  // tells the modal to render the "URL settings active" note so users
  // understand why their saved values won't show up after reload while
  // URL params remain in the address bar.
  switchScanSettings = new SwitchScanSettings({
    initialAdvanceKey: switchAdvanceKey,
    initialSelectKey: switchSelectKey,
    initialMode: switchScanInitialMode,
    // Phase 5: seed the audio checkbox from URL > LS > 'off'.
    initialAudio: switchScanInitialAudio,
    // Phase 4: seed the scan-speed slider from URL > LS > 1500.
    initialScanSpeedMs: switchScanInitialScanSpeedMs,
    urlOverrideActive: switchScanUrlOverrideActive,
    onSave: (cfg) => {
      // Persist all five values. Wrapped in try/catch because
      // localStorage can throw in private-browsing / quota-exceeded
      // contexts — settings work for this session, just not the next.
      try {
        window.localStorage.setItem(
          SWITCH_SCAN_LS_KEYS.advance,
          cfg.switchAdvance,
        );
        window.localStorage.setItem(
          SWITCH_SCAN_LS_KEYS.select,
          cfg.switchSelect,
        );
        // Phase 4: mode is now live — the controller's setMode()
        // applies it without a reload (see below). Persistence keeps
        // the radio aligned with the user's pick across sessions.
        window.localStorage.setItem(SWITCH_SCAN_LS_KEYS.mode, cfg.mode);
        // Phase 5: TTS persists as 'on' / 'off'. We don't write a
        // boolean — keeps the LS layer consistent with the rest of
        // the maze game's string-typed flags and matches the URL
        // param's accepted values.
        window.localStorage.setItem(
          SWITCH_SCAN_LS_KEYS.audio,
          cfg.audio ? 'on' : 'off',
        );
        // Phase 4: scanSpeedMs persists as a string for symmetry with
        // the other LS values. The resolver helper handles parseInt
        // + clamp on read so a hand-edited LS entry can't crash the
        // timer.
        window.localStorage.setItem(
          SWITCH_SCAN_LS_KEYS.scanSpeedMs,
          String(cfg.scanSpeedMs),
        );
      } catch (e) {
        console.warn(
          '[switch-scan settings] localStorage write failed:',
          e,
        );
      }

      // Live re-bind so the new keys take effect mid-session without
      // requiring a reload. Scan position + frame stack are preserved
      // by setKeyBindings() — the user resumes exactly where they were.
      switchScanController?.setKeyBindings(
        cfg.switchAdvance,
        cfg.switchSelect,
      );
      // Phase 4: live-apply the mode + speed. setMode() clears the
      // auto timer on any transition (so step→auto goes idle and waits
      // for press, auto→step freezes the highlight wherever it was)
      // and restarts the interval at the new period if we were already
      // scanning. Scan position is preserved either way.
      switchScanController?.setMode(cfg.mode, cfg.scanSpeedMs);
      // Phase 5: live-apply the audio choice. Toggling enabled → on
      // does NOT auto-replay the previous label (would be confusing
      // out of context); instead, we ask the controller to speak the
      // CURRENT highlight so the user hears immediate confirmation
      // that the toggle worked. Disabling silences any in-progress
      // utterance via SwitchScanTts.setEnabled(false) → cancel().
      const wasEnabled = switchScanTts?.isEnabled() ?? false;
      switchScanTts?.setEnabled(cfg.audio);
      if (cfg.audio && !wasEnabled) {
        switchScanController?.speakCurrentItemLabel();
      }
    },
    // Phase 2 Step D: when the modal opens, push a sub-scan frame over
    // the modal's `data-scan-region="settings-modal"` so the scanner
    // re-targets itself INSIDE the modal — otherwise a switch user who
    // opened the modal would be stranded (the top-level cycle keeps
    // scanning the page underneath, but the modal's controls aren't on
    // it). Pop is the symmetric close hook below.
    onOpen: () => {
      switchScanController?.pushModalSubScan('settings-modal');
    },
    // Phase 2 Step D: fires for EVERY close path (Cancel, Save, ESC,
    // backdrop click — Dialog funnels them all through this single
    // callback). Pops the modal frame and restores the user to whatever
    // top-level region they came from (typically `header`, where the
    // settings button lives).
    onClose: () => {
      switchScanController?.popModalSubScan();
    },
  });

  // Phase 2 Step D: wire the controller → settings reference so its
  // keydown handler can short-circuit while a live key-capture is in
  // flight. See SwitchScanController.setSettings for the why.
  switchScanController.setSettings(switchScanSettings);

  const switchSettingsBtn = document.getElementById('switchSettingsBtn');
  if (switchSettingsBtn) {
    switchSettingsBtn.classList.remove('hidden');
    switchSettingsBtn.addEventListener('click', () => {
      // `show()` itself fires the onOpen hook (after the dialog is
      // actually visible), which pushes the modal sub-scan frame.
      switchScanSettings?.show();
    });
  }
}

// Trigger hints on workspace changes (with debouncing via the timeout in levelHelp)
workspace.addChangeListener((event) => {
  if (event.type === Blockly.Events.BLOCK_CREATE ||
      event.type === Blockly.Events.BLOCK_DELETE ||
      event.type === Blockly.Events.BLOCK_CHANGE ||
      event.type === Blockly.Events.BLOCK_MOVE) {
    levelHelp();
  }
});

// Reset hint state when level changes
function resetHintState() {
  hasRun = false;
  lastResult = 'none';
  hideHint();
  // Update instruction bar for new level
  updateInstructionBar();
  // Trigger initial hint for new level
  setTimeout(levelHelp, 1000);
}

// Note: resetHintState is called within goToPreviousLevel and goToNextLevel

// Initialize instruction bar and hints after page load
updateInstructionBar();
setTimeout(levelHelp, 3000);

// Show Stage 1 intro on initial page load if no level specified in URL
// This introduces users to the first stage concept when starting fresh
const hasLevelInUrl = window.location.search.includes('level=');
if (!hasLevelInUrl && currentExecutionMode === 'coding' && !isGridMode && !isGridCodingMode) {
  // Show after a short delay to let UI fully initialize
  setTimeout(() => {
    showStageIntroModal(1);
  }, 500);
}

// ========== LEVEL TRANSITION ==========

/**
 * Perform a level transition with fade effect and level banner.
 * @param newLevel The level to transition to
 * @param showBanner Whether to show the level banner (true for next, false for previous)
 * @param showStageIntro Whether to show stage intro dialog if stage changes (true for next/dropdown, false for previous)
 */
function performLevelTransition(newLevel: number, showBanner: boolean = true, showStageIntro: boolean = true) {
  if (isTransitioning) return;
  isTransitioning = true;

  // Reset replay flag when changing levels
  isGridCodingReplay = false;

  const isPractice = MazeGame.isPracticeModeEnabled();
  const currentLevel = mazeGame.getLevel();

  // Determine if we should show stage intro after transition
  let stageToIntroduce: number | null = null;
  if (showStageIntro && !isPractice && !isGridMode && !isGridCodingMode) {
    const currentStage = getStageForLevel(currentLevel - 1, isPractice);
    const newStage = getStageForLevel(newLevel - 1, isPractice);
    if (currentStage !== newStage) {
      stageToIntroduce = newStage;
    }
  }

  // Save current level's program before transitioning (coding mode only, not grid coding mode)
  // This ensures empty programs are saved when user clears all blocks
  if (!isPractice && !isGridCodingMode) {
    saveProgram(currentLevel, workspace);
  }

  const canvasWrapper = document.querySelector('.canvas-wrapper') as HTMLElement;
  const levelBanner = document.getElementById('levelBanner');
  const levelNumber = levelBanner?.querySelector('.level-number');

  // Update the level banner text
  if (levelNumber) {
    levelNumber.textContent = formatLevelLabel(newLevel, isPractice);
  }

  // Step 1: Fade out the canvas
  canvasWrapper?.classList.add('fade-out');

  setTimeout(() => {
    // Step 2: Actually change the level while faded
    mazeGame.setLevel(newLevel);
    updateWorkspaceForLevel(newLevel);
    updateLevelDisplay();
    resetHintState();
    // Update URL to reflect level change
    updateUrlState();

    // Update Grid mode level display and reset instruction count
    if (isGridMode) {
      const gridModeLevel = document.getElementById('gridModeLevel');
      if (gridModeLevel) {
        gridModeLevel.textContent = formatLevelLabel(newLevel, MazeGame.isPracticeModeEnabled());
      }
      immediateModeController.resetInstructionCount();
    }

    // Reset Grid coding mode controller when changing levels
    if (isGridCodingMode) {
      const gridCodingLevel = document.getElementById('gridCodingLevel');
      if (gridCodingLevel) {
        gridCodingLevel.textContent = formatLevelLabel(newLevel, MazeGame.isPracticeModeEnabled());
      }
      gridCodingModeController?.clear();

      // Re-hide the flyout (updateWorkspaceForLevel restored it)
      workspace.updateToolbox({kind: 'flyoutToolbox', contents: []});
      const flyout = workspace.getFlyout();
      if (flyout) {
        flyout.hide();
      }

      // Resize workspace and reset scroll
      // Use negative offset to compensate for hidden flyout space
      Blockly.svgResize(workspace);
      workspace.scroll(getGridCodingModeScrollX(), 0);
    }

    // Step 3: Fade in the canvas
    canvasWrapper?.classList.remove('fade-out');
    canvasWrapper?.classList.add('fade-in');

    // Step 4: Show level banner (overlaid on maze)
    if (showBanner) {
      levelBanner?.classList.add('active');

      // Hide banner after delay
      setTimeout(() => {
        levelBanner?.classList.remove('active');
      }, 1000);
    }

    // Clean up transition classes
    setTimeout(() => {
      canvasWrapper?.classList.remove('fade-in');
      isTransitioning = false;

      // Step 5: Show stage intro modal AFTER level has loaded (so new blocks visible)
      if (stageToIntroduce !== null) {
        showStageIntroModal(stageToIntroduce);
      }
    }, 300);
  }, 300); // Fade out duration
}

// ========== GLOBAL KEYBOARD SHORTCUTS ==========

/**
 * Go to previous level (shared by button and keyboard shortcut).
 * Does not show stage intro dialog when going backwards.
 */
function goToPreviousLevel() {
  if (isTransitioning) return;
  const currentLevel = mazeGame.getLevel();
  if (currentLevel > 1) {
    const newLevel = currentLevel - 1;
    performLevelTransition(newLevel, true, false);  // showStageIntro = false for previous
  }
}

/**
 * Go to next level (shared by button and keyboard shortcut).
 * Shows graduation modal if at last practice level.
 * In grid coding mode, shows stage completion dialog at end of Stage 1.
 */
function goToNextLevel() {
  if (isTransitioning) return;
  dismissOpenDialogs();
  const currentLevel = mazeGame.getLevel();
  const maxLevel = MazeGame.getMaxLevel();

  // In grid coding mode, restrict to Stage 1 levels only
  if (isGridCodingMode) {
    const stage1MaxLevel = getLevelsForStage(1, false).length;
    if (currentLevel >= stage1MaxLevel) {
      // At last Stage 1 level - show appropriate dialog based on grid stage
      if (currentGridStage === 1) {
        // A1 complete - encourage transition to A2
        showGridCodingA1Complete();
      } else {
        // A2 complete - show final stage completion
        showGridCodingModeStageGraduation();
      }
      return;
    }
  }

  if (currentLevel < maxLevel) {
    const newLevel = currentLevel + 1;
    performLevelTransition(newLevel, true);
  } else if (MazeGame.isPracticeModeEnabled()) {
    // At last practice level - offer to switch to coding mode
    if (isGridMode) {
      showGridModeGraduation();
    } else {
      showGraduationModal();
    }
  }
}

/**
 * Go to previous stage (first level of the previous stage).
 * In grid coding mode, navigates between grid stages.
 */
function goToPreviousStage() {
  if (isTransitioning) return;

  if (isGridCodingMode) {
    // Grid coding mode: switch between grid stages
    if (currentGridStage > 1) {
      const newGridStage = currentGridStage - 1;
      const gridStageConfig = getGridStageConfig(newGridStage);
      if (gridStageConfig && gridCodingModeController) {
        currentGridStage = newGridStage;
        gridCodingModeController.setImmediateExecution(gridStageConfig.immediateExecution);
        performLevelTransition(1, true, true);
        // Update stage dropdown
        const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
        if (stageDropdown) {
          stageDropdown.value = String(newGridStage);
        }
      }
    }
  } else {
    // Normal mode: navigate to first level of previous content stage
    const currentLevel = mazeGame.getLevel();
    const isPractice = MazeGame.isPracticeModeEnabled();
    const currentStage = getStageForLevel(currentLevel - 1, isPractice);

    if (currentStage > 1) {
      const previousStage = currentStage - 1;
      const firstLevelIndex = getFirstLevelIndexForStage(previousStage, isPractice);
      if (firstLevelIndex >= 0) {
        performLevelTransition(firstLevelIndex + 1, true, true);
        // Update stage dropdown
        const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
        if (stageDropdown) {
          stageDropdown.value = String(previousStage);
        }
      }
    }
  }
}

/**
 * Go to next stage (first level of the next stage).
 * In grid coding mode, navigates between grid stages.
 */
function goToNextStage() {
  if (isTransitioning) return;

  if (isGridCodingMode) {
    // Grid coding mode: switch between grid stages
    if (currentGridStage < GRID_STAGES.length) {
      const newGridStage = currentGridStage + 1;
      const gridStageConfig = getGridStageConfig(newGridStage);
      if (gridStageConfig && gridCodingModeController) {
        currentGridStage = newGridStage;
        gridCodingModeController.setImmediateExecution(gridStageConfig.immediateExecution);
        performLevelTransition(1, true, true);
        // Update stage dropdown
        const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
        if (stageDropdown) {
          stageDropdown.value = String(newGridStage);
        }
      }
    }
  } else {
    // Normal mode: navigate to first level of next content stage
    const currentLevel = mazeGame.getLevel();
    const isPractice = MazeGame.isPracticeModeEnabled();
    const currentStage = getStageForLevel(currentLevel - 1, isPractice);
    const maxStage = STAGES.length;

    if (currentStage < maxStage) {
      const nextStage = currentStage + 1;
      const firstLevelIndex = getFirstLevelIndexForStage(nextStage, isPractice);
      if (firstLevelIndex >= 0) {
        performLevelTransition(firstLevelIndex + 1, true, true);
        // Update stage dropdown
        const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
        if (stageDropdown) {
          stageDropdown.value = String(nextStage);
        }
      }
    }
  }
}

/**
 * Global keyboard shortcuts for quick navigation and actions.
 * These work from anywhere on the page.
 *
 * Shortcuts:
 * - Ctrl+Alt+1: Jump to workspace
 * - Ctrl+Alt+2: Jump to toolbox
 * - Ctrl+Alt+R: Run the program (alternative)
 * - H: Toggle instruction bar display mode
 * - {: Previous stage
 * - }: Next stage
 * - [: Previous level
 * - ]: Next level
 * - R: Run the program
 * - Shift+R: Reset maze position
 * - ,: Previous character
 * - .: Next character
 * - L: Cycle language
 */
// Use capture phase (true) to handle shortcuts before Blockly intercepts them
document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Ignore if user is typing in an input field
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.isContentEditable) {
    return;
  }

  // Ctrl+Alt+1: Jump to workspace
  if (e.ctrlKey && e.altKey && e.key === '1') {
    e.preventDefault();
    e.stopPropagation();
    // Enable keyboard navigation mode
    Blockly.keyboardNavigationController.setIsActive(true);
    // Focus the workspace - try to focus first block if available
    const topBlocks = workspace.getTopBlocks(true);
    if (topBlocks.length > 0) {
      Blockly.getFocusManager().focusNode(topBlocks[0]);
    } else {
      Blockly.getFocusManager().focusTree(workspace);
    }
    return;
  }

  // Ctrl+Alt+2: Jump to toolbox/flyout
  if (e.ctrlKey && e.altKey && e.key === '2') {
    e.preventDefault();
    e.stopPropagation();
    // Enable keyboard navigation mode
    Blockly.keyboardNavigationController.setIsActive(true);
    // Focus the toolbox or flyout
    const toolbox = workspace.getToolbox();
    const flyout = workspace.getFlyout();
    if (toolbox) {
      Blockly.getFocusManager().focusTree(toolbox);
    } else if (flyout) {
      Blockly.getFocusManager().focusTree(flyout.getWorkspace());
    }
    return;
  }

  // Ctrl+Alt+R: Run the program
  if (e.ctrlKey && e.altKey && e.key === 'r') {
    e.preventDefault();
    e.stopPropagation();
    runProgram();
    return;
  }

  // H: Toggle instruction bar display mode (no modifiers)
  if (e.key === 'h' || e.key === 'H') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      cycleDisplayMode();
      return;
    }
  }

  // [: Previous level (no modifiers)
  if (e.key === '[') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      goToPreviousLevel();
      return;
    }
  }

  // ]: Next level (no modifiers)
  if (e.key === ']') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      goToNextLevel();
      return;
    }
  }

  // {: Previous stage (Shift+[)
  if (e.key === '{') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      goToPreviousStage();
      return;
    }
  }

  // }: Next stage (Shift+])
  if (e.key === '}') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      goToNextStage();
      return;
    }
  }

  // Shift+R: Reset maze position (global)
  if (e.key === 'R' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    resetProgram();
    return;
  }

  // R: Run the program in coding mode (no modifiers)
  // In practice mode, R is handled by the practice mode controller for reset
  if (e.key === 'r' || e.key === 'R') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      if (currentExecutionMode === 'coding' || isGridCodingMode) {
        e.preventDefault();
        e.stopPropagation();
        runProgram();
        return;
      }
      // Let practice mode controller handle R for reset
    }
  }

  // ,: Previous character (no modifiers)
  if (e.key === ',') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      gridCodingIntroDialog.hide();
      gridPracticeIntroDialog.hide();
      stageIntroDialog.hide();
      cycleCharacterPrevious();
      return;
    }
  }

  // .: Next character (no modifiers)
  if (e.key === '.') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      gridCodingIntroDialog.hide();
      gridPracticeIntroDialog.hide();
      stageIntroDialog.hide();
      cycleCharacterNext();
      return;
    }
  }

  // L: Cycle language (no modifiers)
  if (e.key === 'l' || e.key === 'L') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      cycleLanguage();
      return;
    }
  }

  // Shift+M: Toggle mute (frees M for Blockly move mode)
  if (e.key === 'M' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    toggleSound();
    return;
  }

}, true); // Use capture phase to handle before Blockly



