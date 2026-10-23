/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tests for maze game keyboard shortcuts. Each suite navigates
 * to a fresh URL to avoid state leaking between test groups.
 */

import * as chai from 'chai';
import {Key} from 'webdriverio';
import {
  mazeSetup,
  getText,
  getValue,
  pressKey,
  assertNoJavaScriptErrors,
  PAUSE_TIME,
} from './maze_test_setup.js';

suite('Level navigation shortcuts', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('level=2');
  });

  test('pressing ] advances to the next level', async function () {
    const initialText = await getText(this.browser, '#levelDisplay');
    chai.assert.include(initialText, '2', 'should start at level 2');

    await pressKey(this.browser, ']');

    await this.browser.waitUntil(
      async () => {
        const text = await getText(this.browser, '#levelDisplay');
        return text !== initialText;
      },
      {timeout: 5000, timeoutMsg: 'Level display did not update after ]'},
    );

    const newText = await getText(this.browser, '#levelDisplay');
    chai.assert.include(newText, '3');
  });

  test('pressing [ goes to the previous level', async function () {
    // Navigate fresh to level 3, then verify [ takes us to level 2
    this.timeout(30000);
    await mazeSetup('level=3');
    const initialText = await getText(this.browser, '#levelDisplay');
    chai.assert.include(initialText, '3', 'should start at level 3');

    await pressKey(this.browser, '[');

    await this.browser.waitUntil(
      async () => {
        const text = await getText(this.browser, '#levelDisplay');
        return text.includes('2');
      },
      {timeout: 5000, timeoutMsg: 'Level display did not change to level 2 after ['},
    );

    const text = await getText(this.browser, '#levelDisplay');
    chai.assert.include(text, '2');
  });
});

suite('Stage navigation shortcuts', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('stage=1');
  });

  test('pressing } (Shift+]) advances to the next stage', async function () {
    const initialValue = await getValue(this.browser, '#stageDropdown');

    await pressKey(this.browser, '}');

    await this.browser.waitUntil(
      async () => {
        const value = await getValue(this.browser, '#stageDropdown');
        return value !== initialValue;
      },
      {timeout: 5000, timeoutMsg: 'Stage dropdown did not update after }'},
    );

    const newValue = await getValue(this.browser, '#stageDropdown');
    const newId = parseInt(newValue, 10);
    const initialId = parseInt(initialValue, 10);
    chai.assert.isAbove(newId, initialId, 'stage should have advanced');
  });

  test('pressing { (Shift+[) goes to the previous stage', async function () {
    // Navigate fresh to grid coding mode stage 2 (dropdown reliably shows '2'),
    // then verify { takes us back to stage 1
    this.timeout(30000);
    await mazeSetup('grid=1&mode=coding&stage=2');
    const initialValue = await getValue(this.browser, '#stageDropdown');

    await pressKey(this.browser, '{');

    await this.browser.waitUntil(
      async () => {
        const value = await getValue(this.browser, '#stageDropdown');
        return value !== initialValue;
      },
      {timeout: 5000, timeoutMsg: 'Stage dropdown did not update after {'},
    );

    const finalValue = await getValue(this.browser, '#stageDropdown');
    const finalId = parseInt(finalValue, 10);
    const initialId = parseInt(initialValue, 10);
    chai.assert.isBelow(finalId, initialId, 'stage should have decreased');
  });
});

suite('Instruction bar toggle (H key)', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    // mazeSetup clears mazeDisplayMode from localStorage, so we start at 'both'
    this.browser = await mazeSetup('');
  });

  test('pressing H cycles through display modes', async function () {
    // Default is 'both' — bar is visible
    const initialVisible = await this.browser.$(
      '#instructionBar',
    ).isDisplayed();
    chai.assert.isTrue(initialVisible, 'instruction bar should start visible');

    // Press H once: both -> instructions (still visible, no hidden class)
    await pressKey(this.browser, 'H');
    await this.browser.pause(PAUSE_TIME || 200);
    const afterFirst = await this.browser.$('#instructionBar').isDisplayed();
    chai.assert.isTrue(afterFirst, 'bar should still be visible in instructions mode');

    // Press H again: instructions -> none (hidden)
    await pressKey(this.browser, 'H');
    await this.browser.waitUntil(
      async () => {
        return !(await this.browser.$('#instructionBar').isDisplayed());
      },
      {timeout: 3000, timeoutMsg: 'Instruction bar should hide after second H press'},
    );
    const afterSecond = await this.browser.$('#instructionBar').isDisplayed();
    chai.assert.isFalse(afterSecond, 'bar should be hidden in none mode');

    // Press H a third time: none -> both (visible again)
    await pressKey(this.browser, 'H');
    await this.browser.waitUntil(
      async () => {
        return await this.browser.$('#instructionBar').isDisplayed();
      },
      {timeout: 3000, timeoutMsg: 'Instruction bar should reappear after third H press'},
    );
    const afterThird = await this.browser.$('#instructionBar').isDisplayed();
    chai.assert.isTrue(afterThird, 'bar should return to visible state');
  });
});

suite('Language toggle (L key)', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    // mazeSetup clears mazeLanguage from localStorage, so default is 'en'
    this.browser = await mazeSetup('');
  });

  test('initial language is English', async function () {
    const value = await getValue(this.browser, '#languageSelect');
    chai.assert.equal(value, 'en');
  });

  test('pressing L switches to French', async function () {
    await pressKey(this.browser, 'L');

    await this.browser.waitUntil(
      async () => {
        const value = await getValue(this.browser, '#languageSelect');
        return value !== 'en';
      },
      {timeout: 3000, timeoutMsg: 'Language did not change after L'},
    );

    const value = await getValue(this.browser, '#languageSelect');
    chai.assert.equal(value, 'fr');
  });

  test('pressing L again switches to Spanish', async function () {
    await pressKey(this.browser, 'L');

    await this.browser.waitUntil(
      async () => {
        const value = await getValue(this.browser, '#languageSelect');
        return value === 'es';
      },
      {timeout: 3000, timeoutMsg: 'Language did not switch to es after second L'},
    );

    const value = await getValue(this.browser, '#languageSelect');
    chai.assert.equal(value, 'es');
  });

  test('pressing L again returns to English', async function () {
    await pressKey(this.browser, 'L');

    await this.browser.waitUntil(
      async () => {
        const value = await getValue(this.browser, '#languageSelect');
        return value === 'en';
      },
      {timeout: 3000, timeoutMsg: 'Language did not return to en after third L'},
    );

    const value = await getValue(this.browser, '#languageSelect');
    chai.assert.equal(value, 'en');
  });
});

suite('Character selector shortcuts', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
  });

  test('pressing . (next character) produces no JS errors', async function () {
    await pressKey(this.browser, '.');
    await this.browser.pause(PAUSE_TIME || 300);
    await assertNoJavaScriptErrors(this.browser, 'next character (.)');
  });

  test('pressing , (previous character) produces no JS errors', async function () {
    await pressKey(this.browser, ',');
    await this.browser.pause(PAUSE_TIME || 300);
    await assertNoJavaScriptErrors(this.browser, 'previous character (,)');
  });
});

suite('Run shortcut in coding mode (r key)', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
  });

  test('pressing r runs the program (no JS errors)', async function () {
    await pressKey(this.browser, 'r');
    await this.browser.pause(PAUSE_TIME || 500);
    await assertNoJavaScriptErrors(this.browser, 'run shortcut (r)');
  });
});

suite('Reset shortcut in coding mode (Shift+R)', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
  });

  test('pressing Shift+R resets the maze (no JS errors)', async function () {
    await this.browser.keys([Key.Shift, 'R']);
    await this.browser.pause(PAUSE_TIME || 300);
    await assertNoJavaScriptErrors(this.browser, 'reset shortcut (Shift+R)');
  });

  test('#resetButton is present and not disabled after reset', async function () {
    const resetBtn = await this.browser.$('#resetButton');
    chai.assert.isTrue(await resetBtn.isExisting(), '#resetButton should exist');
    const disabled = await resetBtn.getAttribute('disabled');
    chai.assert.isNull(disabled, '#resetButton should not be disabled after reset');
  });
});

suite('Practice mode movement shortcuts', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('mode=practice');
    // Focus the page body so keyboard events are dispatched
    await this.browser.execute(() => document.body.focus());
  });

  test('pressing ArrowUp produces no JS errors', async function () {
    await this.browser.keys([Key.ArrowUp]);
    await this.browser.pause(PAUSE_TIME || 400);
    await assertNoJavaScriptErrors(this.browser, 'ArrowUp in practice mode');
  });

  test('pressing W produces no JS errors', async function () {
    await pressKey(this.browser, 'w');
    await this.browser.pause(PAUSE_TIME || 400);
    await assertNoJavaScriptErrors(this.browser, 'W in practice mode');
  });

  test('pressing ArrowLeft produces no JS errors', async function () {
    await this.browser.keys([Key.ArrowLeft]);
    await this.browser.pause(PAUSE_TIME || 400);
    await assertNoJavaScriptErrors(this.browser, 'ArrowLeft in practice mode');
  });

  test('pressing ArrowRight produces no JS errors', async function () {
    await this.browser.keys([Key.ArrowRight]);
    await this.browser.pause(PAUSE_TIME || 400);
    await assertNoJavaScriptErrors(this.browser, 'ArrowRight in practice mode');
  });
});

suite('Grid coding insertion shortcuts', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    // Use stage=2 (delayed execution mode) so blocks are inserted without
    // animating the maze character — avoids flakiness from wall collisions.
    this.browser = await mazeSetup('grid=1&mode=coding&stage=2');
  });

  test('initial block count is 0', async function () {
    const text = await getText(this.browser, '#gridCodingBlockCount');
    chai.assert.include(text, '0');
  });

  test('pressing Shift+ArrowUp inserts a forward block (count becomes 1)', async function () {
    await this.browser.keys([Key.Shift, Key.ArrowUp]);

    await this.browser.waitUntil(
      async () => {
        const text = await getText(this.browser, '#gridCodingBlockCount');
        return text.includes('1');
      },
      {timeout: 5000, timeoutMsg: 'Block count did not reach 1 after Shift+ArrowUp'},
    );

    const text = await getText(this.browser, '#gridCodingBlockCount');
    chai.assert.include(text, '1');
  });

  test('pressing Shift+ArrowLeft inserts a turn-left block (count becomes 2)', async function () {
    await this.browser.keys([Key.Shift, Key.ArrowLeft]);

    await this.browser.waitUntil(
      async () => {
        const text = await getText(this.browser, '#gridCodingBlockCount');
        return text.includes('2');
      },
      {timeout: 5000, timeoutMsg: 'Block count did not reach 2 after Shift+ArrowLeft'},
    );

    const text = await getText(this.browser, '#gridCodingBlockCount');
    chai.assert.include(text, '2');
  });

  test('pressing Shift+ArrowRight inserts a turn-right block (count becomes 3)', async function () {
    await this.browser.keys([Key.Shift, Key.ArrowRight]);

    await this.browser.waitUntil(
      async () => {
        const text = await getText(this.browser, '#gridCodingBlockCount');
        return text.includes('3');
      },
      {timeout: 5000, timeoutMsg: 'Block count did not reach 3 after Shift+ArrowRight'},
    );

    const text = await getText(this.browser, '#gridCodingBlockCount');
    chai.assert.include(text, '3');
  });

  test('pressing Shift+Backspace undoes the last block (count becomes 2)', async function () {
    await this.browser.keys([Key.Shift, Key.Backspace]);

    await this.browser.waitUntil(
      async () => {
        const text = await getText(this.browser, '#gridCodingBlockCount');
        return !text.includes('3') && text.includes('2');
      },
      {timeout: 5000, timeoutMsg: 'Block count did not return to 2 after Shift+Backspace'},
    );

    const text = await getText(this.browser, '#gridCodingBlockCount');
    chai.assert.include(text, '2');
  });
});
