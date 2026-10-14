/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Regression tests for the switch-scan "pinned subject"
 * overlay (`.switch-scan-pinned`). The dashed outline marks the block
 * the current action will operate on; it must appear whenever the
 * active scan frame has a subject block, and stay hidden for frames
 * that don't (top-level cycle, header dropdowns, toolbox / workspace
 * block-browse frames).
 *
 * Coverage scope: this suite exercises the plumbing (element presence,
 * initial hidden state, no-flash during top-level cycle). Per-frame-
 * kind behavioural coverage (action-menu / dropdown-values / move-
 * candidates each produce a visible outline on their subject block)
 * is not driven here — reliably steering the switch-scan state machine
 * into each sub-scan from pure wdio keystrokes is layout-dependent and
 * brittle. The resolver's exhaustive switch gives us compile-time
 * safety for "a new frame kind forgot the policy"; the behavioural
 * cases are covered by Step 5's manual browser check.
 */

import * as chai from 'chai';
import {
  mazeSetup,
  PAUSE_TIME,
} from './maze_test_setup.js';

/**
 * Read a DOM element's `display` style. Returns `null` if the element
 * doesn't exist (lets a test distinguish "missing" from "hidden").
 *
 * @param browser WebdriverIO browser session.
 * @param selector CSS selector of the element to inspect.
 */
async function getDisplayStyle(
  browser: WebdriverIO.Browser,
  selector: string,
): Promise<string | null> {
  return await browser.execute((sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    return el.style.display || window.getComputedStyle(el).display;
  }, selector);
}

suite('Switch-scan pinned overlay — plumbing', function () {
  if (PAUSE_TIME) this.timeout(0);

  suiteSetup(async function () {
    this.timeout(30000);
    this.browser = await mazeSetup('inputMode=switch-scan');
  });

  test('.switch-scan-pinned element exists in the DOM', async function () {
    const display = await getDisplayStyle(this.browser, '.switch-scan-pinned');
    chai.assert.isNotNull(
      display,
      '.switch-scan-pinned should be created at enable() time',
    );
  });

  test('.switch-scan-pinned is hidden on initial load (top frame has no subject)', async function () {
    const display = await getDisplayStyle(this.browser, '.switch-scan-pinned');
    chai.assert.equal(
      display,
      'none',
      'pinned outline should start hidden — the top-level frame carries no subject block',
    );
  });

  test('.switch-scan-highlight (solid scan cursor) exists alongside the pinned overlay', async function () {
    const display = await getDisplayStyle(
      this.browser,
      '.switch-scan-highlight',
    );
    chai.assert.isNotNull(
      display,
      'solid highlight element should also be present — the two overlays are a pair',
    );
  });

  test('advancing through top-level regions keeps the pinned outline hidden', async function () {
    // The top frame cycles through regions (header, toolbox, workspace,
    // maze-actions...). None of those carry a subject block, so the
    // dashed outline should never flash on.
    for (let i = 0; i < 6; i++) {
      await this.browser.keys([' ']);
      await this.browser.pause(PAUSE_TIME || 150);
      const display = await getDisplayStyle(
        this.browser,
        '.switch-scan-pinned',
      );
      chai.assert.equal(
        display,
        'none',
        `pinned outline should stay hidden on top-level step ${i + 1}`,
      );
    }
  });
});
