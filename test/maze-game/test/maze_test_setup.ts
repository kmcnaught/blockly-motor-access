/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Shared helpers and browser driver management for maze game
 * WebdriverIO tests.
 */

import * as webdriverio from 'webdriverio';

export const PAUSE_TIME = Number(process.env['PAUSE_TIME'] ?? 0);
export const MAZE_BASE_URL = 'http://localhost:8082';

let driver: webdriverio.Browser | null = null;

/**
 * Start up WebdriverIO. Called once before all suites via hooks.
 */
export async function driverSetup(
  wdioWaitTimeoutMs: number,
): Promise<webdriverio.Browser> {
  const options = {
    capabilities: {
      'browserName': 'chrome',
      'unhandledPromptBehavior': 'ignore',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'goog:chromeOptions': {
        args: ['--allow-file-access-from-files'],
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'wdio:enforceWebDriverClassic': true,
    },
    waitforTimeout: wdioWaitTimeoutMs,
    logLevel: 'warn' as const,
  };

  if (process.env.CI) {
    options.capabilities['goog:chromeOptions'].args.push(
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    );
  } else {
    options.capabilities['goog:chromeOptions'].args.push('--disable-gpu');
  }

  console.log('Starting webdriverio for maze tests...');
  driver = await webdriverio.remote(options);
  return driver;
}

/**
 * End the WebdriverIO session.
 */
export async function driverTeardown(): Promise<void> {
  await driver?.deleteSession();
  driver = null;
}

/**
 * Navigate to the maze game with the given URL params and wait for the canvas.
 * Clears localStorage first to ensure a clean state.
 *
 * @param params URL query string (without the '?'), e.g. 'mode=practice'
 */
export async function mazeSetup(
  params = '',
): Promise<webdriverio.Browser> {
  if (!driver) {
    throw new Error('Driver not initialised. Ensure driverSetup() ran in hooks.');
  }
  const url = params ? `${MAZE_BASE_URL}?${params}` : MAZE_BASE_URL;
  await driver.url(url);
  // Clear ALL persisted state that could affect test results
  await driver.execute(() => localStorage.clear());
  // Reload so the fresh page reads cleared localStorage
  await driver.refresh();
  await driver.$('#mazeCanvas').waitForExist({timeout: 15000});
  // Wait long enough for any auto-showing intro dialogs (500ms timeout in code)
  await driver.pause(800);
  // Dismiss any dialogs that opened automatically (stage intro, grid intros, etc.)
  await driver.execute(() => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => {
      // Click the first focusable button inside (OK / close button)
      const btn = d.querySelector<HTMLElement>('button');
      if (btn) btn.click();
      else d.close();
    });
  });
  return driver;
}

/**
 * Returns whether the element matching selector is currently displayed.
 */
export async function isVisible(
  browser: webdriverio.Browser,
  selector: string,
): Promise<boolean> {
  const el = await browser.$(selector);
  if (!(await el.isExisting())) return false;
  return await el.isDisplayed();
}

/**
 * Returns the text content of the element matching selector.
 * Uses execute() to read textContent directly, bypassing WebdriverIO's
 * visibility check (which returns '' for opacity:0 elements).
 */
export async function getText(
  browser: webdriverio.Browser,
  selector: string,
): Promise<string> {
  return await browser.execute((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent ?? '') : '';
  }, selector);
}

/**
 * Returns the value of a form element (e.g. <select>) matching selector.
 */
export async function getValue(
  browser: webdriverio.Browser,
  selector: string,
): Promise<string> {
  const el = await browser.$(selector);
  return await el.getValue();
}

/**
 * Sends a key or key combination and waits for the DOM to settle.
 *
 * @param browser The active WebdriverIO browser.
 * @param keys A single key string or array (e.g. ['Shift', 'ArrowUp']).
 */
export async function pressKey(
  browser: webdriverio.Browser,
  keys: string | string[],
): Promise<void> {
  const keyArray = Array.isArray(keys) ? keys : [keys];
  await browser.keys(keyArray);
  if (PAUSE_TIME > 0) {
    await browser.pause(PAUSE_TIME);
  }
}

/**
 * Asserts that no JavaScript errors occurred in the browser console.
 */
export async function assertNoJavaScriptErrors(
  browser: webdriverio.Browser,
  testDescription?: string,
): Promise<void> {
  const logs = await browser.getLogs('browser');
  const jsErrors = logs.filter(
    (log: any) =>
      log.level === 'SEVERE' &&
      log.message &&
      (log.message.includes('ERROR') ||
        log.message.includes('Error') ||
        log.message.includes('Uncaught') ||
        log.message.includes('TypeError') ||
        log.message.includes('ReferenceError')),
  );

  if (jsErrors.length > 0) {
    const errorMessages = jsErrors.map((e: any) => e.message || e).join('; ');
    const context = testDescription ? ` during ${testDescription}` : '';
    throw new Error(`JavaScript errors detected${context}: ${errorMessages}`);
  }
}
