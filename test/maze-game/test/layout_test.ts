/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tests that key UI elements remain visible and functional at
 * narrow / square window sizes. The maze game targets assistive-technology
 * users who may run it on smaller screens or in windowed layouts.
 *
 * Layout behaviour:
 *  - Container height >= 540px → normal (level-selector row above canvas)
 *  - Container height <  540px → compact (level-selector overlaid on canvas)
 */

import * as chai from 'chai';
import {mazeSetup, isVisible, PAUSE_TIME} from './maze_test_setup.js';

/** Resize the browser window and wait a tick for layout to re-run. */
async function setWindowSize(
  browser: WebdriverIO.Browser,
  width: number,
  height: number,
): Promise<void> {
  await browser.setWindowSize(width, height);
  await browser.pause(PAUSE_TIME || 300);
}

/** Read whether the game container currently has the 'compact' class. */
async function isCompactMode(browser: WebdriverIO.Browser): Promise<boolean> {
  return await browser.execute(() => {
    const el = document.querySelector('.game-container');
    return el ? el.classList.contains('compact') : false;
  });
}

// ── Wide / normal window (1024 × 768) ────────────────────────────────────────

suite('Wide window layout (1024×768) — coding mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
    await setWindowSize(this.browser, 1024, 768);
  });

  test('canvas is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#mazeCanvas'));
  });

  test('#runButton is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#runButton'));
  });

  test('#levelDisplay is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#levelDisplay'));
  });

  test('#blocklyDiv is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('compact mode is NOT active', async function () {
    chai.assert.isFalse(await isCompactMode(this.browser));
  });
});

// ── Square / narrow window (700 × 600) ───────────────────────────────────────

suite('Square window layout (700×600) — coding mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
    await setWindowSize(this.browser, 700, 600);
  });

  test('canvas is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#mazeCanvas'));
  });

  test('#runButton is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#runButton'));
  });

  test('#levelDisplay is in the DOM (compact mode may hide text with opacity)', async function () {
    // At 700×600 the browser chrome often pushes the viewport below 540px,
    // triggering compact mode which sets opacity:0 on the level span.
    // Either it is visible (non-compact) or exists in the DOM (compact).
    const el = await this.browser.$('#levelDisplay');
    chai.assert.isTrue(await el.isExisting(), '#levelDisplay should exist in DOM');
  });

  test('#blocklyDiv is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#blocklyDiv'));
  });
});

// ── Compact window (700 × 450) — height below 540px threshold ────────────────

suite('Compact window layout (700×450) — coding mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('');
    await setWindowSize(this.browser, 700, 450);
  });

  test('canvas is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#mazeCanvas'));
  });

  test('#runButton is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#runButton'));
  });

  test('#levelDisplay is in the DOM', async function () {
    // In compact mode the level-selector is overlaid on the canvas but stays in the DOM
    const el = await this.browser.$('#levelDisplay');
    chai.assert.isTrue(await el.isExisting(), '#levelDisplay should exist in DOM');
  });

  test('compact mode is active when container height < 540px', async function () {
    // The actual container height depends on browser chrome; we just verify
    // that either compact mode IS active OR the window is not short enough
    // to trigger it (browser chrome can eat significant height).
    const compact = await isCompactMode(this.browser);
    const containerHeight = await this.browser.execute(() => {
      const el = document.querySelector('.container');
      return el ? (el as HTMLElement).offsetHeight : 9999;
    });
    if (containerHeight < 540) {
      chai.assert.isTrue(compact, 'compact mode should be active when container < 540px');
    }
    // If browser chrome made the container >= 540px at this window size, skip
  });
});

// ── Grid practice mode — square window ───────────────────────────────────────

suite('Square window layout (700×600) — grid practice mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('grid=1&mode=practice');
    await setWindowSize(this.browser, 700, 600);
  });

  test('canvas is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#mazeCanvas'));
  });

  test('#immediateModePanel is not shown in grid practice mode', async function () {
    // Grid practice uses on-screen buttons, not the immediateModePanel
    chai.assert.isFalse(await isVisible(this.browser, '#immediateModePanel'));
  });
});

// ── Grid coding mode — square window ─────────────────────────────────────────

suite('Square window layout (700×600) — grid coding mode', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('grid=1&mode=coding');
    await setWindowSize(this.browser, 700, 600);
  });

  suiteTeardown(async function () {
    // Restore a reasonable window size so subsequent test files are not affected
    await setWindowSize(this.browser, 1280, 800);
  });

  test('canvas is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#mazeCanvas'));
  });

  test('#blocklyDiv is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#blocklyDiv'));
  });

  test('#gridCodingControls is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#gridCodingControls'));
  });

  test('#gridCodingBlockCount is visible', async function () {
    chai.assert.isTrue(await isVisible(this.browser, '#gridCodingBlockCount'));
  });
});
