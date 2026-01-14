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

/**
 * Supported languages for the maze game
 */
export type SupportedLocale = 'en' | 'fr';

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
    MAZE_GRID_CODING_SUCCESS_MESSAGE: 'You wrote a program with %1 blocks! Press RUN to see it again.',
    MAZE_GRID_CODING_RUN_AGAIN: 'Run Again',
    MAZE_GRID_CODING_GRADUATION_TITLE: 'Amazing!',
    MAZE_GRID_CODING_GRADUATION_MESSAGE: 'You completed all the coding levels with %1 blocks!',
    MAZE_GRID_CODING_STAGE_COMPLETE_TITLE: 'Well Done!',
    MAZE_GRID_CODING_STAGE_COMPLETE_MESSAGE: 'You have finished all the introductory levels! You will need a different gridset to explore more advanced coding.',

    // Workspace controls
    MAZE_CLEAR_WORKSPACE: 'Delete all blocks',

    // Level instructions (what the user should accomplish)
    MAZE_INSTRUCTION_1: 'Get to the goal using move and turn blocks.',
    MAZE_INSTRUCTION_2: 'Navigate the turns to reach the goal.',
    MAZE_INSTRUCTION_3: 'Use a repeat loop to reach the goal with fewer blocks.',
    MAZE_INSTRUCTION_4: 'Put multiple blocks inside the repeat loop.',
    MAZE_INSTRUCTION_5: 'Solve the maze using loops.',
    MAZE_INSTRUCTION_6: 'Use the "if" block to turn when there\'s a path.',
    MAZE_INSTRUCTION_7: 'Change the "if" condition to check different directions.',
    MAZE_INSTRUCTION_8: 'Combine loops and conditions to solve the maze.',
    MAZE_INSTRUCTION_9: 'Use "if-else" to handle both paths.',
    MAZE_INSTRUCTION_10: 'Solve this challenging maze using all your skills.',

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
    MAZE_GRID_CODING_SUCCESS_MESSAGE: 'Vous avez écrit un programme de %1 blocs ! Appuyez sur EXÉCUTER pour le revoir.',
    MAZE_GRID_CODING_RUN_AGAIN: 'Relancer',
    MAZE_GRID_CODING_GRADUATION_TITLE: 'Incroyable !',
    MAZE_GRID_CODING_GRADUATION_MESSAGE: 'Vous avez terminé tous les niveaux de programmation avec %1 blocs !',
    MAZE_GRID_CODING_STAGE_COMPLETE_TITLE: 'Bravo !',
    MAZE_GRID_CODING_STAGE_COMPLETE_MESSAGE: 'Vous avez terminé tous les niveaux d\'introduction ! Vous aurez besoin d\'un autre gridset pour explorer la programmation avancée.',

    // Workspace controls
    MAZE_CLEAR_WORKSPACE: 'Supprimer tous les blocs',

    // Level instructions (what the user should accomplish)
    MAZE_INSTRUCTION_1: 'Atteignez l\'objectif en utilisant les blocs avancer et tourner.',
    MAZE_INSTRUCTION_2: 'Naviguez dans les virages pour atteindre l\'objectif.',
    MAZE_INSTRUCTION_3: 'Utilisez une boucle pour atteindre l\'objectif avec moins de blocs.',
    MAZE_INSTRUCTION_4: 'Mettez plusieurs blocs dans la boucle.',
    MAZE_INSTRUCTION_5: 'Résolvez le labyrinthe en utilisant des boucles.',
    MAZE_INSTRUCTION_6: 'Utilisez le bloc « si » pour tourner quand il y a un chemin.',
    MAZE_INSTRUCTION_7: 'Changez la condition « si » pour vérifier différentes directions.',
    MAZE_INSTRUCTION_8: 'Combinez boucles et conditions pour résoudre le labyrinthe.',
    MAZE_INSTRUCTION_9: 'Utilisez « si-sinon » pour gérer les deux chemins.',
    MAZE_INSTRUCTION_10: 'Résolvez ce labyrinthe difficile en utilisant toutes vos compétences.',

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

  // Load all messages into Blockly.Msg
  Object.entries(MESSAGES[locale]).forEach(([key, value]) => {
    Blockly.Msg[key] = value;
  });
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

  // Default to English
  return 'en';
}
