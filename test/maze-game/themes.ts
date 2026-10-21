/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Blockly themes for the maze game.
 *
 * Blocks reference styles by name (`style: 'movement_blocks'` etc.) in
 * blocks.ts; the active theme supplies the actual colours. Three themes
 * are defined, keyed to the page's effective theme (see theme.ts):
 *
 *  - defaultTheme: brand-hue block colours; Zelos defaults for chrome.
 *  - darkTheme:    same block hues, dark workspace / toolbox / flyout
 *                  chrome with amber accents.
 *  - highContrastTheme: white block bodies with dark label text (text
 *                  colours forced via maze.css under [data-theme=hc]),
 *                  black workspace with yellow accents.
 *
 * index.ts calls `workspace.setTheme(themeFor(effective))` on initial
 * inject and whenever the user changes theme, so block colours stay in
 * lockstep with page chrome.
 */

import * as Blockly from 'blockly/core';

// String form is the required type for Theme blockStyles.colourPrimary in
// Blockly 12; the renderer parses it back to a numeric HSV hue.
const MOVEMENT_HUE = '290';
const LOOPS_HUE = '120';
const LOGIC_HUE = '210';

const DEFAULT_BLOCK_STYLES = {
  movement_blocks: {colourPrimary: MOVEMENT_HUE},
  loop_blocks: {colourPrimary: LOOPS_HUE},
  logic_blocks: {colourPrimary: LOGIC_HUE},
};

const HC_WHITE = {
  colourPrimary: '#ffffff',
  colourSecondary: '#f2f2f2',
  colourTertiary: '#111111',
};

const HC_BLOCK_STYLES = {
  movement_blocks: HC_WHITE,
  loop_blocks: HC_WHITE,
  logic_blocks: HC_WHITE,
};

export const defaultTheme = Blockly.Theme.defineTheme('maze-default', {
  name: 'maze-default',
  base: Blockly.Themes.Zelos,
  blockStyles: DEFAULT_BLOCK_STYLES,
});

export const darkTheme = Blockly.Theme.defineTheme('maze-dark', {
  name: 'maze-dark',
  base: Blockly.Themes.Zelos,
  blockStyles: DEFAULT_BLOCK_STYLES,
  componentStyles: {
    workspaceBackgroundColour: '#121212',
    toolboxBackgroundColour: '#1e1e1e',
    toolboxForegroundColour: '#e8e8e8',
    flyoutBackgroundColour: '#2a2a2a',
    flyoutForegroundColour: '#e8e8e8',
    flyoutOpacity: 1,
    scrollbarColour: '#555555',
    scrollbarOpacity: 1.0,
    insertionMarkerColour: '#ff8f00',
    insertionMarkerOpacity: 0.9,
    cursorColour: '#ff8f00',
    selectedGlowColour: '#ff8f00',
    selectedGlowOpacity: 0.9,
    replacementGlowColour: '#ff8f00',
    replacementGlowOpacity: 0.9,
  },
});

export const highContrastTheme = Blockly.Theme.defineTheme('maze-high-contrast', {
  name: 'maze-high-contrast',
  base: Blockly.Themes.Zelos,
  blockStyles: HC_BLOCK_STYLES,
  componentStyles: {
    workspaceBackgroundColour: '#000000',
    toolboxBackgroundColour: '#000000',
    toolboxForegroundColour: '#ffffff',
    flyoutBackgroundColour: '#1a1a1a',
    flyoutForegroundColour: '#ffffff',
    flyoutOpacity: 1,
    // Muted grey scrollbar — the workspace rarely needs scrolling, so a
    // high-saturation yellow bar was distracting without benefit. #595959
    // is the minimum grey that clears WCAG 3:1 contrast against the
    // black workspace bg for non-text UI (3.00:1).
    scrollbarColour: '#595959',
    scrollbarOpacity: 1.0,
    insertionMarkerColour: '#ffff00',
    insertionMarkerOpacity: 0.9,
    cursorColour: '#ffff00',
    // The keyboard-navigation plugin draws an orange focus stroke around
    // the selected block; Blockly's own selected-glow in HC reads as a
    // redundant extra rectangle. Zero the opacity so the plugin's stroke
    // stands alone as the selection indicator.
    selectedGlowOpacity: 0,
    replacementGlowColour: '#ffff00',
    replacementGlowOpacity: 0.9,
  },
});

export type ThemeId = 'default' | 'dark' | 'high-contrast';

export function themeFor(id: ThemeId): Blockly.Theme {
  switch (id) {
    case 'high-contrast':
      return highContrastTheme;
    case 'dark':
      return darkTheme;
    default:
      return defaultTheme;
  }
}
