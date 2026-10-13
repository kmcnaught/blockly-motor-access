/**
 * Documentation + regression-guard demo for the switch-scan strategy
 * registry (`test/maze-game/switch-scan-mode.ts`).
 *
 * The real guard is the mapped type on `STRATEGIES`'s declaration plus
 * the `_strategiesExhaustivenessGuard` assignment immediately below the
 * `strategyFor` helper in that file. This file reproduces the pattern
 * in miniature so a future reader can see what breaks (and how) if
 * someone weakens the registry's exhaustiveness.
 *
 * Run standalone:
 *   npx tsc --noEmit --strict --target es2020 \
 *     --module esnext --moduleResolution bundler \
 *     scripts/verify-strategy-exhaustiveness.ts
 *
 * Expected: compiles cleanly. If any `@ts-expect-error` below becomes
 * a real error (because its target line stopped erroring), the pattern
 * has regressed — fix the registry, not this file.
 */

// --- Miniature of the real registry's shape ----------------------------

// Mirrors `ScanFrame['kind']` in switch-scan-mode.ts. Keep in sync when
// adding/removing frame kinds — this file is standalone and doesn't
// import the real union, by design (importing would drag in Blockly).
type FrameKind =
  | 'top'
  | 'dom-items'
  | 'blocks'
  | 'action-menu'
  | 'dropdown-values'
  | 'move-candidates';

interface FrameStrategy<K extends FrameKind> {
  readonly kind: K;
}

// The mapped type that forces one entry per kind — same shape as the
// real `Strategies` type.
type Registry = {[K in FrameKind]: FrameStrategy<K>};

// --- Case 1: well-formed registry compiles ------------------------------

const _complete: Registry = {
  'top': {kind: 'top'},
  'dom-items': {kind: 'dom-items'},
  'blocks': {kind: 'blocks'},
  'action-menu': {kind: 'action-menu'},
  'dropdown-values': {kind: 'dropdown-values'},
  'move-candidates': {kind: 'move-candidates'},
};
void _complete;

// --- Case 2: missing a kind must fail -----------------------------------

// If this ever stops erroring, the mapped-type exhaustiveness has broken.
// @ts-expect-error — 'move-candidates' is missing, must fail typecheck.
const _missingKind: Registry = {
  'top': {kind: 'top'},
  'dom-items': {kind: 'dom-items'},
  'blocks': {kind: 'blocks'},
  'action-menu': {kind: 'action-menu'},
  'dropdown-values': {kind: 'dropdown-values'},
};
void _missingKind;

// --- Case 3: mismatched kind label must fail ----------------------------

// Each strategy's kind field is tied to its map key via FrameStrategy<K>.
// A strategy whose kind doesn't match its key must fail. The directive
// sits directly above the offending property because TS places the
// mismatch error there, not on the outer declaration line.
const _mismatchedKind: Registry = {
  // @ts-expect-error — value's kind 'blocks' doesn't match key 'top'.
  'top': {kind: 'blocks'},
  'dom-items': {kind: 'dom-items'},
  'blocks': {kind: 'blocks'},
  'action-menu': {kind: 'action-menu'},
  'dropdown-values': {kind: 'dropdown-values'},
  'move-candidates': {kind: 'move-candidates'},
};
void _mismatchedKind;
