/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Blockly themes for the maze game.
 *
 * Blocks reference styles by name (`style: 'movement_blocks'` etc.) in
 * blocks.ts; the active theme supplies the actual colours. Swap themes at
 * runtime via workspace.setTheme(...).
 */

import * as Blockly from 'blockly/core';

// String form is the required type for Theme blockStyles.colourPrimary in
// Blockly 12; the renderer parses it back to a numeric HSV hue.
const MOVEMENT_HUE = '290';
const LOOPS_HUE = '120';
const LOGIC_HUE = '210';

export const defaultTheme = Blockly.Theme.defineTheme('maze-default', {
  name: 'maze-default',
  base: Blockly.Themes.Classic,
  blockStyles: {
    movement_blocks: {colourPrimary: MOVEMENT_HUE},
    loop_blocks: {colourPrimary: LOOPS_HUE},
    logic_blocks: {colourPrimary: LOGIC_HUE},
  },
});

const HC_WHITE = {
  colourPrimary: '#ffffff',
  colourSecondary: '#f2f2f2',
  colourTertiary: '#111111',
};

export const highContrastTheme = Blockly.Theme.defineTheme('maze-high-contrast', {
  name: 'maze-high-contrast',
  base: Blockly.Themes.Classic,
  blockStyles: {
    movement_blocks: HC_WHITE,
    loop_blocks: HC_WHITE,
    logic_blocks: HC_WHITE,
  },
});

export type ThemeId = 'default' | 'high-contrast';

export function themeFor(id: ThemeId): Blockly.Theme {
  return id === 'high-contrast' ? highContrastTheme : defaultTheme;
}
