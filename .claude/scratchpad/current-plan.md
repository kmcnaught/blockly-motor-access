# Plan: Switch-scan ScanFrame kind polymorphism + handleSelect extraction

## Context

`test/maze-game/switch-scan-mode.ts` defines a discriminated-union `ScanFrame` with six kinds — `top`, `dom-items`, `blocks`, `action-menu`, `dropdown-values`, `move-candidates`. Per-kind behaviour is scattered across five private methods on `SwitchScanController`:

| Method              | What it dispatches on `frame.kind`                   |
| ------------------- | ---------------------------------------------------- |
| `cycleLen`          | number of items in the cycle (+1 sentinel for subs)  |
| `atSentinel`        | whether current index is the sentinel slot           |
| `currentItemLabel`  | TTS label derivation                                 |
| `renderHighlight`   | which DOM/SVG rect the highlight outlines            |
| `handleSelect`      | commit the action and pop (~290 lines, 6 branches)   |

Teardown-on-pop also used to have per-kind branches but has already been centralised into `teardownPoppedFrame` (see commit history on this branch). The remaining dispatch points are the five above. That's still 5 switch sites; adding a 7th frame kind means touching all of them with no exhaustiveness guard.

### Chosen approach — strategy registry keyed by `frame.kind`

Option (a): a `FrameStrategy<K extends ScanFrame['kind']>` interface, and a `const STRATEGIES: {[K in ScanFrame['kind']]: FrameStrategy<K>}` object. Reasons:

- Frames stay plain data (discriminated union of structs), which is how they're serialised into `frameStack`, logged, and narrowed by every call site that isn't dispatching. No conversion / wrapper lifecycle to invent.
- `Record<Kind, Strategy<Kind>>` typed via mapped type gives TS exhaustiveness: miss a kind in the strategy map and the file doesn't compile. Adding a 7th kind becomes "add the union variant + add one STRATEGIES entry" with the compiler enforcing both.
- Strategies take an explicit `ctx` (the controller) rather than being bound to `this`. Keeps them pure functions-on-data, easy to unit-test later without needing a full `SwitchScanController`.
- Option (b) (methods on frames) would force every push-site to instantiate a class, breaking `frameStack`'s JSON-shaped simplicity and complicating the DOM-element references that already live inside frames.

Each strategy exposes:

```ts
interface FrameStrategy<K extends ScanFrame['kind']> {
  cycleLen(frame: Extract<ScanFrame, {kind: K}>, ctx: StrategyCtx): number;
  atSentinel(frame: Extract<ScanFrame, {kind: K}>): boolean;
  labelAt(frame: Extract<ScanFrame, {kind: K}>, ctx: StrategyCtx): string | null;
  rectAt(frame: Extract<ScanFrame, {kind: K}>, ctx: StrategyCtx): DOMRect | null;
  handleSelect(frame: Extract<ScanFrame, {kind: K}>, ctx: StrategyCtx): void;
}
```

(An earlier draft also included an `onPop` method for overlay teardown. That dispatch has since been centralised into `teardownPoppedFrame`, which has its own per-kind switch of only 3 lines total — moving it into strategies would make the strategy registry 6 entries larger for a 3-line win. Leave it where it is unless the registry's `onPop` story is otherwise motivated.)

Dispatch helper:

```ts
function strategyFor<F extends ScanFrame>(frame: F): FrameStrategy<F['kind']> {
  return STRATEGIES[frame.kind] as FrameStrategy<F['kind']>;
}
```

`StrategyCtx` is a small structural type exposing just what the strategies need from the controller — the workspace, the regions array, the active menu overlay element references, the pop helpers (`popToSameRegion`, `popToNextRegion`), the enter* helpers (`enterActionMenu`, `enterDropdownValues`, …), the shortcut invoker, the `headerDropdowns` provider map, and the private `findFirstEditableDropdown` / `enumerateValidConnectionTargets`. Implemented as a `getStrategyCtx(): StrategyCtx` method on the controller — bind-free (returns `this` behind a narrow interface) and type-checked at the boundary.

### Refactor-1 vs Refactor-2 sequencing

Doing both in one commit would be a ~500-line diff dominated by one giant method move. Splitting:

1. **Step 1 (prep):** introduce `FrameStrategy` + `StrategyCtx` interfaces and the empty `STRATEGIES` scaffold with placeholder entries for all 6 kinds. No call-site changes yet. Keeps the diff pure-additive and the compiler green.
2. **Step 2:** migrate the three "pure-ish" dispatches — `cycleLen`, `atSentinel`, `labelAt` (= `currentItemLabel`). These are small (3–20 lines per kind) and don't touch overlay DOM.
3. **Step 3:** migrate `renderHighlight`'s rect-picking (= `rectAt`). The post-rect positioning stays in the controller — strategies only answer "what rect?".
4. **Step 4:** migrate `handleSelect` into strategies (Refactor 2). Largest step; natural pairing with Refactor 1 as the user predicted. Done last because every prior step shrinks the surface area to review here.

Steps 1–3 are independently committable and each reviewable in <200 lines of diff. Step 4 is the big one but only moves the already-sliced methods — the behavioural surface is one method body.

### Verify command (shared across all steps)

The maze game is compiled by webpack via ts-loader, which typechecks on build:

```
npm run build:maze
```

Must complete with no TS errors. Additionally, run `npm run lint` after each step to catch any unused-import / unused-local complaints introduced by the move.

Manual smoke-test (any step that could affect runtime): `npm run start:maze`, bind to a port from `ports.txt`, activate switch-scan via `?inputMode=switch-scan`, and exercise one of each frame kind:
- top → advance across regions
- dom-items → open header, cycle, select a button
- blocks (toolbox) → insert a block
- blocks (workspace) → select a block to open action menu
- action-menu → Select / Edit / Move / Delete each
- dropdown-values → Edit a `maze_turn` block's direction field
- move-candidates → Move a block onto a different slot

Any step that touches runtime (3, 4) MUST do the manual smoke before commit.

## Risks

- **`handleSelect` branch-move loses `this`-binding or ordering** (Step 4). The current method's try/finally blocks around `item.click()`, `block.dispose()`, `pair.target.connect()` have specific ordering that `popToSameRegion` depends on. Mitigation: move each branch verbatim into the strategy's `handleSelect(frame, ctx)` body with `ctx.` substituted for `this.`; no re-ordering, no inlining. The strategy call-site in the controller becomes `strategyFor(frame).handleSelect(frame, this.getStrategyCtx())` — one line replacing the whole dispatch.
- **TS exhaustiveness regression**: the current `if (kind === 'top') ... return` chains silently default on an unknown kind. The strategy map's mapped type raises a compile error on a missing kind. That's the whole point, but it means any PR that adds a frame kind without updating `STRATEGIES` will break the build — that's intended and the migration note in Step 1 should call it out.
- **Scope creep**: the controller still owns the frame stack, the push-helpers (`enterActionMenu` etc.), the key dispatch, the TTS wiring. Strategies are "what does this frame mean?" not "how do we transition between frames." Resist the urge to move push-helpers into strategies too — they're called from `handleSelect` strategies via `ctx.enterActionMenu(...)`, so they belong on the controller / `ctx`.

## Out of scope (DO NOT do in these steps)

- Do not rename any frame kind strings (`'top'`, `'dom-items'`, `'blocks'`, `'action-menu'`, `'dropdown-values'`, `'move-candidates'`). They appear in log messages and the shape is observable in dev-tools.
- Do not change the external API of `SwitchScanController` — `enable`, `disable`, `pushModalSubScan`, `popModalSubScan`, `setTts`, `setSettings`, `setMode`, `speakCurrentItemLabel` all keep their signatures and semantics. `index.ts` must not require any change.
- Do not change the `ScanFrame` discriminated-union shape (field names, optional-ness, variant members). The migration is behaviour-preserving.
- Do not touch `switch-scan-regions.ts`, `switch-scan-menus.ts`, `switch-scan-settings.ts`, `switch-scan-tts.ts`. Those modules are stable collaborators.
- Do not add a new frame kind to prove the exhaustiveness guard — if the user wants that, it's a follow-up step.
- Do not re-fold the unified `pop({target})` back into two helpers — the current branch has already consolidated `popSubScan`/`popOneFrame` into one; keep that.
- Do not reformat / re-wrap unrelated code. Keep the diff focused on the dispatch extraction.
- Do not add unit tests for strategies in this refactor — the existing wdio tests (`npm run test:maze`) cover the end-to-end behaviour. Unit testing strategies in isolation is a future enhancement enabled by this refactor, not part of it.

---

## Step 1: Introduce `FrameStrategy` interface + empty `STRATEGIES` scaffold

**Goal**: Pure-additive scaffold. Define `FrameStrategy<K>`, `StrategyCtx`, and `STRATEGIES: {[K in ScanFrame['kind']]: FrameStrategy<K>}` with every entry present but delegating to the controller's existing methods (via a stub that calls back into the controller). No call-site changes. The point is to prove the typing works and the exhaustiveness check fires on a missing kind — before we start migrating logic.

**Files**:
- `test/maze-game/switch-scan-mode.ts`
  - Add `interface StrategyCtx` near the `ScanFrame` type. Exposes:
    - `readonly workspace: Blockly.WorkspaceSvg;`
    - `readonly regions: ReadonlyArray<ScanRegion>;`
    - `readonly headerDropdowns: Readonly<Record<string, HeaderDropdownSource>>;`
    - `actionMenuEl: HTMLDivElement | null;` (strategies read / write)
    - `dropdownMenuEl: HTMLDivElement | null;` (same)
    - `enterDomRegionSubScan(name: string, topLevelIndex: number): void;`
    - `enterToolboxSubScan(topLevelIndex: number): void;`
    - `enterWorkspaceSubScan(topLevelIndex: number): void;`
    - `enterActionMenu(block: Blockly.BlockSvg, topLevelIndex: number): void;`
    - `enterDropdownValues(block, field, topLevelIndex): void;`
    - `enterHeaderDropdownValues(anchor, source, topLevelIndex): void;`
    - `enterMoveCandidates(block, topLevelIndex): void;`
    - `popToSameRegion(topLevelIndex: number): void;`
    - `popToNextRegion(topLevelIndex: number): void;`
    - `findFirstEditableDropdown(block): Blockly.FieldDropdown | null;`
    - `getSingleBlockViewportRect(block): DOMRect | null;` (wraps the imported helper)
  - Add `interface FrameStrategy<K extends ScanFrame['kind']>` with the five method signatures.
  - Add `type Strategies = {[K in ScanFrame['kind']]: FrameStrategy<K>};`
  - Add `const STRATEGIES: Strategies = { ... };` with every entry's methods returning sensible no-ops (`cycleLen: () => 0`, `atSentinel: () => false`, `labelAt: () => null`, `rectAt: () => null`, `handleSelect: () => {}`). The stubs are temporary — Steps 2-4 fill them in.
  - Add `strategyFor<F extends ScanFrame>(frame: F): FrameStrategy<F['kind']>` dispatch helper.
  - Add `private getStrategyCtx(): StrategyCtx { return this; /* via the structural match */ }` on the controller. Easiest: declare `getSingleBlockViewportRect` as a private method on the controller that wraps the import, then `getStrategyCtx` can just `return this as unknown as StrategyCtx` with a comment explaining the structural match.

**Verify**:
- `npm run build:maze` compiles.
- `npm run lint` passes.
- Delete one entry from `STRATEGIES` temporarily (e.g. `'move-candidates'`) and confirm `npm run build:maze` errors with "Property 'move-candidates' is missing in type …" — this is the exhaustiveness proof. REVERT before commit.
- No runtime change — nothing calls `STRATEGIES` or `strategyFor` yet.

**Acceptance criterion**: `git diff --stat` shows only `test/maze-game/switch-scan-mode.ts` modified, ~150 lines added. `npm run build:maze` green. The scaffold exists; `handleKeyDown`, `cycleLen`, etc. are unchanged.

---

## Step 2: Migrate `cycleLen`, `atSentinel`, `labelAt` into strategies

**Goal**: Fill in the three cheap dispatches. Each strategy's `cycleLen`, `atSentinel`, `labelAt` body is lifted verbatim from the corresponding branch in the current controller methods. The three controller methods become one-line delegators to `strategyFor(frame)`.

**Files**:
- `test/maze-game/switch-scan-mode.ts`
  - Fill in each `STRATEGIES[kind].cycleLen` by extracting the matching line from `cycleLen`. E.g. `top: { cycleLen: (_f, ctx) => ctx.regions.length, ... }`.
  - Same for `atSentinel` and `labelAt` (bigger body — just move it, don't inline / collapse).
  - Replace the controller's `cycleLen(frame)` body with `return strategyFor(frame).cycleLen(frame as never, this.getStrategyCtx());` — `as never` is the standard escape for the "narrowed-then-passed-generically" pattern. Same for `atSentinel`. Rename `currentItemLabel()` to call `strategyFor(frame).labelAt(...)` similarly.
  - Keep the controller methods — don't inline into callers. They're the public (within-class) seam for TTS, render, and the sentinel checks; leaving them in place minimises the diff elsewhere.
  - The "move-candidates returns 'Cancel' at sentinel" branch in `currentItemLabel` stays either in the controller's `currentItemLabel` wrapper (as an `atSentinel` short-circuit) OR per-strategy. Prefer per-strategy — cleaner locality. Note in the step status which approach the implementer chose.

**Verify**:
- `npm run build:maze` compiles. `npm run lint` passes.
- Manual: `npm run start:maze`, enable switch-scan, advance through all frame kinds, confirm highlight cycles identically and TTS speaks the right labels (if enabled via `?scanAudio=on`). Compare side-by-side against `HEAD~1` build if visual regression suspected.

**Acceptance criterion**: `git diff --stat` ~80-120 lines moved. Controller methods `cycleLen`, `atSentinel`, `currentItemLabel` are now ≤5 lines each (just the strategy delegation). No behaviour change observable.

---

## Step 3: Migrate `renderHighlight`'s rect-picking into `rectAt`

**Goal**: Move the per-kind "which rect to outline?" logic into each strategy's `rectAt`. `renderHighlight` keeps the surrounding orchestration — the sentinel-chip toggle, the auto-idle chip, the `shouldSpeak` wiring, the "defensive: hide on zero rect" fallback — and only loses the rect-picking switch.

**Files**:
- `test/maze-game/switch-scan-mode.ts`
  - Fill in each `STRATEGIES[kind].rectAt`. The `top`, `dom-items`, `blocks`, `action-menu`, `dropdown-values`, `move-candidates` bodies lift directly from the `if/else if` chain in `renderHighlight`. The `blocks` strategy needs `ctx.workspace` and `ctx.getSingleBlockViewportRect(block)`. The `action-menu` / `dropdown-values` strategies need `ctx.actionMenuEl` / `ctx.dropdownMenuEl` to do the overlay-child lookup.
  - The sentinel case for `move-candidates` (outlines `cancelChipEl`) and the sentinel branches in `renderHighlight` need to be reconciled. Prefer: `rectAt` is only called when `!atSentinel(frame)`, so the sentinel branches stay in `renderHighlight` exactly as they are, and `move-candidates.rectAt` for the non-sentinel case returns the connection rect. Keep the sentinel-vs-non-sentinel split in the controller.
  - Replace the `if (frame.kind === …)` chain in `renderHighlight` with `rect = strategyFor(frame).rectAt(frame as never, this.getStrategyCtx());`
- No changes to `switch-scan-menus.ts` or `switch-scan-regions.ts`.

**Verify**:
- `npm run build:maze` compiles. `npm run lint` passes.
- Manual: open every frame kind in dev server, confirm the highlight outlines the right element in each (regions, header buttons, flyout blocks, workspace blocks, action-menu rows, dropdown rows, move-candidate connection targets, Cancel chip, Back-to-top sentinel chip). Resize the window — reflow should still re-position the highlight (confirms the `speak: false` path still flows through `rectAt`).

**Acceptance criterion**: `git diff --stat` ~60-100 lines moved. `renderHighlight` is shorter by ~45 lines; its remaining body is the orchestration (sentinel toggle, idle chip, speak flag, hide-on-zero, position-apply).

---

## Step 4: Migrate `handleSelect` into strategies (Refactor 2)

**Goal**: Move the 290-line per-kind `handleSelect` dispatch into `STRATEGIES[kind].handleSelect`. The controller's `handleSelect(frame)` collapses to one line: `strategyFor(frame).handleSelect(frame as never, this.getStrategyCtx());`.

**Files**:
- `test/maze-game/switch-scan-mode.ts`
  - For each kind, lift the matching branch body into `STRATEGIES[kind].handleSelect(frame, ctx)`. Rules:
    - Replace `this.regions` with `ctx.regions`, `this.enterToolboxSubScan` with `ctx.enterToolboxSubScan`, `this.popToSameRegion` with `ctx.popToSameRegion`, etc.
    - Replace `this.headerDropdowns` with `ctx.headerDropdowns`.
    - Replace `this.findFirstEditableDropdown` with `ctx.findFirstEditableDropdown`.
    - `this.atSentinel(frame)` becomes an inlined sentinel check per-strategy (identical to Step 2's `atSentinel` body) OR a call to `STRATEGIES[frame.kind].atSentinel(frame as never)`. Prefer inlining within the strategy — removes a cross-strategy call. One-line duplication per strategy, ~6 lines total, worth it for locality.
    - Pure Blockly calls (`block.dispose(...)`, `pair.target.connect(local)`, `Blockly.Events.setGroup(...)`, `Blockly.getFocusManager().focusNode(...)`, `insertBlockAfterCursor(workspace, ...)`, `Blockly.renderManagement.finishQueuedRenders()`) move verbatim — they don't need the controller.
  - Verify the `top` strategy's `handleSelect` branches on `region.name` exactly as the current method does, including the `console.log` fallback for unknown regions.
  - Verify every try/catch/finally block moves intact — the catch comments describe the defensive intent (e.g. `focusNode can throw if the block was disposed`) and must survive.
  - The controller's `handleSelect(frame: ScanFrame): void` becomes:
    ```ts
    private handleSelect(frame: ScanFrame): void {
      strategyFor(frame).handleSelect(frame as never, this.getStrategyCtx());
    }
    ```
  - Preserve the method (don't inline into `handleKeyDown`) so the auto-mode select path and the step-mode select path both still have a single-line call to make.

**Verify**:
- `npm run build:maze` compiles. `npm run lint` passes.
- Manual (REQUIRED, non-negotiable for this step given the surface area):
  - **top → region**: advance to each top-level region, Select, confirm correct sub-scan opens for each (header/toolbox/workspace/maze-actions/instruction-bar/practice-controls).
  - **dom-items → button**: open header, Select a button that doesn't open a dropdown, confirm click fires and sub-scan pops back to the same region.
  - **dom-items → dropdown source**: open header, Select pegman/language, confirm `dropdown-values` opens anchored off the header button (NOT the native popover).
  - **blocks (toolbox)**: Select a flyout block, confirm it inserts into the workspace, scan pops back to toolbox, focus-manager cursor lands on the new block.
  - **blocks (workspace)**: Select a workspace block, confirm action menu appears.
  - **action-menu → Select**: confirm cursor commits, pop to workspace region.
  - **action-menu → Edit**: confirm `dropdown-values` opens over a block with a dropdown field.
  - **action-menu → Move**: confirm `move-candidates` opens with Cancel chip, action menu is torn down.
  - **action-menu → Delete**: confirm block is disposed, scan pops to workspace region, next Select re-enters the (now-shorter) block list.
  - **dropdown-values (block Edit)**: confirm field value updates on Select, pop to workspace region.
  - **dropdown-values (header)**: confirm `commitHandler` fires (changePegman / language reload).
  - **move-candidates → target**: confirm `target.connect(local)` fires, block moves, cancel chip is removed, pop to workspace.
  - **move-candidates → Cancel sentinel**: confirm pop with no connection change.
  - **sentinels**: confirm each sentinel ("Back to top" / "Cancel") pops to `popToSameRegion(frame.topLevelIndex)` identically to before.
  - **chain-insert / chain-edit**: confirm pressing Select twice in a row re-enters the same sub-scan.
- Run `npm run test:maze` if the webdriverio harness is set up.

**Acceptance criterion**: `git diff --stat` shows ~290 lines moved out of `handleSelect` and ~290 lines added into `STRATEGIES`. Controller's `handleSelect` is 3 lines. Behaviour-identical in manual smoke.

---

## Post-step summary (not a step — guidance for reviewer)

After all 4 steps, the controller's dispatch burden for `ScanFrame.kind` is confined to the `STRATEGIES` map. Adding a 7th kind requires:
1. Add the variant to `type ScanFrame` (one object-literal addition).
2. Add the entry to `STRATEGIES` (compiler forces this via the mapped type — build fails until you do).
3. Add a case to `teardownPoppedFrame` IF the new kind owns standalone overlay DOM.

### Critical files for implementation
- /blockly-keyboard-experimentation/test/maze-game/switch-scan-mode.ts
- /blockly-keyboard-experimentation/test/maze-game/switch-scan-regions.ts (ScanRegion type, read-only)
- /blockly-keyboard-experimentation/test/maze-game/index.ts (verify the controller's external API is unchanged)
- /blockly-keyboard-experimentation/package.json (`build:maze`, `lint`)
