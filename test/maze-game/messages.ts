/**
 * @license
 * Copyright 2012 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Internationalization (i18n) messages for Maze game.
 * Adapted from blockly-games translations.
 */

import * as Blockly from 'blockly/core';
// Blockly's built-in chrome strings ("Duplicate", "Delete Block", "Add Comment",
// "Collapse Block", variable/function dialog labels, trash tooltips, etc.) are
// shipped as locale-specific msg packs. Importing each pack mutates a module-
// level Msg object as a side effect; we then selectively copy the active
// locale's contents into Blockly.Msg inside loadMessages(). Static imports keep
// webpack happy (no async/dynamic-import chunking) and the three packs are
// small enough to bundle together.
import * as BlocklyMsgEn from 'blockly/msg/en';
import * as BlocklyMsgFr from 'blockly/msg/fr';
import * as BlocklyMsgEs from 'blockly/msg/es';

/**
 * Supported languages for the maze game
 */
export type SupportedLocale = 'en' | 'fr' | 'es';

/**
 * Map of locale -> Blockly built-in message pack.
 *
 * Each imported module is a flat key/value object (e.g. DUPLICATE_BLOCK,
 * DELETE_BLOCK, ADD_COMMENT). We cast through unknown because the upstream
 * @types tries to type these as a namespace.
 */
const BLOCKLY_MSG_PACKS: Record<SupportedLocale, Record<string, string>> = {
  en: BlocklyMsgEn as unknown as Record<string, string>,
  fr: BlocklyMsgFr as unknown as Record<string, string>,
  es: BlocklyMsgEs as unknown as Record<string, string>,
};

/**
 * Message definitions for all supported languages
 */
const MESSAGES: Record<SupportedLocale, Record<string, string>> = {
  en: {
    // Block text (from Maze.*)
    MAZE_MOVE_FORWARD: 'move forward',
    MAZE_TURN: 'turn',
    MAZE_TURN_LEFT: 'turn left',
    MAZE_TURN_RIGHT: 'turn right',
    MAZE_PATH_AHEAD: 'if path ahead',
    MAZE_PATH_LEFT: 'if path to the left',
    MAZE_PATH_RIGHT: 'if path to the right',
    MAZE_DO: 'do',
    MAZE_ELSE: 'else',
    MAZE_REPEAT_UNTIL: 'repeat until',

    // Tooltips (from Maze.*)
    MAZE_MOVE_FORWARD_TOOLTIP: 'Moves the player forward one space.',
    MAZE_TURN_TOOLTIP: 'Turns the player left or right by 90 degrees.',
    MAZE_IF_TOOLTIP: 'If there is a path in the specified direction, then do some actions.',
    MAZE_IFELSE_TOOLTIP:
      'If there is a path in the specified direction, then do the first block of actions. Otherwise, do the second block of actions.',
    MAZE_WHILE_TOOLTIP: 'Repeat the enclosed actions until finish point is reached.',

    // UI strings (from Games.*)
    MAZE_TITLE: 'Maze',
    MAZE_RUN_PROGRAM: 'Run Program',
    MAZE_RESET_PROGRAM: 'Reset',
    MAZE_LEVEL: 'Level',

    // Capacity (simplified from Maze.capacity0/1/2)
    MAZE_CAPACITY: 'You have %1 blocks left.',
    MAZE_CAPACITY_1: 'You have %1 block left.',

    // Alert messages (from Games.congratulations, extra for failure/timeout)
    MAZE_CONGRATULATIONS: 'Congratulations!',
    MAZE_FAILURE_MESSAGE: 'Program finished, but you did not reach the goal.',
    MAZE_TIMEOUT_MESSAGE: 'Program took too long to run. Check for infinite loops.',

    // Result modal messages
    MAZE_SOLVED_BLOCKS_ONE: 'You solved this level with 1 block!',
    MAZE_SOLVED_BLOCKS: 'You solved this level with %1 blocks!',
    MAZE_FAILURE_TITLE: 'Not quite!',
    MAZE_TIMEOUT_TITLE: 'Too slow!',
    MAZE_ERROR_TITLE: 'Oops!',
    MAZE_ERROR_MESSAGE: 'That didn\'t work. Try a different path!',
    MAZE_GHOST_RUN_BUTTON: 'Ghost Run',
    MAZE_GHOST_RUN_TITLE: 'Ghost run complete!',
    MAZE_GHOST_RUN_SUCCESS: 'Your program reached the goal — try it for real now!',
    MAZE_GHOST_RUN_FAILURE: 'Your program missed the goal. Check your moves and try again.',
    MAZE_NEXT_LEVEL_PROMPT: 'Are you ready for the next level?',
    MAZE_ALL_LEVELS_COMPLETE: 'You completed all levels!',

    // Hints (from Maze.help*)
    MAZE_HINT_STACK: 'Stack a couple of \'move forward\' blocks together to help me reach the goal.',
    MAZE_HINT_ONE_TOP_BLOCK: 'On this level, you need to stack together all of the blocks in the white workspace.',
    MAZE_HINT_RUN: 'Run your program to see what happens.',
    MAZE_HINT_RESET: 'Your program didn\'t solve the maze. Press \'Reset\' and try again.',
    MAZE_HINT_REPEAT: 'Reach the end of this path using only two blocks. Use \'repeat\' to run a block more than once.',
    MAZE_HINT_CAPACITY: 'You have used up all the blocks for this level. To create a new block, you first need to delete an existing block.',
    MAZE_HINT_REPEAT_MANY: 'You can fit more than one block inside a \'repeat\' block.',
    MAZE_HINT_IF: 'An \'if\' block will do something only if the condition is true. Try turning left if there is a path to the left.',
    MAZE_HINT_MENU: 'Click on %1 in the \'if\' block to change its condition.',
    MAZE_HINT_IF_ELSE: 'If-else blocks will do one thing or the other.',
    MAZE_HINT_WALL_FOLLOW: 'Can you solve this complicated maze? Try following the left-hand wall. Advanced programmers only!',

    // Practice mode (direct control before programming)
    MAZE_PRACTICE_FORWARD: 'Move Forward',
    MAZE_PRACTICE_TURN_LEFT: 'Turn Left',
    MAZE_PRACTICE_TURN_RIGHT: 'Turn Right',
    MAZE_PRACTICE_HINT: 'Use the buttons to control the character. Can you move them to the goal?',
    MAZE_PRACTICE_FELL: 'Oh no! Try again.',
    MAZE_MODE_PRACTICE: 'Practice',
    MAZE_MODE_CODING: 'Coding',
    MAZE_SWITCH_TO_PRACTICE: 'Switch to Practice',
    MAZE_SWITCH_TO_CODING: 'Switch to Coding',

    // Practice mode instructions for coding levels (when played in practice mode)
    MAZE_INSTRUCTION_1_PRACTICE: 'Press forward to reach the goal.',
    MAZE_INSTRUCTION_2_PRACTICE: 'Use turn and forward to navigate to the goal.',
    MAZE_INSTRUCTION_3_PRACTICE: 'Navigate the longer path to the goal.',
    MAZE_INSTRUCTION_4_PRACTICE: 'Find the path through the twists and turns.',
    MAZE_INSTRUCTION_5_PRACTICE: 'Navigate through the maze to reach the goal.',
    MAZE_INSTRUCTION_6_PRACTICE: 'Watch for branching paths on your way to the goal.',
    MAZE_INSTRUCTION_7_PRACTICE: 'Choose the right direction at each junction.',
    MAZE_INSTRUCTION_8_PRACTICE: 'Navigate the complex path to the goal.',
    MAZE_INSTRUCTION_9_PRACTICE: 'Find your way through the branching maze.',
    MAZE_INSTRUCTION_10_PRACTICE: 'Solve this challenging maze step by step.',
    MAZE_MODE_TRANSITION: 'Great job! Now let\'s try programming. Plan your moves, then press Run.',

    // Practice-only levels (P1-P8) - separate track for learning controls
    MAZE_PRACTICE_LEVEL_1: 'Press forward to move. Explore the area!',
    MAZE_PRACTICE_LEVEL_2: 'Use turn buttons to change direction, then move forward.',
    MAZE_PRACTICE_LEVEL_3: 'The path gets narrower. Can you reach the goal?',
    MAZE_PRACTICE_LEVEL_4: 'Follow the path to the goal.',
    MAZE_PRACTICE_LEVEL_5: 'Navigate the turns to reach the goal.',
    MAZE_PRACTICE_LEVEL_6: 'Climb the stairs to the goal!',
    MAZE_PRACTICE_LEVEL_7: 'Find your way around to the goal.',
    MAZE_PRACTICE_LEVEL_8: 'One more maze, then you\'re ready to code!',
    MAZE_PRACTICE_GRADUATION_TITLE: 'You\'ve mastered the controls!',
    MAZE_PRACTICE_GRADUATION_MESSAGE: 'Ready to write your own programs?',
    MAZE_PRACTICE_TRY_CODING: 'Try Coding Mode [Enter]',
    MAZE_PRACTICE_STAY: 'Stay in Practice [Esc]',
    MAZE_PRACTICE_INSTRUCTION: 'Give the player instructions to move them to the goal',

    // Grid mode (for use inside Grid 3 AAC software)
    MAZE_GRID_INSTRUCTION: 'Give the player instructions to move them to the goal',
    MAZE_GRID_INSTRUCTIONS: 'Instructions used: %1',
    MAZE_GRID_SUCCESS_TITLE: 'Hurrah!',
    MAZE_GRID_SUCCESS_MESSAGE: 'You got to the goal with %1 instructions!',
    MAZE_GRID_GRADUATION_TITLE: 'Well done!',
    MAZE_GRID_GRADUATION_MESSAGE: 'You finished all the mazes! In Coding mode, you can write a program to guide the character for you.',

    // Grid coding mode (immediate execution + block building)
    MAZE_GRID_CODING_INSTRUCTION: 'Use arrow keys to build your program. Watch the blocks appear!',
    MAZE_GRID_BLOCKS: 'Blocks: %1',
    MAZE_GRID_CODING_SUCCESS_TITLE: 'Great job!',
    MAZE_GRID_CODING_SUCCESS_MESSAGE: 'You wrote a program with %1 blocks!',
    MAZE_GRID_CODING_SUCCESS_MESSAGE2: 'Press Run Code %PLAY% to see it again.',
    MAZE_GRID_CODING_RUN_AGAIN: 'Run Again',
    // A1 (Guided) completion - transition to A2 (Challenge)
    MAZE_GRID_CODING_A1_COMPLETE_TITLE: 'Excellent Work!',
    MAZE_GRID_CODING_A1_COMPLETE_MESSAGE: 'You\'ve completed all the guided coding levels!\n\nReady for a challenge?\n\nIn the next levels, you\'ll write your whole program first, then run it to see what happens.',
    // A2 (Challenge) completion - end of grid coding
    MAZE_GRID_CODING_STAGE_COMPLETE_TITLE: 'Well Done!',
    MAZE_GRID_CODING_STAGE_COMPLETE_MESSAGE: 'You have finished all the introductory levels! You will need a different gridset to explore more advanced coding.',
    MAZE_GRID_CODING_INTRO_TITLE: 'Welcome to Coding!',
    MAZE_GRID_CODING_INTRO_LINE1: 'Coding lets us write a list of instructions for the computer to follow.',
    MAZE_GRID_CODING_INTRO_LINE2: 'Use your instructions to move the character to the goal.',
    MAZE_GRID_CODING_INTRO_LINE3: 'When you\'re done, run the code again to see the replay.',
    MAZE_GRID_PRACTICE_INTRO_TITLE: 'Welcome to Practice Mode!',
    MAZE_GRID_PRACTICE_INTRO_LINE1: 'Help the character get to the goal.',
    MAZE_GRID_PRACTICE_INTRO_LINE2: 'Use the buttons to move forward and turn.',
    MAZE_GRID_PRACTICE_INTRO_LINE3: 'Master the controls in practice mode before trying coding mode!',

    // Workspace controls
    MAZE_DELETE_BLOCK: 'Delete block',
    MAZE_CLEAR_WORKSPACE: 'Delete all',

    // === Strings routed from HTML via data-msg (added Step 3) ===
    MAZE_ZOOM_PANEL: 'Page zoom',
    MAZE_ZOOM_OUT: 'Zoom out',
    MAZE_ZOOM_IN: 'Zoom in',
    MAZE_MODE_TOGGLE: 'Toggle execution mode',
    MAZE_SHOW_SHORTCUTS: 'Show keyboard shortcuts',
    MAZE_TOGGLE_PANEL: 'Toggle maze panel',
    MAZE_PREV_LEVEL: '< Back',
    MAZE_NEXT_LEVEL: 'Next >',
    MAZE_GRID_INSTRUCTIONS_LABEL: 'Instructions:',
    MAZE_GRID_BLOCKS_LABEL: 'Blocks:',
    MAZE_KEYHINT_FORWARD: 'forward',
    MAZE_KEYHINT_TURN_LEFT: 'turn left',
    MAZE_KEYHINT_TURN_RIGHT: 'turn right',
    MAZE_KEYHINT_RESET: 'reset',
    MAZE_CANCEL: 'Cancel',
    MAZE_CONFIRM: 'Confirm',
    MAZE_KEY_ESC: '[Esc]',
    MAZE_KEY_ENTER: '[Enter]',
    MAZE_LETS_GO: 'Let\'s Go!',
    MAZE_SHORTCUTS_TITLE: 'Keyboard Shortcuts',
    MAZE_SHORTCUT_RUN: 'Run program',
    MAZE_SHORTCUT_RESET: 'Reset maze position',
    MAZE_SHORTCUT_CHANGE_LEVELS: 'Change levels',
    MAZE_SHORTCUT_TOGGLE_INSTRUCTIONS: 'Toggle instructions',
    MAZE_SHORTCUT_CHANGE_CHARACTER: 'Change character',
    MAZE_SHORTCUT_CHANGE_LANGUAGE: 'Change language',
    MAZE_SHORTCUT_MUTE: 'Mute/unmute',
    MAZE_SETTINGS: 'Settings',
    MAZE_SETTING_BLOCK_MOVEMENT: 'Rearrange blocks using',
    MAZE_BLOCK_MOVEMENT_BOTH: 'Drag or click',
    MAZE_BLOCK_MOVEMENT_CLICK: 'Click-to-move',
    MAZE_BLOCK_MOVEMENT_DRAG: 'Drag',
    MAZE_SETTING_HIGHLIGHT_SIZE: 'Connection highlight size',
    MAZE_HIGHLIGHT_MINIMAL: 'Minimal',
    MAZE_HIGHLIGHT_MEDIUM: 'Medium',
    MAZE_HIGHLIGHT_LARGE: 'Large',
    MAZE_DELETE_ALL_DATA: 'Delete all saved data',
    MAZE_CLOSE: 'Close',
    MAZE_ABOUT: 'About',
    MAZE_PAD_LEFT_DEC: 'Decrease left padding',
    MAZE_PAD_LEFT_INC: 'Increase left padding',
    MAZE_PAD_RIGHT_DEC: 'Decrease right padding',
    MAZE_PAD_RIGHT_INC: 'Increase right padding',

    // === Strings added in Step 1 (fix silent i18n bugs and route JS-side hardcoded strings) ===
    // Universal fallback instruction shown when a level lacks a semantic instruction key.
    MAZE_INSTRUCTION_1: 'Reach the goal.',
    // Mute button aria-label: when sound is ON, the action is "mute" — so MAZE_UNMUTE labels
    // the button that mutes (yes, the key name and value semantics are inverted; preserving
    // existing call-site behaviour at index.ts:749/753).
    MAZE_UNMUTE: 'Mute sound',
    MAZE_MUTE: 'Unmute sound',
    // Blockly help prompt override (replaces Blockly.Msg['HELP_PROMPT']).
    MAZE_HELP_PROMPT: 'Press → to move to block fields',
    // Toasts shown when entering move mode (click vs. keyboard).
    MAZE_TOAST_CLICK_TO_MOVE: 'Click a connection to move block there',
    MAZE_TOAST_KEYBOARD_MOVE: 'Use arrows to move block, or Esc to exit move mode',
    // Delete-all-data confirmation modal.
    MAZE_DELETE_DATA_TITLE: 'Delete All Data',
    MAZE_DELETE_DATA_MESSAGE: 'Delete all saved programs and settings? This cannot be undone.',
    // Generic OK button label (used by 4 modal sites).
    MAZE_OK: 'OK',

    // ===========================================
    // Reusable Level Instructions
    // Named semantically for reuse across levels
    // ===========================================

    // Stage A: Sequencing
    MAZE_INSTRUCTION_MOVE_FORWARD: 'Write a program to move forward and reach the goal.',
    MAZE_INSTRUCTION_NAVIGATE_TURNS: 'Navigate the turns to reach the goal.',
    MAZE_INSTRUCTION_USE_MOVE_AND_TURN: 'Use move and turn blocks to reach the goal.',

    // Stage B: Repeat X Times
    MAZE_INSTRUCTION_REPEAT_LONG_PATH: 'Use a repeat block to travel the long path.',
    MAZE_INSTRUCTION_MULTIPLE_IN_REPEAT: 'Put multiple moves in a repeat block to reach the goal.',
    MAZE_INSTRUCTION_CODE_BEFORE_REPEAT: 'Use some code before the repeat block to reach the goal.',
    MAZE_INSTRUCTION_WRITE_PROGRAM: 'Write a program to reach the goal.',

    // Stage C: Repeat Until
    MAZE_INSTRUCTION_KEEP_GOING: 'Keep going to the goal.',
    MAZE_INSTRUCTION_KEEP_ZIGZAGGING: 'Keep zigzagging all the way to the goal.',

    // Stage D: Colored Conditionals
    MAZE_INSTRUCTION_USE_COLORS: 'Use colored shapes to decide which way to turn.',

    // Stage E: If-Else
    MAZE_INSTRUCTION_IF_ELSE_TWO_ACTIONS: 'Use if-else to choose between two actions.',
    MAZE_INSTRUCTION_IF_ELSE_PATH: 'Use if-else to choose depending on where the path is.',

    // Stage F: Challenge
    MAZE_INSTRUCTION_USE_EVERYTHING: 'Use everything you\'ve learned to solve this challenge.',

    // Legacy level instructions (kept for reference)
    // MAZE_INSTRUCTION_6: 'Use the "if" block to turn when there\'s a path.',
    // MAZE_INSTRUCTION_7: 'Change the "if" condition to check different directions.',
    // MAZE_INSTRUCTION_8: 'Combine loops and conditions to solve the maze.',
    // MAZE_INSTRUCTION_9: 'Use "if-else" to handle both paths.',
    // MAZE_INSTRUCTION_10: 'Solve this challenging maze using all your skills.',

    // Stage names and concepts (for stage progression UI)
    MAZE_STAGE_1_NAME: 'Sequencing',
    MAZE_STAGE_1_CONCEPT: 'Computers follow your instructions one at a time.\n\nWrite a program to tell the character what to do, then run it to test.',
    MAZE_STAGE_2_NAME: 'Repeat',
    MAZE_STAGE_2_CONCEPT: "Loops let us tell the computer to repeat some instructions a set number of times.\n\nUse the 'repeat' block to solve these challenges.",
    MAZE_STAGE_3_NAME: 'Repeat Until',
    MAZE_STAGE_3_CONCEPT: 'We can also tell the computer to repeat instructions until it reaches the goal.',
    MAZE_STAGE_4_NAME: 'Conditionals',
    MAZE_STAGE_4_CONCEPT: "An 'if' block tells the computer to only follow an instruction if a certain condition is true.\n\nThe next levels let you give different instructions depending on the colour of a square.",
    MAZE_STAGE_5_NAME: 'If-Else',
    MAZE_STAGE_5_CONCEPT: "An 'if-else' block lets you choose between two actions.\n\nThese levels let you choose instructions based on colour, or detect where there is a path to follow.",
    MAZE_STAGE_6_NAME: 'Challenge',
    MAZE_STAGE_6_CONCEPT: 'Put everything together to solve these challenging mazes!',
    MAZE_STAGE: 'Stage',
    MAZE_STAGE_SELECT: 'Select Stage',

    // Grid coding stage names (for grid mode stage dropdown)
    MAZE_GRID_STAGE_1_NAME: 'Guided',
    MAZE_GRID_STAGE_1_DESC: 'See each move happen',
    MAZE_GRID_STAGE_2_NAME: 'Challenge',
    MAZE_GRID_STAGE_2_DESC: 'Build then run',

    // New block messages for repeat times and colored conditionals
    MAZE_REPEAT: 'repeat',
    MAZE_TIMES: 'times',
    MAZE_REPEAT_TIMES_TOOLTIP: 'Repeat the enclosed actions a specific number of times.',
    MAZE_IF_ON: 'if on',
    MAZE_IF_ON_RED: 'if on red',
    MAZE_IF_ON_BLUE: 'if on blue',
    MAZE_IF_COLOR: 'if on %1',
    MAZE_IF_COLOR_TOOLTIP: 'Do something if standing on a colored square.',
    MAZE_IF_COLOR_ELSE_TOOLTIP: 'Do something if standing on a colored square, otherwise do something else.',
    MAZE_COLOR_RED: 'red',
    MAZE_COLOR_BLUE: 'blue',

    // Extended level instructions for 26 levels
    MAZE_INSTRUCTION_11: 'Navigate the long straight path.',
    MAZE_INSTRUCTION_12: 'Use repeat to climb the staircase pattern.',
    MAZE_INSTRUCTION_13: 'Turn and move with loops.',
    MAZE_INSTRUCTION_14: 'Combine loops with turns.',
    MAZE_INSTRUCTION_15: 'Keep going until you reach the goal.',
    MAZE_INSTRUCTION_16: 'Navigate the winding path.',
    MAZE_INSTRUCTION_17: 'Find your way through the maze.',
    MAZE_INSTRUCTION_18: 'Solve this complex path.',
    MAZE_INSTRUCTION_19: 'Turn when you see a red square.',
    MAZE_INSTRUCTION_20: 'Red means turn left, blue means turn right.',
    MAZE_INSTRUCTION_21: 'Follow the colored path.',
    MAZE_INSTRUCTION_22: 'Use colors to navigate the maze.',
    MAZE_INSTRUCTION_23: 'Turn when there\'s a path to the left.',
    MAZE_INSTRUCTION_24: 'Check for paths and turn accordingly.',
    MAZE_INSTRUCTION_25: 'Navigate using path detection.',
    MAZE_INSTRUCTION_26: 'Use all your skills to solve this maze.',
  },

  fr: {
    // Block text (from Maze.*)
    MAZE_MOVE_FORWARD: 'avancer',
    MAZE_TURN: 'tourner',
    MAZE_TURN_LEFT: 'tourner à gauche',
    MAZE_TURN_RIGHT: 'tourner à droite',
    MAZE_PATH_AHEAD: 'si chemin devant',
    MAZE_PATH_LEFT: 'si chemin vers la gauche',
    MAZE_PATH_RIGHT: 'si chemin vers la droite',
    MAZE_DO: 'faire',
    MAZE_ELSE: 'sinon',
    MAZE_REPEAT_UNTIL: 'répéter jusqu\'à',

    // Tooltips (from Maze.*)
    MAZE_MOVE_FORWARD_TOOLTIP: 'Avance le joueur d\'une case.',
    MAZE_TURN_TOOLTIP: 'Tourne le joueur à gauche ou à droite de 90 degrés.',
    MAZE_IF_TOOLTIP:
      'S\'il y a un chemin dans la direction spécifiée, alors effectue ces actions.',
    MAZE_IFELSE_TOOLTIP:
      'S\'il y a un chemin dans la direction spécifiée, alors fais le premier bloc d\'actions. Sinon fais le second bloc d\'actions.',
    MAZE_WHILE_TOOLTIP:
      'Répète les actions à l\'intérieur du bloc jusqu\'à atteindre le but final.',

    // UI strings (from Games.*)
    MAZE_TITLE: 'Labyrinthe',
    MAZE_RUN_PROGRAM: 'Exécuter le programme',
    MAZE_RESET_PROGRAM: 'Réinitialiser',
    MAZE_LEVEL: 'Niveau',

    // Capacity (simplified from Maze.capacity0/1/2)
    MAZE_CAPACITY: 'Vous avez %1 blocs restants.',
    MAZE_CAPACITY_1: 'Vous avez %1 bloc restant.',

    // Alert messages (from Games.congratulations, extra for failure/timeout)
    MAZE_CONGRATULATIONS: 'Félicitations !',
    MAZE_FAILURE_MESSAGE: 'Le programme est terminé, mais vous n\'avez pas atteint l\'objectif.',
    MAZE_TIMEOUT_MESSAGE: 'Le programme a pris trop de temps. Vérifiez les boucles infinies.',

    // Result modal messages
    MAZE_SOLVED_BLOCKS_ONE: 'Vous avez résolu ce niveau avec 1 bloc !',
    MAZE_SOLVED_BLOCKS: 'Vous avez résolu ce niveau avec %1 blocs !',
    MAZE_FAILURE_TITLE: 'Pas tout à fait !',
    MAZE_TIMEOUT_TITLE: 'Trop lent !',
    MAZE_ERROR_TITLE: 'Oups !',
    MAZE_ERROR_MESSAGE: 'Ça n\'a pas marché. Essayez un autre chemin !',
    MAZE_GHOST_RUN_BUTTON: 'Mode fantôme',
    MAZE_GHOST_RUN_TITLE: 'Mode fantôme terminé !',
    MAZE_GHOST_RUN_SUCCESS: 'Votre programme a atteint l\'objectif — essayez pour de vrai maintenant !',
    MAZE_GHOST_RUN_FAILURE: 'Votre programme n\'a pas atteint l\'objectif. Vérifiez vos mouvements et réessayez.',
    MAZE_NEXT_LEVEL_PROMPT: 'Êtes-vous prêt pour le niveau suivant ?',
    MAZE_ALL_LEVELS_COMPLETE: 'Vous avez terminé tous les niveaux !',

    // Hints (from Maze.help*)
    MAZE_HINT_STACK: 'Empilez quelques blocs « avancer » ensemble pour m\'aider à atteindre l\'objectif.',
    MAZE_HINT_ONE_TOP_BLOCK: 'À ce niveau, vous devez empiler tous les blocs ensemble dans l\'espace de travail blanc.',
    MAZE_HINT_RUN: 'Exécutez votre programme pour voir ce qui se passe.',
    MAZE_HINT_RESET: 'Votre programme n\'a pas résolu le labyrinthe. Appuyez sur « Réinitialiser » et réessayez.',
    MAZE_HINT_REPEAT: 'Atteignez la fin de ce chemin avec seulement deux blocs. Utilisez « répéter » pour exécuter un bloc plusieurs fois.',
    MAZE_HINT_CAPACITY: 'Vous avez utilisé tous les blocs pour ce niveau. Pour créer un nouveau bloc, vous devez d\'abord supprimer un bloc existant.',
    MAZE_HINT_REPEAT_MANY: 'Vous pouvez mettre plus d\'un bloc à l\'intérieur d\'un bloc « répéter ».',
    MAZE_HINT_IF: 'Un bloc « si » ne fera quelque chose que si la condition est vraie. Essayez de tourner à gauche s\'il y a un chemin vers la gauche.',
    MAZE_HINT_MENU: 'Cliquez sur %1 dans le bloc « si » pour changer sa condition.',
    MAZE_HINT_IF_ELSE: 'Les blocs si-sinon feront une chose ou l\'autre.',
    MAZE_HINT_WALL_FOLLOW: 'Pouvez-vous résoudre ce labyrinthe compliqué ? Essayez de suivre le mur de gauche. Réservé aux programmeurs avancés !',

    // Practice mode (direct control before programming)
    MAZE_PRACTICE_FORWARD: 'Avancer',
    MAZE_PRACTICE_TURN_LEFT: 'Tourner à gauche',
    MAZE_PRACTICE_TURN_RIGHT: 'Tourner à droite',
    MAZE_PRACTICE_HINT: 'Utilisez les boutons pour contrôler le personnage. Pouvez-vous l\'amener jusqu\'au but ?',
    MAZE_PRACTICE_FELL: 'Oh non ! Réessayez.',
    MAZE_MODE_PRACTICE: 'Pratique',
    MAZE_MODE_CODING: 'Programmation',
    MAZE_SWITCH_TO_PRACTICE: 'Passer à Pratique',
    MAZE_SWITCH_TO_CODING: 'Passer à Programmation',

    // Practice mode instructions for coding levels (when played in practice mode)
    MAZE_INSTRUCTION_1_PRACTICE: 'Appuyez sur avancer pour atteindre l\'objectif.',
    MAZE_INSTRUCTION_2_PRACTICE: 'Utilisez tourner et avancer pour naviguer vers l\'objectif.',
    MAZE_INSTRUCTION_3_PRACTICE: 'Naviguez sur le chemin plus long vers l\'objectif.',
    MAZE_INSTRUCTION_4_PRACTICE: 'Trouvez le chemin à travers les virages.',
    MAZE_INSTRUCTION_5_PRACTICE: 'Naviguez dans le labyrinthe pour atteindre l\'objectif.',
    MAZE_INSTRUCTION_6_PRACTICE: 'Surveillez les chemins qui bifurquent vers l\'objectif.',
    MAZE_INSTRUCTION_7_PRACTICE: 'Choisissez la bonne direction à chaque jonction.',
    MAZE_INSTRUCTION_8_PRACTICE: 'Naviguez sur le chemin complexe vers l\'objectif.',
    MAZE_INSTRUCTION_9_PRACTICE: 'Trouvez votre chemin dans le labyrinthe ramifié.',
    MAZE_INSTRUCTION_10_PRACTICE: 'Résolvez ce labyrinthe difficile étape par étape.',
    MAZE_MODE_TRANSITION: 'Bravo ! Maintenant, essayons la programmation. Planifiez vos mouvements, puis appuyez sur Exécuter.',

    // Practice-only levels (P1-P8) - separate track for learning controls
    MAZE_PRACTICE_LEVEL_1: 'Appuyez sur avancer pour vous déplacer. Explorez la zone !',
    MAZE_PRACTICE_LEVEL_2: 'Utilisez les boutons tourner pour changer de direction, puis avancez.',
    MAZE_PRACTICE_LEVEL_3: 'Le chemin se rétrécit. Pouvez-vous atteindre l\'objectif ?',
    MAZE_PRACTICE_LEVEL_4: 'Suivez le chemin jusqu\'à l\'objectif.',
    MAZE_PRACTICE_LEVEL_5: 'Naviguez dans les virages pour atteindre l\'objectif.',
    MAZE_PRACTICE_LEVEL_6: 'Montez les escaliers jusqu\'à l\'objectif !',
    MAZE_PRACTICE_LEVEL_7: 'Trouvez votre chemin autour jusqu\'à l\'objectif.',
    MAZE_PRACTICE_LEVEL_8: 'Encore un labyrinthe, puis vous serez prêt à coder !',
    MAZE_PRACTICE_GRADUATION_TITLE: 'Vous maîtrisez les contrôles !',
    MAZE_PRACTICE_GRADUATION_MESSAGE: 'Prêt à écrire vos propres programmes ?',
    MAZE_PRACTICE_TRY_CODING: 'Essayer le mode Programmation [Entrée]',
    MAZE_PRACTICE_STAY: 'Rester en Pratique [Échap]',
    MAZE_PRACTICE_INSTRUCTION: 'Donnez des instructions au joueur pour le guider vers l\'objectif',

    // Grid mode (for use inside Grid 3 AAC software)
    MAZE_GRID_INSTRUCTION: 'Donnez des instructions au joueur pour le guider vers l\'objectif',
    MAZE_GRID_INSTRUCTIONS: 'Instructions utilisées : %1',
    MAZE_GRID_SUCCESS_TITLE: 'Hourra !',
    MAZE_GRID_SUCCESS_MESSAGE: 'Vous avez atteint l\'objectif avec %1 instructions !',
    MAZE_GRID_GRADUATION_TITLE: 'Bravo !',
    MAZE_GRID_GRADUATION_MESSAGE: 'Vous avez terminé tous les labyrinthes ! En mode Programmation, vous pouvez écrire un programme pour guider le personnage.',

    // Grid coding mode (immediate execution + block building)
    MAZE_GRID_CODING_INSTRUCTION: 'Utilisez les touches fléchées pour construire votre programme. Regardez les blocs apparaître !',
    MAZE_GRID_BLOCKS: 'Blocs : %1',
    MAZE_GRID_CODING_SUCCESS_TITLE: 'Excellent !',
    MAZE_GRID_CODING_SUCCESS_MESSAGE: 'Vous avez écrit un programme de %1 blocs !',
    MAZE_GRID_CODING_SUCCESS_MESSAGE2: 'Appuyez sur Exécuter le code %PLAY% pour le revoir.',
    MAZE_GRID_CODING_RUN_AGAIN: 'Relancer',
    // A1 (Guided) completion - transition to A2 (Challenge)
    MAZE_GRID_CODING_A1_COMPLETE_TITLE: 'Excellent travail !',
    MAZE_GRID_CODING_A1_COMPLETE_MESSAGE: 'Vous avez terminé tous les niveaux guidés !\n\nPrêt pour un défi ?\n\nDans les prochains niveaux, vous écrirez d\'abord tout votre programme, puis vous le lancerez pour voir ce qui se passe.',
    // A2 (Challenge) completion - end of grid coding
    MAZE_GRID_CODING_STAGE_COMPLETE_TITLE: 'Bravo !',
    MAZE_GRID_CODING_STAGE_COMPLETE_MESSAGE: 'Vous avez terminé tous les niveaux d\'introduction ! Vous aurez besoin d\'un autre gridset pour explorer la programmation avancée.',
    MAZE_GRID_CODING_INTRO_TITLE: 'Bienvenue dans la programmation !',
    MAZE_GRID_CODING_INTRO_LINE1: 'Le code nous permet d\'écrire une liste d\'instructions que l\'ordinateur va suivre.',
    MAZE_GRID_CODING_INTRO_LINE2: 'Utilisez vos instructions pour déplacer le personnage vers l\'objectif.',
    MAZE_GRID_CODING_INTRO_LINE3: 'Quand vous avez terminé, relancez le code pour revoir la solution.',
    MAZE_GRID_PRACTICE_INTRO_TITLE: 'Bienvenue en mode pratique !',
    MAZE_GRID_PRACTICE_INTRO_LINE1: 'Aidez le personnage à atteindre l\'objectif.',
    MAZE_GRID_PRACTICE_INTRO_LINE2: 'Utilisez les boutons pour avancer et tourner.',
    MAZE_GRID_PRACTICE_INTRO_LINE3: 'Maîtrisez les contrôles en mode pratique avant d\'essayer le mode programmation !',

    // Workspace controls
    MAZE_DELETE_BLOCK: 'Supprimer le bloc',
    MAZE_CLEAR_WORKSPACE: 'Tout supprimer',

    // === Strings routed from HTML via data-msg (added Step 3) ===
    MAZE_ZOOM_PANEL: 'Zoom de la page',
    MAZE_ZOOM_OUT: 'Zoom arrière',
    MAZE_ZOOM_IN: 'Zoom avant',
    MAZE_MODE_TOGGLE: 'Basculer le mode d\'exécution',
    MAZE_SHOW_SHORTCUTS: 'Afficher les raccourcis clavier',
    MAZE_TOGGLE_PANEL: 'Basculer le panneau du labyrinthe',
    MAZE_PREV_LEVEL: '< Retour',
    MAZE_NEXT_LEVEL: 'Suivant >',
    MAZE_GRID_INSTRUCTIONS_LABEL: 'Instructions :',
    MAZE_GRID_BLOCKS_LABEL: 'Blocs :',
    MAZE_KEYHINT_FORWARD: 'avancer',
    MAZE_KEYHINT_TURN_LEFT: 'tourner à gauche',
    MAZE_KEYHINT_TURN_RIGHT: 'tourner à droite',
    MAZE_KEYHINT_RESET: 'réinitialiser',
    MAZE_CANCEL: 'Annuler',
    MAZE_CONFIRM: 'Confirmer',
    MAZE_KEY_ESC: '[Échap]',
    MAZE_KEY_ENTER: '[Entrée]',
    MAZE_LETS_GO: 'C\'est parti !',
    MAZE_SHORTCUTS_TITLE: 'Raccourcis clavier',
    MAZE_SHORTCUT_RUN: 'Exécuter le programme',
    MAZE_SHORTCUT_RESET: 'Réinitialiser la position',
    MAZE_SHORTCUT_CHANGE_LEVELS: 'Changer de niveau',
    MAZE_SHORTCUT_TOGGLE_INSTRUCTIONS: 'Afficher/masquer les instructions',
    MAZE_SHORTCUT_CHANGE_CHARACTER: 'Changer de personnage',
    MAZE_SHORTCUT_CHANGE_LANGUAGE: 'Changer de langue',
    MAZE_SHORTCUT_MUTE: 'Couper/activer le son',
    MAZE_SETTINGS: 'Paramètres',
    MAZE_SETTING_BLOCK_MOVEMENT: 'Déplacer les blocs avec',
    MAZE_BLOCK_MOVEMENT_BOTH: 'Glisser ou cliquer',
    MAZE_BLOCK_MOVEMENT_CLICK: 'Cliquer pour déplacer',
    MAZE_BLOCK_MOVEMENT_DRAG: 'Glisser',
    MAZE_SETTING_HIGHLIGHT_SIZE: 'Taille de surbrillance des connexions',
    MAZE_HIGHLIGHT_MINIMAL: 'Minimale',
    MAZE_HIGHLIGHT_MEDIUM: 'Moyenne',
    MAZE_HIGHLIGHT_LARGE: 'Grande',
    MAZE_DELETE_ALL_DATA: 'Supprimer toutes les données',
    MAZE_CLOSE: 'Fermer',
    MAZE_ABOUT: 'À propos',
    MAZE_PAD_LEFT_DEC: 'Diminuer la marge gauche',
    MAZE_PAD_LEFT_INC: 'Augmenter la marge gauche',
    MAZE_PAD_RIGHT_DEC: 'Diminuer la marge droite',
    MAZE_PAD_RIGHT_INC: 'Augmenter la marge droite',

    // === Strings added in Step 1 (fix silent i18n bugs and route JS-side hardcoded strings) ===
    MAZE_INSTRUCTION_1: 'Atteignez l\'objectif.',
    MAZE_UNMUTE: 'Couper le son',
    MAZE_MUTE: 'Activer le son',
    MAZE_HELP_PROMPT: 'Appuyez sur → pour aller aux champs du bloc',
    MAZE_TOAST_CLICK_TO_MOVE: 'Cliquez sur une connexion pour y déplacer le bloc',
    MAZE_TOAST_KEYBOARD_MOVE: 'Utilisez les flèches pour déplacer le bloc, ou Échap pour quitter le mode déplacement',
    MAZE_DELETE_DATA_TITLE: 'Supprimer toutes les données',
    MAZE_DELETE_DATA_MESSAGE: 'Supprimer tous les programmes et paramètres sauvegardés ? Cette action est irréversible.',
    MAZE_OK: 'OK',

    // ===========================================
    // Reusable Level Instructions
    // Named semantically for reuse across levels
    // ===========================================

    // Stage A: Sequencing
    MAZE_INSTRUCTION_MOVE_FORWARD: 'Écrivez un programme pour avancer et atteindre l\'objectif.',
    MAZE_INSTRUCTION_NAVIGATE_TURNS: 'Naviguez dans les virages pour atteindre l\'objectif.',
    MAZE_INSTRUCTION_USE_MOVE_AND_TURN: 'Utilisez les blocs avancer et tourner pour atteindre l\'objectif.',

    // Stage B: Repeat X Times
    MAZE_INSTRUCTION_REPEAT_LONG_PATH: 'Utilisez un bloc répéter pour parcourir le long chemin.',
    MAZE_INSTRUCTION_MULTIPLE_IN_REPEAT: 'Mettez plusieurs mouvements dans un bloc répéter pour atteindre l\'objectif.',
    MAZE_INSTRUCTION_CODE_BEFORE_REPEAT: 'Utilisez du code avant le bloc répéter pour atteindre l\'objectif.',
    MAZE_INSTRUCTION_WRITE_PROGRAM: 'Écrivez un programme pour atteindre l\'objectif.',

    // Stage C: Repeat Until
    MAZE_INSTRUCTION_KEEP_GOING: 'Continuez jusqu\'à l\'objectif.',
    MAZE_INSTRUCTION_KEEP_ZIGZAGGING: 'Continuez en zigzag jusqu\'à l\'objectif.',

    // Stage D: Colored Conditionals
    MAZE_INSTRUCTION_USE_COLORS: 'Utilisez les formes colorées pour décider dans quelle direction tourner.',

    // Stage E: If-Else
    MAZE_INSTRUCTION_IF_ELSE_TWO_ACTIONS: 'Utilisez si-sinon pour choisir entre deux actions.',
    MAZE_INSTRUCTION_IF_ELSE_PATH: 'Utilisez si-sinon pour choisir selon l\'emplacement du chemin.',

    // Stage F: Challenge
    MAZE_INSTRUCTION_USE_EVERYTHING: 'Utilisez tout ce que vous avez appris pour résoudre ce défi.',

    // Legacy level instructions (kept for reference)
    // MAZE_INSTRUCTION_6: 'Utilisez le bloc « si » pour tourner quand il y a un chemin.',
    // MAZE_INSTRUCTION_7: 'Changez la condition « si » pour vérifier différentes directions.',
    // MAZE_INSTRUCTION_8: 'Combinez boucles et conditions pour résoudre le labyrinthe.',
    // MAZE_INSTRUCTION_9: 'Utilisez « si-sinon » pour gérer les deux chemins.',
    // MAZE_INSTRUCTION_10: 'Résolvez ce labyrinthe difficile en utilisant toutes vos compétences.',

    // Stage names and concepts (for stage progression UI)
    MAZE_STAGE_1_NAME: 'Séquençage',
    MAZE_STAGE_1_CONCEPT: "Les ordinateurs suivent vos instructions une par une.\n\nÉcrivez un programme pour dire au personnage quoi faire, puis exécutez-le pour tester.",
    MAZE_STAGE_2_NAME: 'Répéter',
    MAZE_STAGE_2_CONCEPT: "Les boucles permettent de répéter des instructions un nombre défini de fois.\n\nUtilisez le bloc « répéter » pour résoudre ces défis.",
    MAZE_STAGE_3_NAME: 'Répéter jusqu\'à',
    MAZE_STAGE_3_CONCEPT: "On peut aussi dire à l'ordinateur de répéter des instructions jusqu'à atteindre l'objectif.",
    MAZE_STAGE_4_NAME: 'Conditionnels',
    MAZE_STAGE_4_CONCEPT: "Un bloc « si » dit à l'ordinateur de suivre une instruction seulement si une condition est vraie.\n\nLes prochains niveaux vous permettent de donner différentes instructions selon la couleur d'une case.",
    MAZE_STAGE_5_NAME: 'Si-Sinon',
    MAZE_STAGE_5_CONCEPT: "Un bloc « si-sinon » vous permet de choisir entre deux actions.\n\nCes niveaux vous permettent de choisir des instructions basées sur la couleur, ou de détecter où il y a un chemin à suivre.",
    MAZE_STAGE_6_NAME: 'Défi',
    MAZE_STAGE_6_CONCEPT: 'Combinez tout pour résoudre ces labyrinthes difficiles !',
    MAZE_STAGE: 'Étape',
    MAZE_STAGE_SELECT: 'Sélectionner l\'étape',

    // Grid coding stage names (for grid mode stage dropdown)
    MAZE_GRID_STAGE_1_NAME: 'Guidé',
    MAZE_GRID_STAGE_1_DESC: 'Voir chaque mouvement',
    MAZE_GRID_STAGE_2_NAME: 'Défi',
    MAZE_GRID_STAGE_2_DESC: 'Construire puis exécuter',

    // New block messages for repeat times and colored conditionals
    MAZE_REPEAT: 'répéter',
    MAZE_TIMES: 'fois',
    MAZE_REPEAT_TIMES_TOOLTIP: 'Répète les actions contenues un nombre spécifique de fois.',
    MAZE_IF_ON: 'si sur',
    MAZE_IF_ON_RED: 'si sur rouge',
    MAZE_IF_ON_BLUE: 'si sur bleu',
    MAZE_IF_COLOR: 'si sur %1',
    MAZE_IF_COLOR_TOOLTIP: 'Faire quelque chose si vous êtes sur une case colorée.',
    MAZE_IF_COLOR_ELSE_TOOLTIP: 'Faire quelque chose si vous êtes sur une case colorée, sinon faire autre chose.',
    MAZE_COLOR_RED: 'rouge',
    MAZE_COLOR_BLUE: 'bleu',

    // Extended level instructions for 26 levels
    MAZE_INSTRUCTION_11: 'Naviguez sur le long chemin droit.',
    MAZE_INSTRUCTION_12: 'Utilisez répéter pour monter le motif en escalier.',
    MAZE_INSTRUCTION_13: 'Tournez et avancez avec des boucles.',
    MAZE_INSTRUCTION_14: 'Combinez les boucles avec les virages.',
    MAZE_INSTRUCTION_15: 'Continuez jusqu\'à atteindre l\'objectif.',
    MAZE_INSTRUCTION_16: 'Naviguez sur le chemin sinueux.',
    MAZE_INSTRUCTION_17: 'Trouvez votre chemin dans le labyrinthe.',
    MAZE_INSTRUCTION_18: 'Résolvez ce chemin complexe.',
    MAZE_INSTRUCTION_19: 'Tournez quand vous voyez une case rouge.',
    MAZE_INSTRUCTION_20: 'Rouge signifie tourner à gauche, bleu à droite.',
    MAZE_INSTRUCTION_21: 'Suivez le chemin coloré.',
    MAZE_INSTRUCTION_22: 'Utilisez les couleurs pour naviguer dans le labyrinthe.',
    MAZE_INSTRUCTION_23: 'Tournez quand il y a un chemin à gauche.',
    MAZE_INSTRUCTION_24: 'Vérifiez les chemins et tournez en conséquence.',
    MAZE_INSTRUCTION_25: 'Naviguez en utilisant la détection de chemin.',
    MAZE_INSTRUCTION_26: 'Utilisez toutes vos compétences pour résoudre ce labyrinthe.',
  },

  es: {
    // Block text (from Maze.* — matches blockly-games/pxt-blockly Spanish)
    MAZE_MOVE_FORWARD: 'avanzar',
    MAZE_TURN: 'girar',
    MAZE_TURN_LEFT: 'girar a la izquierda',
    MAZE_TURN_RIGHT: 'girar a la derecha',
    MAZE_PATH_AHEAD: 'si hay camino enfrente',
    MAZE_PATH_LEFT: 'si hay camino a la izquierda',
    MAZE_PATH_RIGHT: 'si hay camino a la derecha',
    MAZE_DO: 'hacer',
    MAZE_ELSE: 'sino',
    MAZE_REPEAT_UNTIL: 'repetir hasta',

    // Tooltips (from Maze.*)
    MAZE_MOVE_FORWARD_TOOLTIP: 'Mueve al jugador un cuadro hacia delante.',
    MAZE_TURN_TOOLTIP: 'Gira al jugador a izquierda o derecha 90 grados.',
    MAZE_IF_TOOLTIP: 'Si hay un camino en la dirección especificada, entonces ejecuta unas acciones.',
    MAZE_IFELSE_TOOLTIP:
      'Si hay un camino en la dirección especificada, entonces ejecuta el primer bloque de acciones. Sino, haz el segundo bloque de acciones.',
    MAZE_WHILE_TOOLTIP: 'Repite las acciones contenidas hasta alcanzar el punto final.',

    // UI strings (from Games.*)
    MAZE_TITLE: 'Laberinto',
    MAZE_RUN_PROGRAM: 'Ejecutar el programa',
    MAZE_RESET_PROGRAM: 'Reiniciar',
    MAZE_LEVEL: 'Nivel',

    // Capacity (simplified from Maze.capacity0/1/2)
    MAZE_CAPACITY: 'Te quedan %1 bloques.',
    MAZE_CAPACITY_1: 'Te queda %1 bloque.',

    // Alert messages
    MAZE_CONGRATULATIONS: '¡Enhorabuena!',
    MAZE_FAILURE_MESSAGE: 'El programa ha terminado, pero no has llegado a la meta.',
    MAZE_TIMEOUT_MESSAGE: 'El programa ha tardado demasiado. Comprueba si hay bucles infinitos.',

    // Result modal messages
    MAZE_SOLVED_BLOCKS_ONE: '¡Has resuelto este nivel con 1 bloque!',
    MAZE_SOLVED_BLOCKS: '¡Has resuelto este nivel con %1 bloques!',
    MAZE_FAILURE_TITLE: '¡Casi!',
    MAZE_TIMEOUT_TITLE: '¡Demasiado lento!',
    MAZE_ERROR_TITLE: '¡Vaya!',
    MAZE_ERROR_MESSAGE: 'Eso no ha funcionado. ¡Prueba otro camino!',
    MAZE_GHOST_RUN_BUTTON: 'Ensayo',
    MAZE_GHOST_RUN_TITLE: '¡Ensayo terminado!',
    MAZE_GHOST_RUN_SUCCESS: 'Tu programa ha llegado a la meta — ¡pruébalo de verdad ahora!',
    MAZE_GHOST_RUN_FAILURE: 'Tu programa no ha llegado a la meta. Revisa tus movimientos e inténtalo de nuevo.',
    MAZE_NEXT_LEVEL_PROMPT: '¿Estás listo para el siguiente nivel?',
    MAZE_ALL_LEVELS_COMPLETE: '¡Has completado todos los niveles!',

    // Hints (from Maze.help*)
    MAZE_HINT_STACK: 'Une un par de bloques «avanzar» para ayudarme a llegar a la meta.',
    MAZE_HINT_ONE_TOP_BLOCK: 'En este nivel, necesitas unir los bloques en el espacio de trabajo en blanco.',
    MAZE_HINT_RUN: 'Ejecuta tu programa para ver qué pasa.',
    MAZE_HINT_RESET: 'Tu programa no ha resuelto el laberinto. Pulsa «Reiniciar» e inténtalo otra vez.',
    MAZE_HINT_REPEAT: 'Llega al final de este camino usando tan solo dos bloques. Utiliza «repetir» para ejecutar un bloque más de una vez.',
    MAZE_HINT_CAPACITY: 'Has usado todos los bloques de este nivel. Para crear un bloque nuevo, primero debes eliminar uno existente.',
    MAZE_HINT_REPEAT_MANY: 'Puedes usar más de un bloque dentro de un bloque «repetir».',
    MAZE_HINT_IF: 'Un bloque «si» hará algo solamente si la condición es verdadera. Intenta girar a la izquierda si hay camino a la izquierda.',
    MAZE_HINT_MENU: 'Pulsa en %1 en el bloque «si» para cambiar su condición.',
    MAZE_HINT_IF_ELSE: 'Los bloques «si-sino» harán una cosa o la otra.',
    MAZE_HINT_WALL_FOLLOW: '¿Puedes resolver este complicado laberinto? Intenta seguir la pared de la izquierda. ¡Solo para programadores avanzados!',

    // Practice mode (direct control before programming)
    MAZE_PRACTICE_FORWARD: 'Avanzar',
    MAZE_PRACTICE_TURN_LEFT: 'Girar a la izquierda',
    MAZE_PRACTICE_TURN_RIGHT: 'Girar a la derecha',
    MAZE_PRACTICE_HINT: 'Usa los botones para controlar al personaje. ¿Puedes llevarlo hasta la meta?',
    MAZE_PRACTICE_FELL: '¡Oh, no! Inténtalo otra vez.',
    MAZE_MODE_PRACTICE: 'Práctica',
    MAZE_MODE_CODING: 'Programación',
    MAZE_SWITCH_TO_PRACTICE: 'Cambiar a Práctica',
    MAZE_SWITCH_TO_CODING: 'Cambiar a Programación',

    // Practice mode instructions for coding levels (when played in practice mode)
    MAZE_INSTRUCTION_1_PRACTICE: 'Pulsa avanzar para llegar a la meta.',
    MAZE_INSTRUCTION_2_PRACTICE: 'Usa girar y avanzar para llegar a la meta.',
    MAZE_INSTRUCTION_3_PRACTICE: 'Recorre el camino más largo hasta la meta.',
    MAZE_INSTRUCTION_4_PRACTICE: 'Encuentra el camino entre los giros.',
    MAZE_INSTRUCTION_5_PRACTICE: 'Recorre el laberinto para llegar a la meta.',
    MAZE_INSTRUCTION_6_PRACTICE: 'Fíjate en los caminos que se bifurcan hacia la meta.',
    MAZE_INSTRUCTION_7_PRACTICE: 'Elige la dirección correcta en cada cruce.',
    MAZE_INSTRUCTION_8_PRACTICE: 'Recorre el camino complejo hasta la meta.',
    MAZE_INSTRUCTION_9_PRACTICE: 'Encuentra tu camino en el laberinto ramificado.',
    MAZE_INSTRUCTION_10_PRACTICE: 'Resuelve este laberinto difícil paso a paso.',
    MAZE_MODE_TRANSITION: '¡Muy bien! Ahora vamos a probar la programación. Planifica tus movimientos y después pulsa Ejecutar.',

    // Practice-only levels (P1-P8) - separate track for learning controls
    MAZE_PRACTICE_LEVEL_1: 'Pulsa avanzar para moverte. ¡Explora la zona!',
    MAZE_PRACTICE_LEVEL_2: 'Usa los botones de girar para cambiar de dirección y después avanza.',
    MAZE_PRACTICE_LEVEL_3: 'El camino se estrecha. ¿Puedes llegar a la meta?',
    MAZE_PRACTICE_LEVEL_4: 'Sigue el camino hasta la meta.',
    MAZE_PRACTICE_LEVEL_5: 'Atraviesa los giros para llegar a la meta.',
    MAZE_PRACTICE_LEVEL_6: '¡Sube las escaleras hasta la meta!',
    MAZE_PRACTICE_LEVEL_7: 'Encuentra el camino alrededor hasta la meta.',
    MAZE_PRACTICE_LEVEL_8: 'Un laberinto más y estarás listo para programar.',
    MAZE_PRACTICE_GRADUATION_TITLE: '¡Ya dominas los controles!',
    MAZE_PRACTICE_GRADUATION_MESSAGE: '¿Listo para escribir tus propios programas?',
    MAZE_PRACTICE_TRY_CODING: 'Probar el modo Programación [Intro]',
    MAZE_PRACTICE_STAY: 'Quedarse en Práctica [Esc]',
    MAZE_PRACTICE_INSTRUCTION: 'Da instrucciones al jugador para llevarlo a la meta',

    // Grid mode (for use inside Grid 3 AAC software)
    MAZE_GRID_INSTRUCTION: 'Da instrucciones al jugador para llevarlo a la meta',
    MAZE_GRID_INSTRUCTIONS: 'Instrucciones usadas: %1',
    MAZE_GRID_SUCCESS_TITLE: '¡Hurra!',
    MAZE_GRID_SUCCESS_MESSAGE: '¡Has llegado a la meta con %1 instrucciones!',
    MAZE_GRID_GRADUATION_TITLE: '¡Muy bien!',
    MAZE_GRID_GRADUATION_MESSAGE: '¡Has terminado todos los laberintos! En el modo Programación puedes escribir un programa para guiar al personaje.',

    // Grid coding mode (immediate execution + block building)
    MAZE_GRID_CODING_INSTRUCTION: 'Usa las teclas de flecha para construir tu programa. ¡Mira cómo aparecen los bloques!',
    MAZE_GRID_BLOCKS: 'Bloques: %1',
    MAZE_GRID_CODING_SUCCESS_TITLE: '¡Buen trabajo!',
    MAZE_GRID_CODING_SUCCESS_MESSAGE: '¡Has escrito un programa con %1 bloques!',
    MAZE_GRID_CODING_SUCCESS_MESSAGE2: 'Pulsa Ejecutar el código %PLAY% para verlo otra vez.',
    MAZE_GRID_CODING_RUN_AGAIN: 'Ejecutar otra vez',
    // A1 (Guided) completion - transition to A2 (Challenge)
    MAZE_GRID_CODING_A1_COMPLETE_TITLE: '¡Excelente trabajo!',
    MAZE_GRID_CODING_A1_COMPLETE_MESSAGE: '¡Has completado todos los niveles guiados!\n\n¿Listo para un reto?\n\nEn los siguientes niveles escribirás todo tu programa primero y después lo ejecutarás para ver qué pasa.',
    // A2 (Challenge) completion - end of grid coding
    MAZE_GRID_CODING_STAGE_COMPLETE_TITLE: '¡Muy bien!',
    MAZE_GRID_CODING_STAGE_COMPLETE_MESSAGE: '¡Has terminado todos los niveles introductorios! Necesitarás otro gridset para explorar la programación avanzada.',
    MAZE_GRID_CODING_INTRO_TITLE: '¡Te damos la bienvenida a la programación!',
    MAZE_GRID_CODING_INTRO_LINE1: 'Programar nos permite escribir una lista de instrucciones para que el ordenador las siga.',
    MAZE_GRID_CODING_INTRO_LINE2: 'Usa tus instrucciones para mover al personaje hasta la meta.',
    MAZE_GRID_CODING_INTRO_LINE3: 'Cuando hayas terminado, ejecuta el código otra vez para ver la repetición.',
    MAZE_GRID_PRACTICE_INTRO_TITLE: '¡Te damos la bienvenida al modo Práctica!',
    MAZE_GRID_PRACTICE_INTRO_LINE1: 'Ayuda al personaje a llegar a la meta.',
    MAZE_GRID_PRACTICE_INTRO_LINE2: 'Usa los botones para avanzar y girar.',
    MAZE_GRID_PRACTICE_INTRO_LINE3: '¡Domina los controles en el modo Práctica antes de probar el modo Programación!',

    // Workspace controls
    MAZE_DELETE_BLOCK: 'Eliminar bloque',
    MAZE_CLEAR_WORKSPACE: 'Eliminar todo',

    // === Strings routed from HTML via data-msg (added Step 3) ===
    MAZE_ZOOM_PANEL: 'Zoom de la página',
    MAZE_ZOOM_OUT: 'Reducir zoom',
    MAZE_ZOOM_IN: 'Aumentar zoom',
    MAZE_MODE_TOGGLE: 'Alternar modo de ejecución',
    MAZE_SHOW_SHORTCUTS: 'Mostrar atajos de teclado',
    MAZE_TOGGLE_PANEL: 'Alternar el panel del laberinto',
    MAZE_PREV_LEVEL: '< Atrás',
    MAZE_NEXT_LEVEL: 'Siguiente >',
    MAZE_GRID_INSTRUCTIONS_LABEL: 'Instrucciones:',
    MAZE_GRID_BLOCKS_LABEL: 'Bloques:',
    MAZE_KEYHINT_FORWARD: 'avanzar',
    MAZE_KEYHINT_TURN_LEFT: 'girar izquierda',
    MAZE_KEYHINT_TURN_RIGHT: 'girar derecha',
    MAZE_KEYHINT_RESET: 'reiniciar',
    MAZE_CANCEL: 'Cancelar',
    MAZE_CONFIRM: 'Confirmar',
    MAZE_KEY_ESC: '[Esc]',
    MAZE_KEY_ENTER: '[Entrar]',
    MAZE_LETS_GO: '¡Vamos!',
    MAZE_SHORTCUTS_TITLE: 'Atajos de teclado',
    MAZE_SHORTCUT_RUN: 'Ejecutar programa',
    MAZE_SHORTCUT_RESET: 'Reiniciar posición',
    MAZE_SHORTCUT_CHANGE_LEVELS: 'Cambiar de nivel',
    MAZE_SHORTCUT_TOGGLE_INSTRUCTIONS: 'Mostrar/ocultar instrucciones',
    MAZE_SHORTCUT_CHANGE_CHARACTER: 'Cambiar de personaje',
    MAZE_SHORTCUT_CHANGE_LANGUAGE: 'Cambiar idioma',
    MAZE_SHORTCUT_MUTE: 'Silenciar/activar sonido',
    MAZE_SETTINGS: 'Ajustes',
    MAZE_SETTING_BLOCK_MOVEMENT: 'Mover bloques con',
    MAZE_BLOCK_MOVEMENT_BOTH: 'Arrastrar o hacer clic',
    MAZE_BLOCK_MOVEMENT_CLICK: 'Clic para mover',
    MAZE_BLOCK_MOVEMENT_DRAG: 'Arrastrar',
    MAZE_SETTING_HIGHLIGHT_SIZE: 'Tamaño del resaltado de conexión',
    MAZE_HIGHLIGHT_MINIMAL: 'Mínimo',
    MAZE_HIGHLIGHT_MEDIUM: 'Medio',
    MAZE_HIGHLIGHT_LARGE: 'Grande',
    MAZE_DELETE_ALL_DATA: 'Borrar todos los datos guardados',
    MAZE_CLOSE: 'Cerrar',
    MAZE_ABOUT: 'Acerca de',
    MAZE_PAD_LEFT_DEC: 'Reducir margen izquierdo',
    MAZE_PAD_LEFT_INC: 'Aumentar margen izquierdo',
    MAZE_PAD_RIGHT_DEC: 'Reducir margen derecho',
    MAZE_PAD_RIGHT_INC: 'Aumentar margen derecho',

    // === Strings added in Step 1 (fix silent i18n bugs and route JS-side hardcoded strings) ===
    MAZE_INSTRUCTION_1: 'Llega a la meta.',
    MAZE_UNMUTE: 'Silenciar',
    MAZE_MUTE: 'Activar el sonido',
    MAZE_HELP_PROMPT: 'Pulsa → para ir a los campos del bloque',
    MAZE_TOAST_CLICK_TO_MOVE: 'Pulsa en una conexión para mover el bloque ahí',
    MAZE_TOAST_KEYBOARD_MOVE: 'Usa las flechas para mover el bloque, o Esc para salir del modo mover',
    MAZE_DELETE_DATA_TITLE: 'Eliminar todos los datos',
    MAZE_DELETE_DATA_MESSAGE: '¿Eliminar todos los programas y ajustes guardados? Esta acción no se puede deshacer.',
    MAZE_OK: 'OK',

    // ===========================================
    // Reusable Level Instructions
    // ===========================================

    // Stage A: Sequencing
    MAZE_INSTRUCTION_MOVE_FORWARD: 'Escribe un programa para avanzar y llegar a la meta.',
    MAZE_INSTRUCTION_NAVIGATE_TURNS: 'Atraviesa los giros para llegar a la meta.',
    MAZE_INSTRUCTION_USE_MOVE_AND_TURN: 'Usa los bloques de avanzar y girar para llegar a la meta.',

    // Stage B: Repeat X Times
    MAZE_INSTRUCTION_REPEAT_LONG_PATH: 'Usa un bloque «repetir» para recorrer el camino largo.',
    MAZE_INSTRUCTION_MULTIPLE_IN_REPEAT: 'Pon varios movimientos dentro de un bloque «repetir» para llegar a la meta.',
    MAZE_INSTRUCTION_CODE_BEFORE_REPEAT: 'Usa algo de código antes del bloque «repetir» para llegar a la meta.',
    MAZE_INSTRUCTION_WRITE_PROGRAM: 'Escribe un programa para llegar a la meta.',

    // Stage C: Repeat Until
    MAZE_INSTRUCTION_KEEP_GOING: 'Sigue avanzando hasta la meta.',
    MAZE_INSTRUCTION_KEEP_ZIGZAGGING: 'Sigue zigzagueando hasta la meta.',

    // Stage D: Colored Conditionals
    MAZE_INSTRUCTION_USE_COLORS: 'Usa las formas de colores para decidir hacia qué lado girar.',

    // Stage E: If-Else
    MAZE_INSTRUCTION_IF_ELSE_TWO_ACTIONS: 'Usa «si-sino» para elegir entre dos acciones.',
    MAZE_INSTRUCTION_IF_ELSE_PATH: 'Usa «si-sino» para elegir según dónde esté el camino.',

    // Stage F: Challenge
    MAZE_INSTRUCTION_USE_EVERYTHING: 'Usa todo lo que has aprendido para resolver este reto.',

    // Stage names and concepts (for stage progression UI)
    MAZE_STAGE_1_NAME: 'Secuenciación',
    MAZE_STAGE_1_CONCEPT: 'Los ordenadores siguen tus instrucciones una a una.\n\nEscribe un programa para decirle al personaje qué hacer y después ejecútalo para probarlo.',
    MAZE_STAGE_2_NAME: 'Repetir',
    MAZE_STAGE_2_CONCEPT: 'Los bucles nos permiten decirle al ordenador que repita unas instrucciones un número determinado de veces.\n\nUsa el bloque «repetir» para resolver estos retos.',
    MAZE_STAGE_3_NAME: 'Repetir hasta',
    MAZE_STAGE_3_CONCEPT: 'También podemos decirle al ordenador que repita instrucciones hasta llegar a la meta.',
    MAZE_STAGE_4_NAME: 'Condicionales',
    MAZE_STAGE_4_CONCEPT: 'Un bloque «si» le dice al ordenador que solo siga una instrucción cuando se cumple una condición.\n\nLos siguientes niveles te permiten dar instrucciones distintas según el color de una casilla.',
    MAZE_STAGE_5_NAME: 'Si-Sino',
    MAZE_STAGE_5_CONCEPT: 'Un bloque «si-sino» te permite elegir entre dos acciones.\n\nEstos niveles te permiten elegir instrucciones según el color, o detectar dónde hay un camino que seguir.',
    MAZE_STAGE_6_NAME: 'Reto',
    MAZE_STAGE_6_CONCEPT: '¡Combínalo todo para resolver estos laberintos difíciles!',
    MAZE_STAGE: 'Etapa',
    MAZE_STAGE_SELECT: 'Seleccionar etapa',

    // Grid coding stage names (for grid mode stage dropdown)
    MAZE_GRID_STAGE_1_NAME: 'Guiado',
    MAZE_GRID_STAGE_1_DESC: 'Ver cada movimiento',
    MAZE_GRID_STAGE_2_NAME: 'Reto',
    MAZE_GRID_STAGE_2_DESC: 'Construir y ejecutar',

    // New block messages for repeat times and colored conditionals
    MAZE_REPEAT: 'repetir',
    MAZE_TIMES: 'veces',
    MAZE_REPEAT_TIMES_TOOLTIP: 'Repite las acciones contenidas un número específico de veces.',
    MAZE_IF_ON: 'si está sobre',
    MAZE_IF_ON_RED: 'si está sobre rojo',
    MAZE_IF_ON_BLUE: 'si está sobre azul',
    MAZE_IF_COLOR: 'si está sobre %1',
    MAZE_IF_COLOR_TOOLTIP: 'Hacer algo si estás sobre una casilla de color.',
    MAZE_IF_COLOR_ELSE_TOOLTIP: 'Hacer algo si estás sobre una casilla de color; en otro caso, hacer otra cosa.',
    MAZE_COLOR_RED: 'rojo',
    MAZE_COLOR_BLUE: 'azul',

    // Extended level instructions for 26 levels
    MAZE_INSTRUCTION_11: 'Recorre el largo camino recto.',
    MAZE_INSTRUCTION_12: 'Usa «repetir» para subir el patrón en escalera.',
    MAZE_INSTRUCTION_13: 'Gira y avanza con bucles.',
    MAZE_INSTRUCTION_14: 'Combina bucles con giros.',
    MAZE_INSTRUCTION_15: 'Sigue avanzando hasta llegar a la meta.',
    MAZE_INSTRUCTION_16: 'Recorre el camino sinuoso.',
    MAZE_INSTRUCTION_17: 'Encuentra tu camino en el laberinto.',
    MAZE_INSTRUCTION_18: 'Resuelve este camino complejo.',
    MAZE_INSTRUCTION_19: 'Gira cuando veas una casilla roja.',
    MAZE_INSTRUCTION_20: 'Rojo significa girar a la izquierda; azul, a la derecha.',
    MAZE_INSTRUCTION_21: 'Sigue el camino de colores.',
    MAZE_INSTRUCTION_22: 'Usa los colores para recorrer el laberinto.',
    MAZE_INSTRUCTION_23: 'Gira cuando haya un camino a la izquierda.',
    MAZE_INSTRUCTION_24: 'Comprueba los caminos y gira según corresponda.',
    MAZE_INSTRUCTION_25: 'Avanza usando la detección de caminos.',
    MAZE_INSTRUCTION_26: 'Usa todas tus habilidades para resolver este laberinto.',
  },
};

/**
 * Current locale being used
 */
let currentLocale: SupportedLocale = 'en';

/**
 * Load messages for the specified locale into Blockly.Msg
 * @param locale The locale to load (defaults to 'en')
 */
export function loadMessages(locale: SupportedLocale = 'en'): void {
  const messages = MESSAGES[locale];

  if (!messages) {
    console.warn(`Locale '${locale}' not supported, falling back to English`);
    locale = 'en';
  }

  currentLocale = locale;

  // Step 1: load Blockly's built-in chrome strings for this locale.
  // This sets HUNDREDS of keys (DUPLICATE_BLOCK, DELETE_BLOCK, ADD_COMMENT,
  // COLLAPSE_BLOCK, variable/function dialog text, trash tooltips, HELP_PROMPT,
  // etc.) so the right-click context menu and built-in dialogs follow the
  // active locale. Must run BEFORE the MAZE_* overlay so our overrides win.
  Object.assign(Blockly.Msg, BLOCKLY_MSG_PACKS[locale]);

  // Step 2: overlay our MAZE_* (and any other) keys on top, so anything we
  // explicitly translate wins over the upstream Blockly pack.
  Object.entries(MESSAGES[locale]).forEach(([key, value]) => {
    Blockly.Msg[key] = value;
  });

  // Step 3: re-apply the MAZE_HELP_PROMPT override on top of HELP_PROMPT,
  // which the Blockly pack will have overwritten with the generic Blockly
  // wording. Our override is intentionally maze-specific (focuses on field
  // navigation).
  Blockly.Msg['HELP_PROMPT'] = msg('MAZE_HELP_PROMPT');
}

/**
 * Get a message by key from the current locale
 * @param key The message key
 * @param params Optional parameters to replace %1, %2, etc.
 * @returns The localized message
 */
export function msg(key: string, ...params: (string | number)[]): string {
  let message = MESSAGES[currentLocale]?.[key] || MESSAGES['en'][key] || key;

  // Replace parameters %1, %2, etc.
  params.forEach((param, index) => {
    message = message.replace(`%${index + 1}`, String(param));
  });

  return message;
}

/**
 * Get the current browser locale, or default to English
 * @returns A supported locale code
 */
export function getBrowserLocale(): SupportedLocale {
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en';
  const langCode = browserLang.toLowerCase().split('-')[0];

  // Check if we support this language
  if (langCode === 'fr') {
    return 'fr';
  }
  if (langCode === 'es') {
    return 'es';
  }

  // Default to English
  return 'en';
}

/**
 * Walk the DOM under `root` and translate any element annotated with a
 * `data-msg*` attribute using the current locale.
 *
 * Supported attributes:
 *   - `data-msg="KEY"`              -> sets textContent
 *   - `data-msg-aria-label="KEY"`   -> sets aria-label
 *   - `data-msg-title="KEY"`        -> sets title
 *   - `data-msg-placeholder="KEY"`  -> sets placeholder
 *
 * Call this after the locale changes (or on initial render) so static HTML
 * strings follow the active language without bespoke JS for each one.
 *
 * @param root Optional subtree to scan. Defaults to the whole document.
 */
export function applyDataMsg(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-msg]').forEach((el) => {
    const key = el.dataset.msg;
    if (key) {
      el.textContent = msg(key);
    }
  });
  root.querySelectorAll<HTMLElement>('[data-msg-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-msg-aria-label');
    if (key) {
      el.setAttribute('aria-label', msg(key));
    }
  });
  root.querySelectorAll<HTMLElement>('[data-msg-title]').forEach((el) => {
    const key = el.getAttribute('data-msg-title');
    if (key) {
      el.setAttribute('title', msg(key));
    }
  });
  root.querySelectorAll<HTMLElement>('[data-msg-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-msg-placeholder');
    if (key) {
      el.setAttribute('placeholder', msg(key));
    }
  });
}
