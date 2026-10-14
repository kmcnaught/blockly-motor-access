#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enforces switch-access annotations on every <dialog> under test/.
 *
 *   1. Every <dialog> must carry either `data-scan-region="..."` (the
 *      SwitchScanController will discover its items) OR `data-no-scan`
 *      (explicit opt-out — e.g. grid-mode dialogs, which switch-access
 *      doesn't target).
 *   2. Every interactive control (button, select, summary) inside a
 *      `[data-scan-region]` must carry `data-scan-item`, otherwise it
 *      is invisible to the scanner. The settings modal wraps checkboxes
 *      in `<label data-scan-item>` — labels aren't universally
 *      interactive so they're not auto-required; add the tag where you
 *      want them scanned.
 *
 * Run via `npm run check:scannable`.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCANNABLE_SELECTOR = 'button, select, summary';

function walkHtml(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const HTML_PATHS = walkHtml(path.join(__dirname, '..', 'test'), []);

const violations = [];

function lineOf(source, substring) {
  const idx = source.indexOf(substring);
  if (idx === -1) return '?';
  return source.slice(0, idx).split('\n').length;
}

for (const htmlPath of HTML_PATHS) {
  const source = fs.readFileSync(htmlPath, 'utf8');
  const { document } = new JSDOM(source).window;
  const rel = path.relative(path.join(__dirname, '..'), htmlPath);

  document.querySelectorAll('dialog').forEach((dialog) => {
    const hasRegion = dialog.hasAttribute('data-scan-region');
    const hasNoScan = dialog.hasAttribute('data-no-scan');
    const id = dialog.id || '(no id)';
    const line = lineOf(source, `<dialog id="${dialog.id}"`);

    if (!hasRegion && !hasNoScan) {
      violations.push(
        `${rel}:${line}  <dialog id="${id}"> is missing both data-scan-region and data-no-scan. ` +
        `Add data-scan-region="..." (scannable) or data-no-scan (explicit opt-out).`,
      );
      return;
    }
    if (hasRegion && hasNoScan) {
      violations.push(
        `${rel}:${line}  <dialog id="${id}"> has both data-scan-region and data-no-scan — pick one.`,
      );
      return;
    }
    if (!hasRegion) return; // opt-out; no further checks.

    dialog.querySelectorAll(SCANNABLE_SELECTOR).forEach((el) => {
      if (el.hasAttribute('data-scan-item')) return;
      // A control nested inside a scan-item ancestor (e.g. a checkbox
      // inside <label data-scan-item>) is reached via the ancestor.
      if (el.closest('[data-scan-item]')) return;
      const tag = el.tagName.toLowerCase();
      const elId = el.id || '(no id)';
      const idProbe = el.id ? `id="${el.id}"` : `<${tag}`;
      const elLine = lineOf(source, idProbe);
      violations.push(
        `${rel}:${elLine}  <${tag} id="${elId}"> inside scan-region "${dialog.getAttribute('data-scan-region')}" is missing data-scan-item.`,
      );
    });
  });
}

if (violations.length > 0) {
  console.error('check:scannable found switch-access gaps:\n');
  for (const v of violations) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s). Fix or annotate with data-no-scan.`);
  process.exit(1);
}

console.log(
  `check:scannable: all dialogs annotated and all scan-region controls tagged (${HTML_PATHS.length} HTML file(s)).`,
);
