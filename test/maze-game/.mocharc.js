/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

module.exports = {
  ui: 'tdd',
  timeout: 10000,
  require: __dirname + '/test/dist/hooks.js',
  reporter: 'mochawesome',
  reporterOptions: {
    reportDir: __dirname + '/test/mochawesome-report',
    reportFilename: 'test-report',
    html: true,
    json: false,
    quiet: false,
    consoleReporter: 'spec',
  },
};
