/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Mocha root hooks — creates a single shared ChromeDriver
 * instance for the entire maze test run.
 */

import {RootHookObject} from 'mocha';
import {driverSetup, driverTeardown} from './maze_test_setup.js';

export const mochaHooks: RootHookObject = {
  async beforeAll(this: Mocha.Context) {
    this.timeout(60000);
    return await driverSetup(this.timeout());
  },
  async afterAll() {
    await driverTeardown();
  },
};
