/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Maze game with keyboard navigation support.
 * Simple maze game adapted from blockly-games.
 */

import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {KeyboardNavigation, TriggerMode} from '../../src/index';
import {registerFlyoutCursor} from '../../src/flyout_cursor';
import {registerNavigationDeferringToolbox} from '../../src/navigation_deferring_toolbox';
import {registerMazeBlocks, setCurrentSkin} from './blocks';
import {MazeGame, getMaxBlocksForLevel, getStageForLevel, getFirstLevelIndexForStage, STAGES, CODING_LEVELS, type ResultType} from './maze';
import {loadMessages, getBrowserLocale, msg, type SupportedLocale} from './messages';
import {ImmediateModeController} from './immediate-mode';
import {GridCodingModeController} from './grid-coding-mode';

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

// Initialize locale (URL param > localStorage > browser detection)
const urlLang = getStringParamFromUrl('lang', '');
let currentLocale: SupportedLocale =
  (urlLang === 'en' || urlLang === 'fr') ? urlLang :
  (localStorage.getItem('mazeGameLocale') as SupportedLocale) || getBrowserLocale();

// Load internationalized messages
loadMessages(currentLocale);

// Register maze-specific blocks
registerMazeBlocks();

// ========== PROGRAM STORAGE ==========
// Storage key format: "mazeProgram" + level number

const PROGRAM_STORAGE_PREFIX = 'mazeProgram';

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
        contents.push({kind: 'block', type: 'maze_repeatTimes', fields: {TIMES: 5}});
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
const initialLevel = getIntegerParamFromUrl('level', 1, MazeGame.getMaxLevel());
const initialMaxBlocks = getMaxBlocksForLevel(initialLevel - 1, currentExecutionMode === 'practice');

// Initialize Blockly workspace with level-specific configuration
const workspace = Blockly.inject('blocklyDiv', {
  renderer: 'zelos',
  toolbox: getToolboxForLevel(initialLevel),
  trashcan: true,
  maxBlocks: initialMaxBlocks === Infinity ? undefined : initialMaxBlocks,
  zoom: {
    controls: true,
    wheel: true,
    startScale: 1.2,
    maxScale: 3,
    minScale: 0.3,
    scaleSpeed: 1.2,
  },
  move: {
    scrollbars: true,
    drag: true,
    wheel: true,
  },
});

// Load saved program for initial level (coding mode only)
if (currentExecutionMode !== 'practice') {
  const savedXml = loadProgram(initialLevel);
  if (savedXml) {
    restoreProgram(savedXml, workspace);
  }
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

// Reset scroll when workspace becomes empty or first block is added
// This ensures blocks appear at a predictable location for assistive tech users
workspace.addChangeListener((event) => {
  if (event.type !== Blockly.Events.BLOCK_CREATE &&
      event.type !== Blockly.Events.BLOCK_DELETE) {
    return;
  }

  const topBlocks = workspace.getTopBlocks(false);

  // If workspace just became empty, reset scroll
  if (topBlocks.length === 0) {
    workspace.scroll(0, 0);
  }

  // If first block was just added, reset scroll so it appears at predictable location
  if (event.type === Blockly.Events.BLOCK_CREATE && topBlocks.length === 1) {
    workspace.scroll(0, 0);
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
  workspace.scroll(0, 0);

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
// - Large connections: bigger click targets for accessibility
// - Keep block in place: don't drag with mouse, click destination instead
keyboardNavigation.setTriggerMode(TriggerMode.FOCUSED_CLICK);
keyboardNavigation.setConnectionSize('large');
keyboardNavigation.setKeepBlockOnMouse(false);

// Enable keyboard navigation mode from the start so focus indicators show on tab
Blockly.keyboardNavigationController.setIsActive(true);

// ========== MOVE MODE HINTS ==========

// Track hint display (resets on page refresh)
let clickConnectionHintShown = false;
let clickWorkspaceHintShown = false;
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
 * Each hint type shown once per page load independently.
 */
function showClickMoveModeHint(block: Blockly.BlockSvg) {
  // If no valid connections, show workspace placement hint (once)
  if (!hasValidConnections(block)) {
    if (clickWorkspaceHintShown) return;
    clickWorkspaceHintShown = true;
    Blockly.Toast.show(workspace, {
      message: 'Click on the workspace to move the block there',
      id: 'maze_move_mode_hint',
    });
    return;
  }

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
setCurrentSkin(savedSkin); // Set initial skin for block icons

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
 */
function buildGameUrl(overrides: {level?: number, skin?: number, lang?: string, mode?: string, grid?: boolean} = {}): string {
  const params = new URLSearchParams();
  params.set('lang', overrides.lang ?? currentLocale);
  params.set('level', String(overrides.level ?? mazeGame.getLevel()));
  params.set('skin', String(overrides.skin ?? mazeGame.getSkin()));
  const mode = overrides.mode ?? currentExecutionMode;
  if (mode !== 'coding') {
    params.set('mode', mode); // Always writes 'practice' (never 'practise')
  }
  // Preserve grid mode in URL
  const gridParam = overrides.grid !== undefined ? overrides.grid : isGridMode;
  if (gridParam) {
    params.set('grid', '1');
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

// Initialize Grid coding mode controller (only created if in Grid coding mode)
let gridCodingModeController: GridCodingModeController | null = null;
if (isGridCodingMode) {
  gridCodingModeController = new GridCodingModeController(workspace, mazeGame);

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
if (gridCodingModeController) {
  gridCodingModeController.onLevelComplete((success) => {
    if (success) {
      const currentLevel = mazeGame.getLevel();
      // Grid coding mode only supports levels 1-2 (simple statements)
      const maxGridCodingLevel = 2;

      // Launch confetti first
      launchConfetti();

      if (currentLevel >= maxGridCodingLevel) {
        // Show Grid coding graduation message
        setTimeout(() => {
          showGridCodingGraduation(gridCodingModeController!.getBlockCount());
        }, 1500);
      } else {
        // Show success and advance to next level
        setTimeout(() => {
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
 * Update the UI based on current execution mode.
 * Practice mode: Shows command buttons, hides Blockly workspace
 * Coding mode: Shows Blockly workspace, hides command buttons
 * Grid coding mode: Shows Blockly workspace (for blocks), hides normal controls
 */
function updateModeUI(): void {
  const blocklyDiv = document.getElementById('blocklyDiv');
  const runButton = document.getElementById('runButton');
  const capacityBubble = document.getElementById('capacityBubble');
  const gridCodingControls = document.getElementById('gridCodingControls');

  if (currentExecutionMode === 'practice') {
    // Practice mode: Hide Blockly, show command buttons
    blocklyDiv?.classList.add('hidden');
    runButton?.classList.add('hidden');
    capacityBubble?.classList.add('hidden');
    gridCodingControls?.classList.add('hidden');
    immediateModeController.setMazeGame(mazeGame);
    immediateModeController.enable();
    gridCodingModeController?.disable();
  } else if (isGridCodingMode) {
    // Grid coding mode: Show Blockly workspace, hide other controls
    blocklyDiv?.classList.remove('hidden');
    runButton?.classList.add('hidden'); // Use keyboard R instead
    capacityBubble?.classList.add('hidden'); // No block limits in Grid coding
    gridCodingControls?.classList.remove('hidden');
    immediateModeController.disable();
    if (gridCodingModeController) {
      gridCodingModeController.setMazeGame(mazeGame);
      gridCodingModeController.enable();
    }
    // Resize Blockly to fill available space
    Blockly.svgResize(workspace);
  } else {
    // Normal coding mode: Show Blockly, hide command buttons
    blocklyDiv?.classList.remove('hidden');
    runButton?.classList.remove('hidden');
    gridCodingControls?.classList.add('hidden');
    immediateModeController.disable();
    gridCodingModeController?.disable();
    // Resize Blockly to fill available space
    Blockly.svgResize(workspace);
    // Update capacity bubble
    updateCapacityBubble();
  }
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
  // Also update fullscreen Run button if present
  const fsRunButton = document.querySelector('.fullscreen-run') as HTMLButtonElement;
  if (fsRunButton) {
    fsRunButton.disabled = isExecuting;
  }
});

/**
 * Format a level number as "Level" + stage letter + level within stage (e.g., Level A1, Level B2).
 * @param level The 1-based level number
 * @param isPractice Whether we're in practice mode
 * @returns Formatted level string like "Level A1", "Level B2", etc.
 */
function formatLevelLabel(level: number, isPractice: boolean): string {
  const stage = getStageForLevel(level - 1, isPractice);
  const stageLetter = String.fromCharCode(64 + stage); // 65 is 'A'
  const firstLevelIndex = getFirstLevelIndexForStage(stage, isPractice);
  const levelInStage = level - firstLevelIndex;
  return `${msg('MAZE_LEVEL')} ${stageLetter}${levelInStage}`;
}

/**
 * Populate the stage dropdown with letter-based options (A, B, C, etc.).
 */
function populateStageDropdown(): void {
  const stageDropdown = document.getElementById('stageDropdown') as HTMLSelectElement;
  if (!stageDropdown) return;

  // Clear existing options
  stageDropdown.innerHTML = '';

  // Add options for each stage
  STAGES.forEach((stage, index) => {
    const option = document.createElement('option');
    option.value = String(stage.id);
    const stageLetter = String.fromCharCode(65 + index); // A, B, C, etc.
    const stageName = msg(stage.name);
    option.textContent = `${stageLetter} - ${stageName}`;
    stageDropdown.appendChild(option);
  });
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
    // Hide stage selector in practice mode
    if (isPractice) {
      stageSelector.classList.add('hidden');
    } else {
      stageSelector.classList.remove('hidden');
    }
  }

  // Sync stage dropdown with current level
  if (stageDropdown && !isPractice) {
    stageDropdown.value = String(stage);
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
  const stageId = parseInt(select.value, 10);
  const isPractice = MazeGame.isPracticeModeEnabled();

  // Get the first level index for this stage (0-based)
  const firstLevelIndex = getFirstLevelIndexForStage(stageId, isPractice);

  if (firstLevelIndex >= 0) {
    // Convert to 1-based level number
    const newLevel = firstLevelIndex + 1;

    // Reset hint state
    resetHintState();

    // Change to the new level
    mazeGame.setLevel(newLevel);
    updateWorkspaceForLevel(newLevel);
    updateLevelDisplay();
    updateCapacityBubble();
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

// ========== CONFETTI EFFECT ==========

const confettiColors = [
  '#ff6b6b', // red
  '#ffd93d', // yellow
  '#6bcb77', // green
  '#4d96ff', // blue
  '#ff8cc8', // pink
  '#a855f7', // purple
  '#f97316', // orange
];

const confettiShapes = ['circle', 'square', 'ribbon'];
const confettiSwings = ['', 'swing-left', 'swing-right'];

/**
 * Launch confetti particles for level completion celebration.
 */
function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;

  // Clear any existing confetti
  container.innerHTML = '';

  // Create 80 confetti particles
  const particleCount = 80;

  for (let i = 0; i < particleCount; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';

    // Random shape
    const shape = confettiShapes[Math.floor(Math.random() * confettiShapes.length)];
    confetti.classList.add(shape);

    // Random swing pattern
    const swing = confettiSwings[Math.floor(Math.random() * confettiSwings.length)];
    if (swing) confetti.classList.add(swing);

    // Random color
    const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
    confetti.style.backgroundColor = color;

    // Random horizontal position (spread across the screen)
    confetti.style.left = `${Math.random() * 100}%`;

    // Start from top with some variation
    confetti.style.top = `${-10 + Math.random() * 20}px`;

    // Random size variation
    const size = 4 + Math.random() * 5;
    if (shape !== 'ribbon') {
      confetti.style.width = `${size}px`;
      confetti.style.height = `${size}px`;
    } else {
      confetti.style.width = `${size * 0.5}px`;
      confetti.style.height = `${size * 1.5}px`;
    }

    // Random animation duration (2-4 seconds)
    const duration = 2 + Math.random() * 2;
    confetti.style.animationDuration = `${duration}s`;

    // Stagger the start of each confetti
    confetti.style.animationDelay = `${Math.random() * 0.5}s`;

    container.appendChild(confetti);
  }

  // Clean up confetti after animation completes
  setTimeout(() => {
    container.innerHTML = '';
  }, 4500);
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
  hasRun = true;
  hideHint();
  const code = javascriptGenerator.workspaceToCode(workspace);
  mazeGame.execute(code);
}

/**
 * Reset the maze - shared by main button and fullscreen button.
 */
function resetProgram() {
  mazeGame.reset();
}

// Run button handler
document.getElementById('runButton')?.addEventListener('click', runProgram);

// Reset button handler
document.getElementById('resetButton')?.addEventListener('click', resetProgram);

// Clear workspace button handler
document.getElementById('clearWorkspaceBtn')?.addEventListener('click', () => {
  workspace.clear();
  workspace.scroll(0, 0);
  // Save empty program in coding mode (but not grid coding mode)
  if (!MazeGame.isPracticeModeEnabled() && !isGridCodingMode) {
    saveProgram(mazeGame.getLevel(), workspace);
  }
});

// Populate stage dropdown with letter-based options
populateStageDropdown();

// Initial level display update
updateLevelDisplay();

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
    // Coding mode - use level-specific MAZE_INSTRUCTION_N messages
    levelInstruction.textContent = msg(`MAZE_INSTRUCTION_${level}`);
  }

  // Handle hints visibility
  if (contextualHint) {
    if (displayMode === 'instructions') {
      // Hide hints in instructions-only mode
      contextualHint.textContent = '';
    }
    // In 'both' mode, hints are updated by updateContextualHint()
  }
}

/**
 * Update just the contextual hint portion of the instruction bar.
 */
function updateContextualHint(hintKey: string | null) {
  const levelInstruction = document.getElementById('levelInstruction');
  const contextualHint = document.getElementById('contextualHint');
  if (!contextualHint || !levelInstruction) return;

  // Don't show hints if display mode is not 'both'
  if (displayMode !== 'both') {
    contextualHint.textContent = '';
    levelInstruction.style.display = '';
    return;
  }

  // Hint replaces instruction when present
  if (hintKey) {
    levelInstruction.style.display = 'none';
    contextualHint.textContent = msg(hintKey);
  } else {
    levelInstruction.style.display = '';
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
 * Determine which hint to show based on current level and workspace state.
 * This implements the original blockly-games hint logic.
 */
function levelHelp() {
  // Don't show hints in practice mode - only show the single practice instruction
  if (currentExecutionMode === 'practice') return;

  // Don't show hints while executing
  if (mazeGame.isExecuting()) return;

  const level = mazeGame.getLevel();
  const blocks = workspace.getAllBlocks(false);
  const topBlocks = workspace.getTopBlocks(false);
  const maxBlocks = getMaxBlocksForLevel(level - 1, MazeGame.isPracticeModeEnabled());
  const remaining = workspace.remainingCapacity();

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

  hideHint(); // Clear any existing hint

  // Schedule hint with delay to avoid showing too quickly
  hintTimeout = setTimeout(() => {
    let hintKey: string | null = null;

    switch (level) {
      case 1:
        // Level 1 hints
        if (blocks.length < 2) {
          hintKey = 'MAZE_HINT_STACK';
        } else if (topBlocks.length > 1) {
          hintKey = 'MAZE_HINT_ONE_TOP_BLOCK';
        } else if (!hasRun) {
          hintKey = 'MAZE_HINT_RUN';
        }
        break;

      case 2:
        // Level 2: Hint about resetting after failure
        if (hasRun && lastResult === 'failure') {
          hintKey = 'MAZE_HINT_RESET';
        }
        break;

      case 3:
        // Level 3: Introduces loops (block limit 2)
        if (remaining === 0 && !hasBlockType('maze_forever')) {
          hintKey = 'MAZE_HINT_CAPACITY';
        } else if (!hasBlockType('maze_forever') && remaining > 0) {
          hintKey = 'MAZE_HINT_REPEAT';
        }
        break;

      case 4:
        // Level 4: Multiple blocks in loop
        if (remaining === 0 && (!hasBlockType('maze_forever') || topBlocks.length > 1)) {
          hintKey = 'MAZE_HINT_CAPACITY';
        } else if (hasBlockType('maze_forever')) {
          const foreverBlock = blocks.find(b => b.type === 'maze_forever');
          if (foreverBlock && getNestedBlockCount(foreverBlock) < 2) {
            hintKey = 'MAZE_HINT_REPEAT_MANY';
          }
        }
        break;

      case 5:
        // Level 5: No specific hint (optional skin hint in original)
        break;

      case 6:
        // Level 6: Introduces if block
        if (!hasBlockType('maze_if')) {
          hintKey = 'MAZE_HINT_IF';
        }
        break;

      case 7:
      case 8:
        // Level 7-8: If block with dropdown
        if (hasBlockType('maze_if')) {
          // Check if any if block still has default isPathForward
          const ifBlock = blocks.find(b => b.type === 'maze_if');
          if (ifBlock) {
            const fieldValue = ifBlock.getFieldValue('DIR');
            if (fieldValue === 'isPathForward') {
              hintKey = 'MAZE_HINT_MENU';
            }
          }
        }
        break;

      case 9:
        // Level 9: Introduces ifElse
        if (!hasBlockType('maze_ifElse')) {
          hintKey = 'MAZE_HINT_IF_ELSE';
        }
        break;

      case 10:
        // Level 10: Wall following hint (show once)
        if (!localStorage.getItem('maze_level10_hint_shown')) {
          hintKey = 'MAZE_HINT_WALL_FOLLOW';
          localStorage.setItem('maze_level10_hint_shown', 'true');
        }
        break;
    }

    if (hintKey) {
      showHint(hintKey);
    }
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
});

// ========== RESULT MODAL ==========

const resultModal = document.getElementById('resultModal')!;
const resultModalCard = resultModal.querySelector('.result-modal')!;
const resultModalTitle = document.getElementById('resultModalTitle')!;
const resultModalMessage = document.getElementById('resultModalMessage')!;
const resultModalCancel = document.getElementById('resultModalCancel')!;
const resultModalOk = document.getElementById('resultModalOk')!;
const resultModalProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

// Auto-close timer reference
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

// Track if this is a "next level" prompt (OK advances, Cancel stays)
let isNextLevelPrompt = false;

// Auto-close durations in milliseconds
const AUTO_CLOSE_SUCCESS = 7000; // 7 seconds for success - time to decide on next level
const AUTO_CLOSE_FAILURE = 5000; // 5 seconds for failure/timeout (need to read)

/**
 * Show the result modal with appropriate styling and message.
 * Modal will auto-close after a countdown.
 * For success on non-final levels, shows a "next level" prompt with Cancel/OK.
 */
function showResultModal(type: ResultType): void {
  // Clear any existing timer
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  // Set styling class (success = green accent, failure/timeout = gray)
  resultModalCard.className = 'result-modal ' + (type === 'success' ? 'success' : 'failure');

  // Check if this is a success on a non-final level (show next level prompt)
  const currentLevel = mazeGame.getLevel();
  const maxLevel = MazeGame.getMaxLevel();
  isNextLevelPrompt = type === 'success' && currentLevel < maxLevel;

  // Set title (short phrase)
  if (type === 'success') {
    resultModalTitle.textContent = msg('MAZE_CONGRATULATIONS');
  } else if (type === 'failure') {
    resultModalTitle.textContent = msg('MAZE_FAILURE_TITLE');
  } else if (type === 'timeout') {
    resultModalTitle.textContent = msg('MAZE_TIMEOUT_TITLE');
  } else {
    resultModalTitle.textContent = msg('MAZE_ERROR_TITLE');
  }

  // Set message (detailed explanation)
  if (type === 'success') {
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

  // Set up auto-close countdown
  const duration = type === 'success' ? AUTO_CLOSE_SUCCESS : AUTO_CLOSE_FAILURE;

  // Reset and start progress bar animation
  resultModalOk.classList.remove('countdown');
  // Force reflow to restart animation
  void resultModalOk.offsetWidth;
  resultModalProgress.style.animationDuration = `${duration}ms`;
  resultModalOk.classList.add('countdown');

  // Set auto-close timer - advances to next level if this is a next level prompt
  autoCloseTimer = setTimeout(() => {
    if (isNextLevelPrompt) {
      goToNextLevel();
    }
    hideResultModal();
  }, duration);

  // Show modal and focus OK button
  resultModal.hidden = false;
  resultModalOk.focus();
}

/**
 * Hide the result modal and return focus to the run button.
 */
function hideResultModal(): void {
  // Clear auto-close timer
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  // Stop countdown animation
  resultModalOk.classList.remove('countdown');

  resultModal.hidden = true;
  const runButton = document.getElementById('runButton');
  if (runButton) {
    runButton.focus();
  }
}

// Result modal event handlers

// Cancel button - just close the modal (stay on current level)
resultModalCancel.addEventListener('click', hideResultModal);

// OK button - advance to next level if this is a next level prompt, then close
resultModalOk.addEventListener('click', () => {
  if (isNextLevelPrompt) {
    goToNextLevel();
  }
  hideResultModal();
});

// Keyboard shortcuts
resultModal.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    // Cancel - just close the modal
    e.preventDefault();
    hideResultModal();
  } else if (e.key === 'Enter') {
    // OK - advance if next level prompt, then close
    e.preventDefault();
    if (isNextLevelPrompt) {
      goToNextLevel();
    }
    hideResultModal();
  }
});

// Listen for maze game result events to show the modal
mazeGame.onResult((result: ResultType) => {
  // Save program on successful completion in coding mode (but not grid coding mode)
  if (result === 'success' && !MazeGame.isPracticeModeEnabled() && !isGridCodingMode) {
    saveProgram(mazeGame.getLevel(), workspace);
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

/**
 * Show the graduation modal after completing all practice levels.
 */
function showGraduationModal(): void {
  // Set localized text
  graduationModalTitle.textContent = msg('MAZE_PRACTICE_GRADUATION_TITLE');
  graduationModalMessage.textContent = msg('MAZE_PRACTICE_GRADUATION_MESSAGE');
  graduationTryCoding.textContent = msg('MAZE_PRACTICE_TRY_CODING');
  graduationStay.textContent = msg('MAZE_PRACTICE_STAY');

  // Show modal and focus primary button
  graduationModal.hidden = false;
  graduationTryCoding.focus();
}

/**
 * Hide the graduation modal.
 */
function hideGraduationModal(): void {
  graduationModal.hidden = true;
}

// Graduation modal event handlers
graduationTryCoding.addEventListener('click', () => {
  hideGraduationModal();
  // Switch to coding mode (this will reset to level 1 and use coding mazes)
  setExecutionMode('coding');
});

graduationStay.addEventListener('click', () => {
  hideGraduationModal();
  // Reset to level 1 of practice mode to replay
  mazeGame.setLevel(1);
  updateLevelDisplay();
});

graduationModal.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    // Just dismiss the modal without resetting level
    hideGraduationModal();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // Same as clicking "Try Coding Mode"
    graduationTryCoding.click();
  }
});

// ========== SHORTCUTS INFO MODAL ==========

const shortcutsModal = document.getElementById('shortcutsModal')!;
const shortcutsModalClose = document.getElementById('shortcutsModalClose')!;
const infoBtn = document.getElementById('infoBtn')!;

/**
 * Show the shortcuts info modal.
 */
function showShortcutsModal(): void {
  shortcutsModal.hidden = false;
  shortcutsModalClose.focus();
}

/**
 * Hide the shortcuts info modal.
 */
function hideShortcutsModal(): void {
  shortcutsModal.hidden = true;
}

// Info button click handler
infoBtn.addEventListener('click', showShortcutsModal);

// Close button handler
shortcutsModalClose.addEventListener('click', hideShortcutsModal);

// Keyboard and click-outside handlers
shortcutsModal.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault();
    hideShortcutsModal();
  }
});

shortcutsModal.addEventListener('click', (e: MouseEvent) => {
  // Close when clicking outside the modal card
  if (e.target === shortcutsModal) {
    hideShortcutsModal();
  }
});

// Delete user data button
const deleteUserDataBtn = document.getElementById('deleteUserDataBtn')!;
deleteUserDataBtn.addEventListener('click', () => {
  if (confirm('Delete all saved programs and settings? This cannot be undone.')) {
    // Clear all maze-related localStorage keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('maze')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Reload the page to reset state
    window.location.reload();
  }
});

// ========== GRID MODE SUCCESS ==========

let gridModeCountdownInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Show success message for Grid mode with instruction count and auto-advance.
 */
function showGridModeSuccess(instructionCount: number): void {
  // Get the result modal elements (reuse the existing result modal)
  const resultModal = document.getElementById('resultModal')!;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;
  const modalCard = resultModal.querySelector('.result-modal') as HTMLElement;

  // Set localized text with instruction count
  resultModalTitle.textContent = msg('MAZE_GRID_SUCCESS_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_SUCCESS_MESSAGE', instructionCount);
  okText.textContent = 'OK';

  // Add success styling
  modalCard.classList.add('success');
  modalCard.classList.remove('failure');

  // Hide cancel button
  resultModalCancel.hidden = true;

  // Show modal
  resultModal.hidden = false;
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

  const resultModal = document.getElementById('resultModal')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

  resultModal.hidden = true;
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

let gridModeGraduationTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show completion message for Grid mode after finishing all levels.
 * Simpler than regular graduation modal - just OK with auto-dismiss.
 */
function showGridModeGraduation(): void {
  // Get the result modal elements (reuse the existing result modal)
  const resultModal = document.getElementById('resultModal')!;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;
  const modalCard = resultModal.querySelector('.result-modal') as HTMLElement;

  // Set localized text
  resultModalTitle.textContent = msg('MAZE_GRID_GRADUATION_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_GRADUATION_MESSAGE');
  okText.textContent = 'OK';

  // Add success styling
  modalCard.classList.add('success');
  modalCard.classList.remove('failure');

  // Hide cancel button
  resultModalCancel.hidden = true;

  // Show modal
  resultModal.hidden = false;
  resultModalOk.focus();

  // Start 5 second countdown with progress bar
  const countdownDuration = 5000;
  okProgress.style.animation = `countdown-progress ${countdownDuration}ms linear forwards`;
  resultModalOk.classList.add('countdown');

  gridModeGraduationTimer = setTimeout(() => {
    hideGridModeGraduation();
  }, countdownDuration);

  // Handle OK button click (dismiss immediately)
  const handleOk = () => {
    hideGridModeGraduation();
    resultModalOk.removeEventListener('click', handleOk);
  };
  resultModalOk.addEventListener('click', handleOk);
}

/**
 * Hide the Grid mode graduation modal.
 */
function hideGridModeGraduation(): void {
  // Clear timer
  if (gridModeGraduationTimer) {
    clearTimeout(gridModeGraduationTimer);
    gridModeGraduationTimer = null;
  }

  const resultModal = document.getElementById('resultModal')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

  resultModal.hidden = true;
  resultModalOk.classList.remove('countdown');
  okProgress.style.animation = '';
}

// ========== GRID CODING MODE SUCCESS ==========

let gridCodingCountdownInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Show success message for Grid coding mode with block count and auto-advance.
 */
function showGridCodingSuccess(blockCount: number): void {
  const resultModal = document.getElementById('resultModal')!;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;
  const modalCard = resultModal.querySelector('.result-modal') as HTMLElement;

  // Set text
  resultModalTitle.textContent = msg('MAZE_GRID_CODING_SUCCESS_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_CODING_SUCCESS_MESSAGE', blockCount);
  okText.textContent = msg('MAZE_GRID_CODING_RUN_AGAIN');

  // Add success styling
  modalCard.classList.add('success');
  modalCard.classList.remove('failure');

  // Hide cancel button
  resultModalCancel.hidden = true;

  // Show modal
  resultModal.hidden = false;
  resultModalOk.focus();

  // Start countdown with progress bar
  const countdownDuration = 5000;
  okProgress.style.animation = `countdown-progress ${countdownDuration}ms linear forwards`;
  resultModalOk.classList.add('countdown');

  gridCodingCountdownInterval = setTimeout(() => {
    hideGridCodingSuccess(true);
  }, countdownDuration);

  const handleOk = () => {
    hideGridCodingSuccess(true);
    resultModalOk.removeEventListener('click', handleOk);
  };
  resultModalOk.addEventListener('click', handleOk);
}

/**
 * Hide the Grid coding mode success modal.
 */
function hideGridCodingSuccess(advance: boolean): void {
  if (gridCodingCountdownInterval) {
    clearTimeout(gridCodingCountdownInterval);
    gridCodingCountdownInterval = null;
  }

  const resultModal = document.getElementById('resultModal')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

  resultModal.hidden = true;
  resultModalOk.classList.remove('countdown');
  okProgress.style.animation = '';

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

// ========== GRID CODING MODE GRADUATION ==========

let gridCodingGraduationTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show completion message for Grid coding mode after finishing all simple levels.
 */
function showGridCodingGraduation(blockCount: number): void {
  const resultModal = document.getElementById('resultModal')!;
  const resultModalTitle = document.getElementById('resultModalTitle')!;
  const resultModalMessage = document.getElementById('resultModalMessage')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const resultModalCancel = document.getElementById('resultModalCancel') as HTMLButtonElement;
  const okText = resultModalOk.querySelector('.ok-text') as HTMLElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;
  const modalCard = resultModal.querySelector('.result-modal') as HTMLElement;

  // Set text
  resultModalTitle.textContent = msg('MAZE_GRID_CODING_GRADUATION_TITLE');
  resultModalMessage.textContent = msg('MAZE_GRID_CODING_GRADUATION_MESSAGE', blockCount);
  okText.textContent = 'OK';

  // Add success styling
  modalCard.classList.add('success');
  modalCard.classList.remove('failure');

  // Hide cancel button
  resultModalCancel.hidden = true;

  // Show modal
  resultModal.hidden = false;
  resultModalOk.focus();

  // Start countdown
  const countdownDuration = 5000;
  okProgress.style.animation = `countdown-progress ${countdownDuration}ms linear forwards`;
  resultModalOk.classList.add('countdown');

  gridCodingGraduationTimer = setTimeout(() => {
    hideGridCodingGraduation();
  }, countdownDuration);

  const handleOk = () => {
    hideGridCodingGraduation();
    resultModalOk.removeEventListener('click', handleOk);
  };
  resultModalOk.addEventListener('click', handleOk);
}

/**
 * Hide the Grid coding mode graduation modal.
 */
function hideGridCodingGraduation(): void {
  if (gridCodingGraduationTimer) {
    clearTimeout(gridCodingGraduationTimer);
    gridCodingGraduationTimer = null;
  }

  const resultModal = document.getElementById('resultModal')!;
  const resultModalOk = document.getElementById('resultModalOk') as HTMLButtonElement;
  const okProgress = resultModalOk.querySelector('.ok-progress') as HTMLElement;

  resultModal.hidden = true;
  resultModalOk.classList.remove('countdown');
  okProgress.style.animation = '';
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

  // Resize Blockly workspace to fit new layout after a short delay
  // (allows CSS to be applied first)
  setTimeout(() => {
    Blockly.svgResize(workspace);
    // Scroll workspace to origin where blocks will be placed
    workspace.scroll(0, 0);
  }, 100);
}

// Initialize Grid coding mode if active
initializeGridCodingMode();

// Hide level label when viewport is too small (works regardless of zoom level)
function checkGridModeLevelVisibility(): void {
  if (!isGridMode) return;

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

// Check on load and when window resizes
checkGridModeLevelVisibility();
window.addEventListener('resize', checkGridModeLevelVisibility);

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

// ========== LEVEL TRANSITION ==========

let isTransitioning = false;

/**
 * Perform a level transition with fade effect and level banner.
 * @param newLevel The level to transition to
 * @param showBanner Whether to show the level banner (true for next, false for previous)
 */
function performLevelTransition(newLevel: number, showBanner: boolean = true) {
  if (isTransitioning) return;
  isTransitioning = true;

  // Save current level's program before transitioning (coding mode only, not grid coding mode)
  // This ensures empty programs are saved when user clears all blocks
  if (!MazeGame.isPracticeModeEnabled() && !isGridCodingMode) {
    saveProgram(mazeGame.getLevel(), workspace);
  }

  const canvasWrapper = document.querySelector('.canvas-wrapper') as HTMLElement;
  const levelBanner = document.getElementById('levelBanner');
  const levelNumber = levelBanner?.querySelector('.level-number');

  // Update the level banner text
  if (levelNumber) {
    levelNumber.textContent = formatLevelLabel(newLevel, MazeGame.isPracticeModeEnabled());
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
    }, 300);
  }, 300); // Fade out duration
}

// ========== GLOBAL KEYBOARD SHORTCUTS ==========

/**
 * Go to previous level (shared by button and keyboard shortcut).
 */
function goToPreviousLevel() {
  if (isTransitioning) return;
  const currentLevel = mazeGame.getLevel();
  if (currentLevel > 1) {
    const newLevel = currentLevel - 1;
    performLevelTransition(newLevel, true);
  }
}

/**
 * Go to next level (shared by button and keyboard shortcut).
 * Shows graduation modal if at last practice level.
 */
function goToNextLevel() {
  if (isTransitioning) return;
  const currentLevel = mazeGame.getLevel();
  const maxLevel = MazeGame.getMaxLevel();
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
 * Global keyboard shortcuts for quick navigation and actions.
 * These work from anywhere on the page.
 *
 * Shortcuts:
 * - Ctrl+Alt+1: Jump to workspace
 * - Ctrl+Alt+2: Jump to toolbox
 * - Ctrl+Alt+R: Run the program (alternative)
 * - H: Toggle instruction bar display mode
 * - [: Previous level
 * - ]: Next level
 * - R: Run the program
 * - F: Toggle fullscreen mode
 * - G: Toggle game panel/sidebar
 * - ,: Previous character
 * - .: Next character
 * - L: Cycle language
 * - Esc: Exit fullscreen mode
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

  // R: Run the program in coding mode (no modifiers)
  // In practice mode, R is handled by the practice mode controller for reset
  if (e.key === 'r' || e.key === 'R') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      if (currentExecutionMode === 'coding') {
        e.preventDefault();
        e.stopPropagation();
        runProgram();
        return;
      }
      // Let practice mode controller handle R for reset
    }
  }

  // F: Toggle fullscreen mode (no modifiers)
  if (e.key === 'f' || e.key === 'F') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen();
      return;
    }
  }

  // G: Toggle game panel/sidebar (no modifiers)
  if (e.key === 'g' || e.key === 'G') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
      return;
    }
  }

  // ,: Previous character (no modifiers)
  if (e.key === ',') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      cycleCharacterPrevious();
      return;
    }
  }

  // .: Next character (no modifiers)
  if (e.key === '.') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
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

  // M: Toggle mute (no modifiers)
  if (e.key === 'm' || e.key === 'M') {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSound();
      return;
    }
  }

  // Escape: Exit fullscreen mode
  if (e.key === 'Escape') {
    if (isFullscreenActive()) {
      e.preventDefault();
      e.stopPropagation();
      exitFullscreen();
      return;
    }
  }
}, true); // Use capture phase to handle before Blockly

// ========== FULLSCREEN MODE ==========

let fullscreenActive = false;
const fullscreenOverlay = document.getElementById('fullscreenOverlay');
const canvasWrapper = document.querySelector('.canvas-wrapper') as HTMLElement;
const mazeCanvas = document.getElementById('mazeCanvas') as HTMLCanvasElement;
const fullscreenCanvasContainer = document.querySelector('.fullscreen-canvas-container') as HTMLElement;

// Store focusable elements for focus trap
let previouslyFocusedElement: HTMLElement | null = null;

/**
 * Check if fullscreen mode is active.
 */
function isFullscreenActive(): boolean {
  return fullscreenActive;
}

/**
 * Toggle fullscreen mode.
 */
function toggleFullscreen() {
  if (fullscreenActive) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
}

/**
 * Enter fullscreen mode.
 */
function enterFullscreen() {
  if (!fullscreenOverlay || !mazeCanvas || !fullscreenCanvasContainer || !canvasWrapper) return;

  // Store the currently focused element to restore later
  previouslyFocusedElement = document.activeElement as HTMLElement;

  // Move the canvas to the fullscreen overlay
  fullscreenCanvasContainer.appendChild(mazeCanvas);

  // Show the overlay
  fullscreenOverlay.classList.add('active');
  document.body.classList.add('fullscreen-active');
  fullscreenActive = true;

  // Set inert on all background content for proper modal behavior
  document.querySelectorAll('body > *:not(#fullscreenOverlay):not(#snowContainer)').forEach(el => {
    (el as HTMLElement).inert = true;
  });

  // Update button states
  updateFullscreenLevelButtons();

  // Focus the close button for accessibility
  const closeButton = fullscreenOverlay.querySelector('.fullscreen-close') as HTMLElement;
  if (closeButton) {
    closeButton.focus();
  }
}

/**
 * Exit fullscreen mode.
 */
function exitFullscreen() {
  if (!fullscreenOverlay || !mazeCanvas || !canvasWrapper) return;

  // Move the canvas back to the original location
  canvasWrapper.appendChild(mazeCanvas);

  // Hide the overlay
  fullscreenOverlay.classList.remove('active');
  document.body.classList.remove('fullscreen-active');
  fullscreenActive = false;

  // Remove inert from background content
  document.querySelectorAll('body > *:not(#fullscreenOverlay):not(#snowContainer)').forEach(el => {
    (el as HTMLElement).inert = false;
  });

  // Restore focus to the previously focused element
  if (previouslyFocusedElement) {
    previouslyFocusedElement.focus();
  }
}

/**
 * Update fullscreen level navigation button states.
 */
function updateFullscreenLevelButtons() {
  const currentLevel = mazeGame.getLevel();
  const maxLevel = MazeGame.getMaxLevel();

  const prevButton = fullscreenOverlay?.querySelector('.fullscreen-prev') as HTMLButtonElement;
  const nextButton = fullscreenOverlay?.querySelector('.fullscreen-next') as HTMLButtonElement;

  if (prevButton) {
    prevButton.disabled = currentLevel <= 1;
  }
  if (nextButton) {
    // In practice mode, keep enabled on last level to show graduation modal
    nextButton.disabled = currentLevel >= maxLevel && !MazeGame.isPracticeModeEnabled();
  }
}

// Wire up fullscreen overlay buttons
if (fullscreenOverlay) {
  // Close button
  const closeButton = fullscreenOverlay.querySelector('.fullscreen-close');
  closeButton?.addEventListener('click', exitFullscreen);

  // Run button - uses shared runProgram()
  const fsRunButton = fullscreenOverlay.querySelector('.fullscreen-run');
  fsRunButton?.addEventListener('click', runProgram);

  // Reset button - uses shared resetProgram()
  const fsResetButton = fullscreenOverlay.querySelector('.fullscreen-reset');
  fsResetButton?.addEventListener('click', resetProgram);

  // Previous level button
  const prevButton = fullscreenOverlay.querySelector('.fullscreen-prev');
  prevButton?.addEventListener('click', () => {
    goToPreviousLevel();
    updateFullscreenLevelButtons();
  });

  // Next level button
  const nextButton = fullscreenOverlay.querySelector('.fullscreen-next');
  nextButton?.addEventListener('click', () => {
    goToNextLevel();
    updateFullscreenLevelButtons();
  });

  // Focus trap - keep focus within the overlay
  fullscreenOverlay.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusableElements = fullscreenOverlay.querySelectorAll(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) as NodeListOf<HTMLElement>;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  });
}

// ========== COMPACT MODE ==========

const gameContainer = document.querySelector('.game-container') as HTMLElement;

/**
 * Check if compact mode should be enabled based on available space.
 * Compact mode overlays the level navigation buttons on the canvas
 * instead of showing them above it, saving vertical space.
 */
function checkCompactMode() {
  if (!gameContainer) return;

  // Enable compact mode when window height is limited.
  // 700px accommodates: header (~60px) + instruction bar (~40px) + canvas (~400px) +
  // controls (~80px) + level selector (~50px) + padding (~70px) = ~700px minimum
  const windowHeight = window.innerHeight;
  const compactThreshold = 700;

  if (windowHeight < compactThreshold) {
    gameContainer.classList.add('compact');
  } else {
    gameContainer.classList.remove('compact');
  }
}

// Check compact mode on load and resize
checkCompactMode();
window.addEventListener('resize', checkCompactMode);

// ========== COLLAPSIBLE SIDEBAR ==========

const mainContainer = document.querySelector('.container') as HTMLElement;
const sidebarToggle = document.getElementById('sidebarToggle');
let sidebarCollapsed = false;
let userManuallyToggled = false; // Track if user manually toggled to prevent auto-collapse fighting
let weTriggeredChange = false; // Track if we triggered the size change (vs external zoom/resize)

/**
 * Collapse the sidebar (game panel).
 */
function collapseSidebar() {
  if (!mainContainer) return;
  weTriggeredChange = true;
  mainContainer.classList.add('sidebar-collapsed');
  sidebarCollapsed = true;
  // Trigger Blockly resize and width check after transition
  setTimeout(() => {
    Blockly.svgResize(workspace);
    checkBlocklyWidth();
    weTriggeredChange = false;
  }, 400);
}

/**
 * Expand the sidebar (game panel).
 */
function expandSidebar() {
  if (!mainContainer) return;
  weTriggeredChange = true;
  mainContainer.classList.remove('sidebar-collapsed');
  sidebarCollapsed = false;
  // Trigger Blockly resize and width check after transition
  setTimeout(() => {
    Blockly.svgResize(workspace);
    checkBlocklyWidth();
    weTriggeredChange = false;
  }, 400);
}

/**
 * Toggle the sidebar collapsed state.
 */
function toggleSidebar() {
  userManuallyToggled = true;
  if (sidebarCollapsed) {
    expandSidebar();
  } else {
    collapseSidebar();
  }
}

// Wire up toggle button
sidebarToggle?.addEventListener('click', toggleSidebar);

// ========== NARROW BLOCKLY DETECTION ==========

const blocklyContainer = document.querySelector('.blockly-container') as HTMLElement;

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

// ========== AUTO-COLLAPSE BASED ON RELATIVE SIZE ==========

/**
 * Check if sidebar should auto-collapse based on available space.
 * Uses hysteresis (different thresholds for collapse/expand) to prevent oscillation.
 * Only responds to external changes (zoom/resize), not our own collapse/expand.
 */
function checkSizeAndAutoCollapse() {
  if (userManuallyToggled) return; // Respect user's manual choice
  if (weTriggeredChange) return; // Ignore size changes we caused
  if (!mainContainer || !gameContainer) return;

  // Get the game container's min-width from CSS (the space it needs)
  const gameMinWidth = parseFloat(getComputedStyle(gameContainer).minWidth) || 450;
  const containerWidth = mainContainer.offsetWidth;

  // Calculate how much space blockly would get
  const blocklySpace = containerWidth - gameMinWidth;

  // Collapse when blockly would get less space than the game panel
  // Expand when blockly would get more space than the game panel
  if (!sidebarCollapsed && blocklySpace <= gameMinWidth) {
    collapseSidebar();
  } else if (sidebarCollapsed && blocklySpace > gameMinWidth) {
    expandSidebar();
  }
}

/**
 * Handle size changes detected by ResizeObserver.
 * More efficient than polling - only runs when sizes actually change.
 */
function handleSizeChange() {
  checkSizeAndAutoCollapse();
  checkBlocklyWidth();
}

// Use ResizeObserver for efficient size change detection
// This handles browser zoom, layout changes, and element resizes without continuous polling
const resizeObserver = new ResizeObserver(handleSizeChange);

// Observe the main container for size changes (catches zoom and resize)
if (mainContainer) {
  resizeObserver.observe(mainContainer);
}

// Check on load
checkSizeAndAutoCollapse();
checkBlocklyWidth();
