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
 * Shared hue for all dance-party blocks (warm magenta/pink).
 */
const DANCE_HUE = 320;

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
    const newSrc =
      skinId === WHEELCHAIR_SKIN_ID
        ? 'assets/wheel_forward.svg'
        : 'assets/steps.svg';

    // Update all moveForward blocks on the workspace
    const blocks = workspace.getBlocksByType('maze_moveForward', false);
    blocks.forEach((block) => {
      const imageField = block.getField('ICON') as Blockly.FieldImage;
      if (imageField) {
        imageField.setValue(newSrc);
      }
    });

    // Also update blocks in the toolbox flyout
    const svgWorkspace = workspace as Blockly.WorkspaceSvg;
    // Try both: simple flyout (getFlyout on workspace) and category flyout (via toolbox)
    const flyout = svgWorkspace.getFlyout() || svgWorkspace.getToolbox()?.getFlyout();
    if (flyout) {
      const flyoutWorkspace = flyout.getWorkspace();
      const flyoutBlocks = flyoutWorkspace.getBlocksByType('maze_moveForward', false);
      flyoutBlocks.forEach((block) => {
        const imageField = block.getField('ICON') as Blockly.FieldImage;
        if (imageField) {
          imageField.setValue(newSrc);
        }
      });
    }
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
    [{src: 'assets/red_circle.svg', width: 24, height: 24, alt: 'red circle'}, 'red'],
    [{src: 'assets/blue_square.svg', width: 24, height: 24, alt: 'blue square'}, 'blue'],
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

    // Dance party blocks — no-field moves.
    {
      type: 'dance_clap',
      message0: '%{BKY_MAZE_DANCE_CLAP}',
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_CLAP_TOOLTIP}',
    },
    {
      type: 'dance_spin',
      message0: '%{BKY_MAZE_DANCE_SPIN}',
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_SPIN_TOOLTIP}',
    },
    {
      type: 'dance_jump',
      message0: '%{BKY_MAZE_DANCE_JUMP}',
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_JUMP_TOOLTIP}',
    },
    {
      type: 'dance_wiggle',
      message0: '%{BKY_MAZE_DANCE_WIGGLE}',
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_WIGGLE_TOOLTIP}',
    },
    {
      type: 'dance_bow',
      message0: '%{BKY_MAZE_DANCE_BOW}',
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_BOW_TOOLTIP}',
    },

    // Dance party blocks — one-dropdown moves.
    // Dropdown VALUES (right column) stay English — they're the stable API used
    // by the generator (e.g. danceLike("robot")). Only the display text is i18n'd.
    {
      type: 'dance_like_a',
      message0: '%{BKY_MAZE_DANCE_LIKE_A} %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MOVE',
          options: [
            ['%{BKY_MAZE_DANCE_OPTION_ROBOT}', 'robot'],
            ['%{BKY_MAZE_DANCE_OPTION_CHICKEN}', 'chicken'],
            ['%{BKY_MAZE_DANCE_OPTION_JELLYFISH}', 'jellyfish'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_LIKE_A_TOOLTIP}',
    },
    {
      type: 'dance_pull_face',
      message0: '%{BKY_MAZE_DANCE_PULL_FACE_PREFIX} %1 %{BKY_MAZE_DANCE_PULL_FACE_SUFFIX}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MOVE',
          options: [
            ['%{BKY_MAZE_DANCE_OPTION_SILLY}', 'silly'],
            ['%{BKY_MAZE_DANCE_OPTION_SCARY}', 'scary'],
            ['%{BKY_MAZE_DANCE_OPTION_SURPRISED}', 'surprised'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_PULL_FACE_TOOLTIP}',
    },
    {
      type: 'dance_make_noise',
      message0: '%{BKY_MAZE_DANCE_MAKE_NOISE_PREFIX} %1 %{BKY_MAZE_DANCE_MAKE_NOISE_SUFFIX}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MOVE',
          options: [
            ['%{BKY_MAZE_DANCE_OPTION_MOO}', 'moo'],
            ['%{BKY_MAZE_DANCE_OPTION_BEEP}', 'beep'],
            ['%{BKY_MAZE_DANCE_OPTION_ROAR}', 'roar'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_MAKE_NOISE_TOOLTIP}',
    },
    {
      type: 'dance_strike_pose',
      message0: '%{BKY_MAZE_DANCE_STRIKE_POSE_PREFIX} %1 %{BKY_MAZE_DANCE_STRIKE_POSE_SUFFIX}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MOVE',
          options: [
            ['%{BKY_MAZE_DANCE_OPTION_SUPERHERO}', 'superhero'],
            ['%{BKY_MAZE_DANCE_OPTION_TEAPOT}', 'teapot'],
            ['%{BKY_MAZE_DANCE_OPTION_STATUE}', 'statue'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_STRIKE_POSE_TOOLTIP}',
    },
    {
      type: 'dance_wave',
      message0: '%{BKY_MAZE_DANCE_WAVE} %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MOVE',
          options: [
            ['%{BKY_MAZE_DANCE_OPTION_LEFT_HAND}', 'left hand'],
            ['%{BKY_MAZE_DANCE_OPTION_RIGHT_HAND}', 'right hand'],
            ['%{BKY_MAZE_DANCE_OPTION_BOTH_HANDS}', 'both hands'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_WAVE_TOOLTIP}',
    },
    {
      type: 'dance_step',
      message0: '%{BKY_MAZE_DANCE_STEP} %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MOVE',
          options: [
            ['%{BKY_MAZE_DANCE_OPTION_FORWARD}', 'forward'],
            ['%{BKY_MAZE_DANCE_OPTION_BACK}', 'back'],
            ['%{BKY_MAZE_DANCE_OPTION_SIDEWAYS}', 'sideways'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_STEP_TOOLTIP}',
    },
    {
      type: 'dance_freeze',
      message0: '%{BKY_MAZE_DANCE_FREEZE_PREFIX} %1 %{BKY_MAZE_DANCE_FREEZE_SUFFIX}',
      args0: [
        {
          type: 'field_dropdown',
          name: 'SECONDS',
          options: [
            ['1', '1'],
            ['2', '2'],
            ['3', '3'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_FREEZE_TOOLTIP}',
    },

    // Dance party blocks — container (repeat).
    {
      type: 'dance_repeat',
      message0: '%{BKY_MAZE_DANCE_REPEAT_PREFIX} %1 %{BKY_MAZE_DANCE_REPEAT_SUFFIX} %2 %{BKY_MAZE_DO} %3',
      args0: [
        {
          type: 'field_dropdown',
          name: 'TIMES',
          options: [
            ['2', '2'],
            ['3', '3'],
            ['4', '4'],
          ],
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
      colour: DANCE_HUE,
      tooltip: '%{BKY_MAZE_DANCE_REPEAT_TOOLTIP}',
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

  // Dance party generators. Each call ends with the block id so the stage
  // can highlight the currently-executing block, matching maze_moveForward.
  javascriptGenerator.forBlock['dance_clap'] = function (block) {
    return `clap('block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_spin'] = function (block) {
    return `spin('block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_jump'] = function (block) {
    return `jump('block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_wiggle'] = function (block) {
    return `wiggle('block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_bow'] = function (block) {
    return `bow('block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_like_a'] = function (block) {
    const move = block.getFieldValue('MOVE');
    return `danceLike("${move}", 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_pull_face'] = function (block) {
    const move = block.getFieldValue('MOVE');
    return `pullFace("${move}", 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_make_noise'] = function (block) {
    const move = block.getFieldValue('MOVE');
    return `makeNoise("${move}", 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_strike_pose'] = function (block) {
    const move = block.getFieldValue('MOVE');
    return `strikePose("${move}", 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_wave'] = function (block) {
    const move = block.getFieldValue('MOVE');
    return `wave("${move}", 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_step'] = function (block) {
    const move = block.getFieldValue('MOVE');
    return `step("${move}", 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_freeze'] = function (block) {
    const seconds = block.getFieldValue('SECONDS');
    return `freeze(${seconds}, 'block_id_${block.id}');\n`;
  };

  javascriptGenerator.forBlock['dance_repeat'] = function (block) {
    const times = block.getFieldValue('TIMES');
    const branch = javascriptGenerator.statementToCode(block, 'DO');
    return `for (var count = 0; count < ${times}; count++) {\n${branch}}\n`;
  };
}
