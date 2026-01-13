/**
 * @license
 * Copyright 2012 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Blocks for Maze game.
 * Adapted from blockly-games for use with modern Blockly and keyboard navigation.
 */

import * as Blockly from 'blockly/core';
import {javascriptGenerator, Order} from 'blockly/javascript';

/**
 * Counterclockwise arrow to be appended to left turn option.
 */
const LEFT_TURN = ' ↺';

/**
 * Clockwise arrow to be appended to right turn option.
 */
const RIGHT_TURN = ' ↻';

/**
 * Straight arrow for move forward.
 */
const MOVE_FORWARD = ' ↑';

/**
 * Common HSV hue for all movement blocks.
 */
const MOVEMENT_HUE = 290;

/**
 * HSV hue for loop block.
 */
const LOOPS_HUE = 120;

/**
 * Common HSV hue for all logic blocks.
 */
const LOGIC_HUE = 210;

/**
 * Skin ID for wheelchair character.
 */
const WHEELCHAIR_SKIN_ID = 1;

/**
 * Current skin ID (updated via setCurrentSkin).
 */
let currentSkinId = 0;

/**
 * Set the current skin ID and update all moveForward block icons.
 * Call this when the character/skin changes.
 */
export function setCurrentSkin(skinId: number, workspace?: Blockly.Workspace) {
  currentSkinId = skinId;
  if (workspace) {
    // Update all moveForward blocks on the workspace
    const blocks = workspace.getBlocksByType('maze_moveForward', false);
    blocks.forEach((block) => {
      const imageField = block.getField('ICON') as Blockly.FieldImage;
      if (imageField) {
        const newSrc =
          skinId === WHEELCHAIR_SKIN_ID
            ? 'assets/wheel_forward.svg'
            : 'assets/steps.svg';
        imageField.setValue(newSrc);
      }
    });
  }
}

/**
 * Get the appropriate forward icon based on current skin.
 */
function getForwardIconSrc(): string {
  return currentSkinId === WHEELCHAIR_SKIN_ID
    ? 'assets/wheel_forward.svg'
    : 'assets/steps.svg';
}

/**
 * Register maze blocks with Blockly.
 */
export function registerMazeBlocks() {
  // Turn directions use images in the dropdown
  const TURN_DIRECTIONS: Blockly.MenuOption[] = [
    [{src: 'assets/turn_left.svg', width: 24, height: 24, alt: 'left'}, 'turnLeft'],
    [{src: 'assets/turn_right.svg', width: 24, height: 24, alt: 'right'}, 'turnRight'],
  ];

  const PATH_DIRECTIONS: Blockly.MenuOption[] = [
    ['%{BKY_MAZE_PATH_AHEAD}', 'isPathForward'],
    ['%{BKY_MAZE_PATH_LEFT}', 'isPathLeft'],
    ['%{BKY_MAZE_PATH_RIGHT}', 'isPathRight'],
  ];

  const COLOR_OPTIONS: Blockly.MenuOption[] = [
    ['%{BKY_MAZE_COLOR_RED}', 'red'],
    ['%{BKY_MAZE_COLOR_BLUE}', 'blue'],
  ];

  const REPEAT_COUNT_OPTIONS: Blockly.MenuOption[] = [
    ['2', '2'],
    ['3', '3'],
    ['4', '4'],
    ['5', '5'],
  ];

  // Extension to initialize forward block icon based on current skin
  Blockly.Extensions.register(
    'maze_forward_icon_init',
    function (this: Blockly.Block) {
      const imageField = this.getField('ICON') as Blockly.FieldImage;
      if (imageField) {
        imageField.setValue(getForwardIconSrc());
      }
    },
  );

  Blockly.defineBlocksWithJsonArray([
    // Block for moving forward.
    {
      type: 'maze_moveForward',
      message0: '%{BKY_MAZE_MOVE_FORWARD} %1',
      args0: [
        {
          type: 'field_image',
          src: 'assets/steps.svg',
          width: 24,
          height: 28,
          name: 'ICON',
          alt: 'forward',
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: MOVEMENT_HUE,
      tooltip: '%{BKY_MAZE_MOVE_FORWARD_TOOLTIP}',
      extensions: ['maze_forward_icon_init'],
    },

    // Block for turning left or right.
    {
      type: 'maze_turn',
      message0: '%{BKY_MAZE_TURN} %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DIR',
          options: TURN_DIRECTIONS,
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: MOVEMENT_HUE,
      tooltip: '%{BKY_MAZE_TURN_TOOLTIP}',
    },

    // Block for conditional "if there is a path".
    {
      type: 'maze_if',
      message0: '%1%2%{BKY_MAZE_DO} %3',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DIR',
          options: PATH_DIRECTIONS,
        },
        {
          type: 'input_dummy',
        },
        {
          type: 'input_statement',
          name: 'DO',
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: LOGIC_HUE,
      tooltip: '%{BKY_MAZE_IF_TOOLTIP}',
    },

    // Block for conditional "if there is a path, else".
    {
      type: 'maze_ifElse',
      message0: '%1%2%{BKY_MAZE_DO} %3%{BKY_MAZE_ELSE} %4',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DIR',
          options: PATH_DIRECTIONS,
        },
        {
          type: 'input_dummy',
        },
        {
          type: 'input_statement',
          name: 'DO',
        },
        {
          type: 'input_statement',
          name: 'ELSE',
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: LOGIC_HUE,
      tooltip: '%{BKY_MAZE_IFELSE_TOOLTIP}',
    },

    // Block for repeat loop.
    {
      type: 'maze_forever',
      message0: '%{BKY_MAZE_REPEAT_UNTIL} %1%2%{BKY_MAZE_DO} %3',
      args0: [
        {
          type: 'field_image',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAiCAYAAABfqvm9AAAABGdBTUEAAK/INwWK6QAAAxFJREFUSMetlktME2EQx5dHBaE8rAgULFBoQRA1QQVBCopQg0ahajSlB0EoEWhpiw8UH0g8kAgioCcvmBhPHo0XD3jwrIlRYmLiRUAjFIOPSEzIjv8pLdIXj5ZJfkmz3+6vOzvfzK4g+I900AiGwSMnD0AzyBLWEFGgB0xFSyRUKE+ikzlZdArsS0km6QYJYW0G9IKYlWRK8Foujaa+gyU00XpWpKtmkW5YyQF+f2mrF4cOaUgRI2Xxe7DNn0wFxrUZCrJbGkXq7iDqaifqbHOny0y8NmtrphqVkqXfQL6nbCN4c1ipoL+dJqJrPkSe4Jx5yHXqTJZ+ALFLhd2pSHPKahRXJVu823aavXBezIyPZWmfSyYHnwcqSx2prFrmAtc8rK5g4ZSzBoI+ShJOE6YGfuhuJ0+21VP3/r2UlyBzwL/5mJsQ19iR2abICJY2sbB/d3KizwKwAOtu8DGvu7xuoTJFCq8PsnDkuFqJbWHzOpHvylPIx7yEN21Ul5fN6yMOYQ0qxQeDERq25ywKB/bIg03ZSuVpqbw+xMI6brFJ87kAi2KiGdtiUYwsTAWT97XlgW0bpDtytJJldme3OeLWVmxsu61Z9Nlufje2mX5ebBFV8XEs7F/aKVIwVotqz/Mw8EjdJ0gVfy46q/sJyDz7OYdT1+eq0acWoium5YUohHFXHsumwU5/E6cA/OgpLcKz6Vi23Yarylg2BzQrzcQzIdgeLw0nFmag15Sx0DujQYwKD2dh62qn9uP8LZtp7nKr6JU6hEcy01k2upbXQAaYvVepce8gPLfnp4+5NnmJsMa4o8Sc+3Op5f9dYgholWkseyYEEArw66mueuFZYn+OGQ0UGhLCQq0QYDxxDA4WIvUeTRHL3gpBhE4WGUnfrUZHuoUpSSy8HYwwgYszqq+laUsTRYSFsbBYCDJe3a0opVG9jmVfQXSwwsGGHbnUe6CYhS+EdQijBu8L/hzxnCiBhjY9LoayZfHk/HgKOgo2hIW6ClK1HkI1EJ3tVrQewkTw2ylUrYcwAnwE4yBupZP/ASesGLIiyjDFAAAAAElFTkSuQmCC',
          width: 12,
          height: 16,
        },
        {
          type: 'input_dummy',
        },
        {
          type: 'input_statement',
          name: 'DO',
        },
      ],
      previousStatement: null,
      colour: LOOPS_HUE,
      tooltip: '%{BKY_MAZE_WHILE_TOOLTIP}',
    },

    // Block for repeat N times loop (Stage 2).
    {
      type: 'maze_repeatTimes',
      message0: '%{BKY_MAZE_REPEAT} %1 %{BKY_MAZE_TIMES}%2%{BKY_MAZE_DO} %3',
      args0: [
        {
          type: 'field_dropdown',
          name: 'TIMES',
          options: REPEAT_COUNT_OPTIONS,
        },
        {
          type: 'input_dummy',
        },
        {
          type: 'input_statement',
          name: 'DO',
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: LOOPS_HUE,
      tooltip: '%{BKY_MAZE_REPEAT_TIMES_TOOLTIP}',
    },

    // Block for color conditional (Stage 4).
    {
      type: 'maze_ifColor',
      message0: '%{BKY_MAZE_IF_ON} %1%2%{BKY_MAZE_DO} %3',
      args0: [
        {
          type: 'field_dropdown',
          name: 'COLOR',
          options: COLOR_OPTIONS,
        },
        {
          type: 'input_dummy',
        },
        {
          type: 'input_statement',
          name: 'DO',
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: LOGIC_HUE,
      tooltip: '%{BKY_MAZE_IF_COLOR_TOOLTIP}',
    },

    // Block for color conditional with else (Stage 6).
    {
      type: 'maze_ifColorElse',
      message0: '%{BKY_MAZE_IF_ON} %1%2%{BKY_MAZE_DO} %3%{BKY_MAZE_ELSE} %4',
      args0: [
        {
          type: 'field_dropdown',
          name: 'COLOR',
          options: COLOR_OPTIONS,
        },
        {
          type: 'input_dummy',
        },
        {
          type: 'input_statement',
          name: 'DO',
        },
        {
          type: 'input_statement',
          name: 'ELSE',
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: LOGIC_HUE,
      tooltip: '%{BKY_MAZE_IF_COLOR_ELSE_TOOLTIP}',
    },
  ]);

  // JavaScript code generators
  // DON'T use await - just call the functions directly
  // They will queue the animations internally
  javascriptGenerator.forBlock['maze_moveForward'] = function (block) {
    return `moveForward('block_id_${block.id}'); //${MOVE_FORWARD}\n`;
  };

  javascriptGenerator.forBlock['maze_turn'] = function (block) {
    const dir = block.getFieldValue('DIR');
    if (dir === 'turnLeft') {
      return `turnLeft('block_id_${block.id}');    //${LEFT_TURN}\n`;
    } else {
      return `turnRight('block_id_${block.id}');   //${RIGHT_TURN}\n`;
    }
  };

  javascriptGenerator.forBlock['maze_if'] = function (block) {
    const argument = `${block.getFieldValue('DIR')}('block_id_${block.id}')`;
    const branch = javascriptGenerator.statementToCode(block, 'DO');
    return `if (${argument}) {\n${branch}}\n`;
  };

  javascriptGenerator.forBlock['maze_ifElse'] = function (block) {
    const argument = `${block.getFieldValue('DIR')}('block_id_${block.id}')`;
    const branch0 = javascriptGenerator.statementToCode(block, 'DO');
    const branch1 = javascriptGenerator.statementToCode(block, 'ELSE');
    return `if (${argument}) {\n${branch0}} else {\n${branch1}}\n`;
  };

  javascriptGenerator.forBlock['maze_forever'] = function (block) {
    const branch = javascriptGenerator.statementToCode(block, 'DO');
    if (branch) {
      return 'while (notDone()) {\n' + branch + '}\n';
    } else {
      return 'while (notDone()) {}\n';
    }
  };

  javascriptGenerator.forBlock['maze_repeatTimes'] = function (block) {
    const times = block.getFieldValue('TIMES');
    const branch = javascriptGenerator.statementToCode(block, 'DO');
    return `for (var count = 0; count < ${times}; count++) {\n${branch}}\n`;
  };

  javascriptGenerator.forBlock['maze_ifColor'] = function (block) {
    const color = block.getFieldValue('COLOR');
    const branch = javascriptGenerator.statementToCode(block, 'DO');
    const functionName = color === 'red' ? 'isOnRed' : 'isOnBlue';
    return `if (${functionName}('block_id_${block.id}')) {\n${branch}}\n`;
  };

  javascriptGenerator.forBlock['maze_ifColorElse'] = function (block) {
    const color = block.getFieldValue('COLOR');
    const branch0 = javascriptGenerator.statementToCode(block, 'DO');
    const branch1 = javascriptGenerator.statementToCode(block, 'ELSE');
    const functionName = color === 'red' ? 'isOnRed' : 'isOnBlue';
    return `if (${functionName}('block_id_${block.id}')) {\n${branch0}} else {\n${branch1}}\n`;
  };
}
