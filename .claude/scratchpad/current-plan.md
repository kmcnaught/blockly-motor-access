# Plan: Switch-Scanning Mode (Phase 1)

Source design doc: `/workspace/PLAN_switch_scanning.md` — execute its Phase 1
("Two-switch step scan, core flow") only. Phases 2-5 (settings panel, Move,
header dropdowns, single-switch auto-scan, TTS) are out of scope for this
session.

Phase 1 goal (verbatim): *"a switch user can complete a Stage 1 maze level
end-to-end."*

In scope for Phase 1:
- URL-param key bindings (no settings UI).
- Regions: header (subset), toolbox, workspace, maze actions.
- Block action menu: Select, Edit (dropdown), Delete. Move deferred.
- Pause-during-run.
- Mutually exclusive with grid-coding-mode.

---

## Step 1: Scaffold `SwitchScanController` + URL-param wiring

Goal: Create the empty controller class and wire it into `index.ts`.

- New file `test/maze-game/switch-scan-mode.ts` with a `SwitchScanController`
  class skeleton exposing `enable()` / `disable()`. No scan logic yet.
- In `test/maze-game/index.ts`:
  - Read URL params: `inputMode`, `switchAdvance` (default `Space`),
    `switchSelect` (default `Enter`).
  - When `inputMode === 'switch-scan'`, instantiate the controller and
    enable it after Blockly init. Ensure mutual exclusion with
    `GridCodingModeController` (don't instantiate both).
- Controller binds a `keydown` handler that just `console.log`s when the
  advance/select keys are pressed — proves wiring works.

Files: `test/maze-game/switch-scan-mode.ts` (new),
`test/maze-game/index.ts` (modified).

Verify: Load `?inputMode=switch-scan`, press Space/Enter, see console logs.
No regressions in regular or grid-coding mode.

---

## Step 2: Region & item DOM tagging

Goal: Tag the existing wrappers and buttons so the controller can discover
regions without hard-coded IDs.

- In `test/maze-game/index.html`:
  - Add `data-scan-region="header"` to `<header>`, `role="region"`,
    `aria-label="Header"`.
  - Add `data-scan-region="maze-actions"` to the `.game-controls` div,
    same role/aria-label pattern.
  - Add `data-scan-item` to each scannable button in those two regions:
    header (zoom -, zoom +, mode toggle, mute, settings/info), maze-actions
    (Back, Next, Run, Reset; ghost only when visible — keep attribute,
    discovery filters hidden).
- Toolbox and workspace are NOT DOM-tagged; they're discovered via Blockly.

Files: `test/maze-game/index.html` (modified).

Verify: DOM inspector shows the attributes; no visual change.

---

## Step 3: Top-level scan loop + highlight overlay + end-of-group sentinel

Goal: First visible behavior — switch A cycles a highlight across the four
top-level regions; switch B does nothing useful yet (just logs which region
was selected).

- Controller discovers regions on `enable()`:
  ordered list `[header, toolbox, workspace, maze-actions]`.
- Maintain `scanIndex` over this list plus a synthetic "back to top"
  sentinel item at the end of the list (which just resets index to 0).
- Render a highlight: absolutely-positioned outline `<div>` injected into
  body, positioned via `getBoundingClientRect()` over the current region.
  For toolbox/workspace, target the Blockly flyout / workspace div.
  Sentinel highlight: a small visible chip ("⤴ back to top") near the
  bottom-right of the page, or a dedicated outline style — pick whichever
  reads clearer.
- Advance key moves to the next region/sentinel and re-renders highlight.
  Select key on a region just logs `selected: <regionName>` for now;
  select on sentinel resets.

Files: `test/maze-game/switch-scan-mode.ts`, plus a small CSS block (inline
or appended to `maze.css`) for the highlight outline + sentinel chip.

Verify: Space cycles outline through header / toolbox / workspace /
maze-actions / sentinel; Enter on each logs the right name; on sentinel
wraps to header.

---

## Step 4: Header region sub-scan

Goal: Select header → scan its buttons → select fires the button's click.

- On select of a region, push a sub-scan frame: scan the `data-scan-item`
  elements within that region (skip `display:none` or `.hidden`).
- Render the highlight over the individual button.
- Advance cycles items + sentinel ("back to top" — pop pops back to
  top-level scan and advances to the next region, per design doc wrap).
- Select on item calls `.click()` on the underlying button.
- Select on sentinel pops without firing.

Files: `test/maze-game/switch-scan-mode.ts`.

Verify: Switch user can press zoom +/- via two switches.

---

## Step 5: Maze-actions region sub-scan

Goal: Same pattern as Step 4 for the maze-actions region.

- Discovery uses the same `data-scan-item` query inside the
  `data-scan-region="maze-actions"` wrapper.
- Hidden buttons (`.hidden` class — Ghost run, etc.) are filtered out.

Files: `test/maze-game/switch-scan-mode.ts` (refactor item-discovery to
work for any DOM region — already general from Step 4).

Verify: Switch user can press Reset and Run Program via two switches.

---

## Step 6: Toolbox scan + heuristic insertion

Goal: Toolbox region scans its flyout blocks; select inserts into the
workspace using the existing heuristic.

- Discover flyout blocks via Blockly's flyout API
  (`workspace.getFlyout().getWorkspace().getTopBlocks(true)`).
- Highlight: outline the block's SVG bounding rect (use Blockly's
  `block.getSvgRoot().getBoundingClientRect()`).
- Select inserts a new block of that type into the main workspace.
  - Extract the insertion heuristic from `grid-coding-mode.ts`
    (`insertBlock` private method, line 354) into a small shared helper
    module (e.g. `test/maze-game/block-insertion.ts`) exporting an
    `insertBlockAfterCursor(workspace, blockType, fields?)` function.
  - Both `GridCodingModeController` and `SwitchScanController` import it.
  - The heuristic: if the Blockly `FocusManager` cursor sits on a
    workspace block, insert after it; else walk to end of first top-block
    chain. (Per design Q1 — no smart container insertion.)
- After insertion, pop back to top-level scan.

Files: `test/maze-game/block-insertion.ts` (new),
`test/maze-game/grid-coding-mode.ts` (use shared helper),
`test/maze-game/switch-scan-mode.ts`.

Verify: Switch user can insert a "move forward" block from the toolbox.

---

## Step 7: Workspace block scan

Goal: Workspace region enumerates its blocks; advance cycles through them.
Select opens an action sub-scan (implemented in Step 8 — for now, log only).

- Walk workspace blocks in tree order: for each top block, descend through
  `nextConnection` chain, and for each block descend into any statement
  inputs first before continuing siblings. Yields a stable, predictable
  enumeration.
- Highlight: outline the block's SVG (same approach as toolbox scan).
- For now, select just logs the block's type & id; sub-scan comes next step.

Files: `test/maze-game/switch-scan-mode.ts`.

Verify: With several blocks in the workspace, advance steps through them
top-to-bottom (descending into loop bodies before continuing).

---

## Step 8: Block action sub-scan (Select / Edit / Delete)

Goal: Selecting a workspace block opens an inline action menu and lets the
user pick what to do with the block.

- On select of a workspace block, push an action sub-scan with items:
  - **Select** — set the Blockly keyboard-nav cursor to this block
    (so subsequent insertions go after it); pop to top.
  - **Edit** — only when the block has at least one editable dropdown
    `Blockly.FieldDropdown`. Opens a value sub-scan over the dropdown's
    options; selecting a value calls `field.setValue(option[1])` then
    pops to top.
  - **Delete** — calls `block.dispose(true, true)` (or routes through
    `src/actions/delete.ts` if a thin public API exists); pops to top.
  - Plus sentinel "back to top" to bail out.
- Render action menu as a small DOM overlay anchored near the block —
  buttons with `data-scan-item` style so the existing highlight machinery
  works.

Files: `test/maze-game/switch-scan-mode.ts` (action menu + edit/delete
flows), tiny CSS for the menu overlay.

Verify: Insert a "turn left" block; switch user can edit the direction to
right; can delete the block; can mark a block as selected and have the
next inserted block land after it.

---

## Step 9: Pause-during-run integration

Goal: Halt scanning while the maze program is executing; resume cleanly
after.

- Mirror the `executing` flag pattern used in `GridCodingModeController`.
- Hook into existing run lifecycle in `index.ts` / `maze.ts`:
  - On run start: controller's `pauseForRun()` — clear highlight, ignore
    key events.
  - On run finish (success or fail, including reset mid-run):
    controller's `resumeFromRun()` — restore highlight at top-level /
    first region.
- If there's no clean hook, expose `mazeGame.onRunStart` / `onRunEnd`
  callback fields (or extend an existing event bus) and have the
  controller subscribe.

Files: `test/maze-game/switch-scan-mode.ts`, `test/maze-game/index.ts`
(probably to wire the lifecycle hook), possibly `test/maze-game/maze.ts`.

Verify: With switch-scan active, press Run; highlight disappears; key
presses do nothing while running; after completion, highlight comes back
at top of header.

---

## Step 10: End-to-end manual verification + polish

Goal: Confirm Phase 1 goal — a switch user can complete a Stage 1 maze
level end-to-end with only two keys.

- Test in browser at `?inputMode=switch-scan&switchAdvance=Space&switchSelect=Enter`:
  - Insert blocks from toolbox to build a solution for Stage 1, Level 1.
  - Edit a dropdown value.
  - Run the program.
  - Reset and try again.
- Tidy the highlight CSS (visible, accessible contrast — orange/yellow
  outline, ~4px, with `pointer-events: none`).
- Add a one-line comment header at the top of `switch-scan-mode.ts`
  documenting the URL params it accepts.
- Make sure regular mode (no URL param) is completely unaffected — no
  visible artifacts, no extra event listeners bound.

Files: minor tweaks across `switch-scan-mode.ts` and `maze.css`.

Verify: Manual playthrough of Stage 1 Level 1 succeeds with only Space
and Enter pressed. No regressions on default-mode page load.
