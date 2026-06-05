#!/usr/bin/env tsx
/**
 * check-i18n.ts
 *
 * Static analysis for the maze-game i18n system. Catches three classes of
 * regression:
 *
 *   A. Locale parity — every locale in MESSAGES must define the same keys.
 *   B. Referenced-but-missing keys — every key referenced from .ts/.html
 *      code via msg('KEY'), %{BKY_KEY}, or data-msg* attributes must exist
 *      in the en MESSAGES block.
 *   C. Hardcoded user-facing string heuristic (warnings only).
 *
 * Args:    none
 * Example: tsx scripts/check-i18n.ts
 *          npm run check:i18n
 *
 * Exit codes:
 *   0  All parity/reference checks pass (warnings may still print).
 *   1  Parity mismatch or unresolved key reference.
 *   2  Unexpected internal error (e.g. cannot find MESSAGES init).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const MAZE_DIR = path.join(REPO_ROOT, 'test', 'maze-game');
const MESSAGES_FILE = path.join(MAZE_DIR, 'messages.ts');
const HTML_FILE = path.join(MAZE_DIR, 'index.html');

/** Keys we deliberately tolerate not having entries for (e.g. dynamic stubs). */
const REFERENCE_ALLOWLIST = new Set<string>([
  // Add keys here if a referenced key is intentionally absent from MESSAGES.
]);

/**
 * Substrings (lower-cased) that, when present in a literal value's RHS,
 * suppress a hardcoded-string warning for that line. Helps tag known-OK
 * cases without disabling the heuristic globally.
 */
const HARDCODED_STRING_ALLOWLIST_SUBSTRINGS: readonly string[] = [
  // e.g. 'data:image', 'url(', etc.
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocaleKeysets {
  /** locale -> Set of keys defined in MESSAGES[locale] */
  byLocale: Map<string, Set<string>>;
}

interface ReferencedKey {
  key: string;
  file: string;
  line: number;
  kind: 'msg' | 'bky' | 'data-msg';
}

interface HardcodedWarning {
  file: string;
  line: number;
  detail: string;
}

// ---------------------------------------------------------------------------
// Check A — locale parity
// ---------------------------------------------------------------------------

/**
 * Extract the MESSAGES object literal from messages.ts and return the set
 * of property keys for each locale (en, fr, es, ...).
 */
function extractLocaleKeysets(filePath: string): LocaleKeysets {
  const src = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );

  const byLocale = new Map<string, Set<string>>();

  /**
   * Look for `const MESSAGES ... = { en: {...}, fr: {...}, ... }`.
   * The MESSAGES initializer may have a type annotation in between.
   */
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'MESSAGES' && node.initializer) {
      const init = node.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
          ) {
            const localeName = prop.name.text;
            const localeKeys = new Set<string>();
            if (ts.isObjectLiteralExpression(prop.initializer)) {
              for (const innerProp of prop.initializer.properties) {
                if (
                  ts.isPropertyAssignment(innerProp) &&
                  (ts.isIdentifier(innerProp.name) || ts.isStringLiteral(innerProp.name))
                ) {
                  localeKeys.add(innerProp.name.text);
                }
              }
            }
            byLocale.set(localeName, localeKeys);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (byLocale.size === 0) {
    throw new Error(
      `Could not find MESSAGES object initializer in ${path.relative(REPO_ROOT, filePath)}`,
    );
  }
  return {byLocale};
}

interface ParityIssue {
  locale: string;
  missing: string[]; // present in en, absent here
  extra: string[]; // present here, absent in en
}

function checkLocaleParity(keysets: LocaleKeysets): ParityIssue[] {
  const en = keysets.byLocale.get('en');
  if (!en) {
    throw new Error(`MESSAGES.en is required as the reference locale but was not found`);
  }

  const issues: ParityIssue[] = [];
  for (const [locale, keys] of keysets.byLocale.entries()) {
    if (locale === 'en') continue;
    const missing: string[] = [];
    const extra: string[] = [];
    for (const k of en) {
      if (!keys.has(k)) missing.push(k);
    }
    for (const k of keys) {
      if (!en.has(k)) extra.push(k);
    }
    if (missing.length || extra.length) {
      missing.sort();
      extra.sort();
      issues.push({locale, missing, extra});
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Check B — referenced-but-missing keys
// ---------------------------------------------------------------------------

const MSG_CALL_RE = /\bmsg\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
const MSG_CALL_TEMPLATE_RE = /\bmsg\s*\(\s*`([^`]*)`/g;
const BKY_REF_RE = /%\{BKY_([A-Z0-9_]+)\}/g;
const DATA_MSG_RE = /data-msg(?:-aria-label|-title|-placeholder)?\s*=\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;

interface DynamicRefWarning {
  file: string;
  line: number;
  snippet: string;
}

interface RefScanResult {
  references: ReferencedKey[];
  dynamicWarnings: DynamicRefWarning[];
}

/** Walk MAZE_DIR for .ts files, excluding messages.ts, dist, and tests. */
function listScannableTsFiles(): string[] {
  const out: string[] = [];
  const skipDirs = new Set(['node_modules', 'dist', 'test']);
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.d.ts')) continue;
        if (full === MESSAGES_FILE) continue;
        if (entry.name.endsWith('.ts')) out.push(full);
      }
    }
  }
  walk(MAZE_DIR);
  return out;
}

function scanForReferences(): RefScanResult {
  const references: ReferencedKey[] = [];
  const dynamicWarnings: DynamicRefWarning[] = [];

  const tsFiles = listScannableTsFiles();
  for (const file of tsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      MSG_CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MSG_CALL_RE.exec(line)) !== null) {
        references.push({key: m[1], file, line: idx + 1, kind: 'msg'});
      }
      MSG_CALL_TEMPLATE_RE.lastIndex = 0;
      while ((m = MSG_CALL_TEMPLATE_RE.exec(line)) !== null) {
        const inner = m[1];
        // If template has no interpolation and is just a plain key, treat as literal.
        if (!inner.includes('${') && /^[A-Z_][A-Z0-9_]*$/.test(inner)) {
          references.push({key: inner, file, line: idx + 1, kind: 'msg'});
        } else {
          dynamicWarnings.push({file, line: idx + 1, snippet: line.trim()});
        }
      }
      BKY_REF_RE.lastIndex = 0;
      while ((m = BKY_REF_RE.exec(line)) !== null) {
        // %{BKY_FOO} resolves to Blockly.Msg['FOO']; we check against our keyset.
        references.push({key: m[1], file, line: idx + 1, kind: 'bky'});
      }
    });
  }

  // HTML — data-msg attributes
  if (fs.existsSync(HTML_FILE)) {
    const text = fs.readFileSync(HTML_FILE, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      DATA_MSG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DATA_MSG_RE.exec(line)) !== null) {
        references.push({key: m[1], file: HTML_FILE, line: idx + 1, kind: 'data-msg'});
      }
    });
  }

  return {references, dynamicWarnings};
}

interface MissingRef {
  key: string;
  file: string;
  line: number;
  kind: ReferencedKey['kind'];
}

function checkReferences(keysets: LocaleKeysets, refs: ReferencedKey[]): MissingRef[] {
  const en = keysets.byLocale.get('en');
  if (!en) {
    throw new Error(`MESSAGES.en is required as the reference locale but was not found`);
  }
  const missing: MissingRef[] = [];
  for (const r of refs) {
    if (REFERENCE_ALLOWLIST.has(r.key)) continue;
    if (en.has(r.key)) continue;
    // For BKY_ references, also tolerate any key Blockly's own packs are
    // expected to supply. Heuristic: if it starts with our MAZE_ prefix it
    // must be in MESSAGES.en; otherwise (DUPLICATE_BLOCK, DELETE_BLOCK, etc.)
    // Blockly's pack will supply it — skip.
    if (r.kind === 'bky' && !r.key.startsWith('MAZE_')) continue;
    missing.push({key: r.key, file: r.file, line: r.line, kind: r.kind});
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Check C — hardcoded user-facing strings (warnings)
// ---------------------------------------------------------------------------

const TEXTCONTENT_RE = /\.textContent\s*=\s*(['"])([A-Z][^'"]{2,})\1/g;
const INNERHTML_RE = /\.innerHTML\s*=\s*(['"])([^'"<]*[A-Za-z]{4,}[^'"]*)\1/g;
const SET_ATTR_RE =
  /\.setAttribute\s*\(\s*['"](aria-label|title|placeholder)['"]\s*,\s*(['"])([^'"]+)\2/g;
const ALERT_RE = /\b(alert|confirm|prompt)\s*\(\s*(['"])([^'"]+)\2/g;

function isLikelyMsgCall(line: string): boolean {
  return /\bmsg\s*\(/.test(line);
}

function passesAllowlist(line: string): boolean {
  const lower = line.toLowerCase();
  return HARDCODED_STRING_ALLOWLIST_SUBSTRINGS.some((s) => lower.includes(s));
}

function scanForHardcodedStrings(): HardcodedWarning[] {
  const warnings: HardcodedWarning[] = [];
  const tsFiles = listScannableTsFiles();

  for (const file of tsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (passesAllowlist(line)) return;

      let m: RegExpExecArray | null;

      TEXTCONTENT_RE.lastIndex = 0;
      while ((m = TEXTCONTENT_RE.exec(line)) !== null) {
        if (isLikelyMsgCall(line)) continue;
        warnings.push({
          file,
          line: idx + 1,
          detail: `textContent literal: ${JSON.stringify(m[2])}`,
        });
      }

      INNERHTML_RE.lastIndex = 0;
      while ((m = INNERHTML_RE.exec(line)) !== null) {
        if (isLikelyMsgCall(line)) continue;
        warnings.push({
          file,
          line: idx + 1,
          detail: `innerHTML literal: ${JSON.stringify(m[2])}`,
        });
      }

      SET_ATTR_RE.lastIndex = 0;
      while ((m = SET_ATTR_RE.exec(line)) !== null) {
        if (isLikelyMsgCall(line)) continue;
        warnings.push({
          file,
          line: idx + 1,
          detail: `setAttribute(${m[1]}) literal: ${JSON.stringify(m[3])}`,
        });
      }

      ALERT_RE.lastIndex = 0;
      while ((m = ALERT_RE.exec(line)) !== null) {
        if (isLikelyMsgCall(line)) continue;
        warnings.push({
          file,
          line: idx + 1,
          detail: `${m[1]}() literal: ${JSON.stringify(m[3])}`,
        });
      }
    });
  }

  // HTML heuristic — flag user-facing tags with text content but no data-msg*.
  if (fs.existsSync(HTML_FILE)) {
    const text = fs.readFileSync(HTML_FILE, 'utf8');
    const lines = text.split(/\r?\n/);
    const tagRe = /<(button|h1|h2|h3|label|option|a)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    // Walk by line so we keep line numbers. Build a cumulative offset map.
    const offsets: number[] = [0];
    for (let i = 0; i < lines.length; i++) {
      offsets.push(offsets[i] + lines[i].length + 1); // +1 for newline
    }
    function offsetToLine(off: number): number {
      // Binary search: find largest i s.t. offsets[i] <= off.
      let lo = 0;
      let hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (offsets[mid] <= off) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1; // 1-based
    }

    tagRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
      const [, tag, attrs, inner] = m;
      // Skip tags whose attribute list already carries any data-msg* binding.
      if (/\bdata-msg(?:-[a-z-]+)?\s*=/.test(attrs)) continue;
      // Strip nested tags from inner for the text-content check.
      const innerText = inner
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .trim();
      if (!innerText) continue;
      // Require at least one letter — skip pure punctuation/icons.
      if (!/[A-Za-z]{2,}/.test(innerText)) continue;
      const lineNo = offsetToLine(m.index);
      warnings.push({
        file: HTML_FILE,
        line: lineNo,
        detail: `<${tag}> has hardcoded text "${innerText.slice(0, 60)}" with no data-msg attribute`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function rel(p: string): string {
  return path.relative(REPO_ROOT, p) || p;
}

function printParity(issues: ParityIssue[]): void {
  console.log('## Locale parity');
  if (issues.length === 0) {
    console.log('  OK — all locales have identical keysets.');
    return;
  }
  for (const issue of issues) {
    if (issue.missing.length) {
      console.log(`  MISSING IN ${issue.locale}:`);
      for (const k of issue.missing) console.log(`    - ${k}`);
    }
    if (issue.extra.length) {
      console.log(`  EXTRA IN ${issue.locale} (not in en):`);
      for (const k of issue.extra) console.log(`    + ${k}`);
    }
  }
}

function printMissingRefs(
  missing: MissingRef[],
  dynamicWarnings: DynamicRefWarning[],
): void {
  console.log('## Missing key references');
  if (missing.length === 0) {
    console.log('  OK — every referenced key is defined in MESSAGES.en.');
  } else {
    for (const ref of missing) {
      console.log(`  ${rel(ref.file)}:${ref.line}: ${ref.kind} reference to undefined key "${ref.key}"`);
    }
  }
  if (dynamicWarnings.length) {
    console.log('  Dynamic key references (skipped):');
    for (const w of dynamicWarnings) {
      console.log(`    ${rel(w.file)}:${w.line}: ${w.snippet}`);
    }
  }
}

function printHardcoded(warnings: HardcodedWarning[]): void {
  console.log('## Hardcoded string warnings');
  if (warnings.length === 0) {
    console.log('  OK — no obviously-hardcoded user-facing strings.');
    return;
  }
  for (const w of warnings) {
    console.log(`  WARNING: ${rel(w.file)}:${w.line}: ${w.detail}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  let parityFailed = false;
  let referencesFailed = false;

  let keysets: LocaleKeysets;
  try {
    keysets = extractLocaleKeysets(MESSAGES_FILE);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exit(2);
  }

  // Check A
  const parityIssues = checkLocaleParity(keysets);
  printParity(parityIssues);
  if (parityIssues.length > 0) parityFailed = true;

  console.log('');

  // Check B
  const {references, dynamicWarnings} = scanForReferences();
  const missing = checkReferences(keysets, references);
  printMissingRefs(missing, dynamicWarnings);
  if (missing.length > 0) referencesFailed = true;

  console.log('');

  // Check C
  const hardcoded = scanForHardcodedStrings();
  printHardcoded(hardcoded);

  console.log('');
  const locales = [...keysets.byLocale.keys()].sort().join(', ');
  console.log(
    `Summary: ${keysets.byLocale.get('en')!.size} en keys; locales=[${locales}]; ` +
      `parity ${parityFailed ? 'FAIL' : 'OK'}; references ${referencesFailed ? 'FAIL' : 'OK'}; ` +
      `${hardcoded.length} hardcoded warning(s).`,
  );

  if (parityFailed || referencesFailed) process.exit(1);
  process.exit(0);
}

main();
