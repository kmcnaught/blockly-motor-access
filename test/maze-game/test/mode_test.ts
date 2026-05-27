/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tests that URL parameters produce the correct DOM layout for
 * each of the four maze game modes.
 */

import * as chai from 'chai';
import {
  mazeSetup,
  isVisible,
  getText,
  getValue,
  PAUSE_TIME,
} from './maze_test_setup.js';

suite('Normal coding mode (default)', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
  });

  test('#blocklyDiv is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('#runButton is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#runButton'));
  });

  test('#modeToggle is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#modeToggle'));
  });

  test('#immediateModePanel is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#immediateModePanel'));
  });

  test('#gridCodingControls is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#gridCodingControls'));
  });

  test('#padLeftIncBtn is displayed (padding controls visible)', async function () {
    // padLeftDecBtn is hidden until padding has been increased; the inc button is always visible
    chai.assert.isTrue(await isVisible(this.browser, '#padLeftIncBtn'));
  });
});

suite('Normal practice mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('mode=practice');
  });

  test('#blocklyDiv is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('#runButton is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#runButton'));
  });

  test('#immediateModePanel is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#immediateModePanel'));
  });

  test('#cmdForward is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#cmdForward'));
  });

  test('#cmdTurnLeft is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#cmdTurnLeft'));
  });

  test('#modeLabel text includes "Practice"', async function () {
    const text = await getText(this.browser, '#modeLabel');
    chai.assert.include(text, 'Practice');
  });

  test('#padLeftIncBtn is displayed', async function () {
    // padLeftDecBtn is hidden until padding has been increased; the inc button is always visible
    chai.assert.isTrue(await isVisible(this.browser, '#padLeftIncBtn'));
  });
});

suite('Grid coding mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('grid=1&mode=coding');
  });

  test('#blocklyDiv is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('#runButton is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#runButton'));
  });

  test('#gridCodingControls is displayed', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#gridCodingControls'));
  });

  test('#immediateModePanel is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#immediateModePanel'));
  });

  test('#modeToggle is not displayed (hidden in grid modes)', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#modeToggle'));
  });

  test('#padLeftDecBtn is not displayed (hidden in grid modes)', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#padLeftDecBtn'));
  });
});

suite('Grid practice mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('grid=1&mode=practice');
  });

  test('#blocklyDiv is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('#runButton is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#runButton'));
  });

  test('#gridCodingControls is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#gridCodingControls'));
  });

  test('#modeToggle is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#modeToggle'));
  });

  test('#padLeftDecBtn is not displayed', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#padLeftDecBtn'));
  });
});

suite('Mode toggle button', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('mode=coding');
  });

  test('clicking #modeToggle switches to Practice mode', async function () {
    const toggleBtn = await this.browser.$('#modeToggle');
    await toggleBtn.click();
    await this.browser.pause(PAUSE_TIME || 300);

    const labelText = await getText(this.browser, '#modeLabel');
    chai.assert.include(labelText, 'Practice');
  });

  test('#blocklyDiv is hidden after toggle', async function () {
    chai.assert.isFalse(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('#immediateModePanel is displayed after toggle', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#immediateModePanel'));
  });
});

suite('Level URL parameter', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('level=3');
  });

  test('#levelDisplay text contains "3"', async function () {
    const text = await getText(this.browser, '#levelDisplay');
    chai.assert.include(text, '3');
  });
});

suite('Stage URL parameter (grid mode)', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    // stage= URL param controls the grid stage dropdown in grid coding mode
    this.browser = await mazeSetup('grid=1&mode=coding&stage=2');
  });

  test('#stageDropdown value corresponds to stage 2', async function () {
    const value = await getValue(this.browser, '#stageDropdown');
    chai.assert.equal(value, '2');
  });
});
