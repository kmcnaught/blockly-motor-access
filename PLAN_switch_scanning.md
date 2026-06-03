# Switch Scanning Mode — Plan

## Goals & Scope

Add **switch-scanning input** to the maze game so users with two switches (or one
switch + auto-scan) can complete maze levels without keyboard, mouse, or eye gaze.

- **Maze game only.** No generalisation to other Blockly Games apps. Reuses
  existing maze infrastructure (`grid-coding-mode.ts` insertion heuristic,
  `src/actions/*` for edit/move/delete, `Blockly.getFocusManager()` for
  highlighting).
- **Two switches, user-defined keys.** Step-scan by default: switch A advances
  the highlight, switch B selects. Keys configurable via URL params, settings
  panel, and `localStorage`.
- **Single-switch auto-scan.** Press to start auto-scan; press again to select.
  Loops at top level. Reaching end of a sub-scan group pops up one level.
- **Mutually exclusive with grid coding mode.** Picked by URL param.

Out of scope for this plan:
- Smart container insertion (insertion always uses existing heuristic;
  containers handled by insert-then-move — see Q1 from brainstorm).
- Generalising beyond maze.
- Screen-reader / ARIA polish beyond what region tagging already gives us.
- "Back" gesture (chorded press, long-hold, etc.) — not needed in v1 because
  every scan group wraps back to the top, giving an implicit back.

## Mode Activation

URL param picks input mode (extends existing `?inputMode=grid-coding` pattern):

```
?inputMode=switch-scan
```

When `switch-scan` is active:
- `GridCodingModeController` is **not** instantiated; its Shift+W/A/D/U/C/R
  bindings stay off.
- A new `SwitchScanController` is instantiated and bound.
- Blockly's default keyboard navigation can stay live (it doesn't conflict
  with the user's two custom switch keys), but its visible focus ring serves
  as our highlight — no second focus indicator.

## State Machine

Top-level scan loops these regions:

```
TOP LEVEL  →  [Header] [Toolbox] [Workspace] [Maze actions]
```

Select a region → enter that region's scan group. Reaching end of any group
pops up to its parent. Sub-scans (block actions, dropdowns) work the same way.

### Region: Header

Buttons enumerated in document order:

```
[ − ]  [ + ]  [Switch to Practice]  [Character ▾]  [Mute]  [Language ▾]
[Stage]  [Settings]
```

- `−` / `+` = zoom / text-size controls.
- `Character` and `Language` open a **sub-scan** of their dropdown options;
  reaching the end pops back to the header scan.
- `Settings` opens the settings panel (see Settings section); panel UI is
  itself a sub-scan group.

### Region: Toolbox

Scan blocks in the order they appear in the flyout for the current level.
Reaching end pops up to top level. Selecting a block triggers heuristic
insertion (see Insertion below), then pops to top level.

### Region: Workspace

Scan blocks in workspace order (top to bottom along `nextConnection` chains;
descend into statement inputs before continuing siblings). Reaching end pops
up to top.

Selecting a workspace block opens its **action sub-scan**:

```
[Select]  [Edit*]  [Move]  [Delete]
```

`*Edit` is omitted if the block has no editable dropdown field (Q from
brainstorm).

- **Select** — commits the Blockly keyboard-nav cursor to this block, pops
  to top. Subsequent insertions go *after* this block (see Insertion).
- **Edit** — opens the block's dropdown as a sub-scan; pick a value → set
  field → pop to action menu, then to top.
- **Move** — enters Blockly's existing move mode via `src/actions/move.ts`,
  scanning over candidate connections. Select commits the move. If no valid
  alternative connections exist, **skip this option** (Q from brainstorm).
- **Delete** — invokes `src/actions/delete.ts`; per existing keyboard-nav
  behavior, focus drops to the block above. Pop to top.

### Region: Maze actions

Buttons enumerated in document order:

```
[Back]  [Next]  [Run program]  [Ghost mode]  [Reset]
```

- `Ghost mode` only present when the current level/stage exposes it.
- `Reset` clears the workspace and resets the maze. Scan focus goes to top.
- `Run program` pauses scanning until the run finishes (see Pause-during-run).

## Scan Position vs Committed Cursor

With only 2 switches we have *advance* and *select* — no separate "back".
Every scan group exits by wrapping past the end (a sentinel "end of list"
behavior). This means we cannot use a back gesture to anchor the cursor
mid-stack; the explicit **Select** action in the workspace block menu is the
only way to commit the cursor.

Two pieces of state:

| State | What it tracks | Lives in |
| --- | --- | --- |
| **Scan position** | Where the highlight currently is during a scan sweep | `SwitchScanController` |
| **Committed cursor** | The Blockly keyboard-nav cursor; persists across sub-scans and pops | `Blockly.getFocusManager()` |

**Decision for v1**: scan position is tracked **separately** from the
committed cursor / `FocusManager` focus. The scanner paints its own
highlight on the currently-scanned item; the committed cursor stays put
until **Select** moves it. On pop-up (end of group), the scan highlight
clears and the committed cursor remains where it last was.

This avoids visual confusion between "I'm currently highlighting this"
and "this is my anchor for insertion". To revisit after user testing —
the alternative (drive `FocusManager` directly and snap back on pop) may
feel cleaner once we see it in motion.

## Insertion Heuristic

Reuse / share with `GridCodingModeController.insertBlock`:

```
if (committed cursor is on a workspace block):
    insert after that block (using its nextConnection)
else:
    walk to the end of the first top-block's nextConnection chain
    insert there
```

Container insertion (insert *into* a `forever` / `if` body) is **not**
handled specially in v1. User inserts the block as sibling, then uses
**Move** from the action menu. Documented limitation; revisit later.

## Region Tagging

Tag the existing maze DOM wrappers with semantic attributes so the scanner
can discover regions without hard-coded element IDs:

```html
<div role="region" aria-label="Header" data-scan-region="header"> ... </div>
<div role="region" aria-label="Maze actions" data-scan-region="maze-actions"> ... </div>
```

Within each region, scannable items get:

```html
<button data-scan-item> ... </button>
```

The toolbox and workspace regions are handled specially because their
contents come from Blockly's model, not the DOM tree.

## Key Bindings

### URL params

```
?switchAdvance=Space&switchSelect=Enter&scanMode=step&scanSpeedMs=1500&scanAudio=on
```

| Param | Default | Notes |
| --- | --- | --- |
| `switchAdvance` | `Space` | KeyboardEvent.key value |
| `switchSelect` | `Enter` | KeyboardEvent.key value |
| `scanMode` | `step` | `step` (2-switch) or `auto` (1-switch) |
| `scanSpeedMs` | `1500` | auto-scan interval |
| `scanAudio` | `off` | `on` or `off` |

URL values take precedence over `localStorage`. Saved to `localStorage`
under `mazeSwitchScan.*` keys after first load.

### Settings panel

Lives inside the existing **Settings** header button. Sections:

1. **Switch mode**: radio — Two switches (step) | One switch (auto).
2. **Switch A (Advance)**: "Press a key" capture button + current binding.
3. **Switch B (Select)**: same, only shown in two-switch mode.
4. **Scan speed** (auto mode only): slider, 500–4000 ms.
5. **Audio feedback**: toggle.

Key-capture listener accepts any single `KeyboardEvent.key`, including
Space, Enter, F-keys, and gamepad button names via the Gamepad API
(deferred — gamepad is post-v1).

### Validation

- Reject keys reserved by Blockly's own keyboard navigation **while
  switch-scan is active** — or just disable Blockly's keyboard nav when
  switch-scan is on (cleaner; only one focus driver).
- Refuse to bind the same key to both switches.

## Auto-Scan Behavior (one-switch mode)

- App load: scanner is **idle**.
- First switch press: scanner starts at top level, highlights cycle on
  `scanSpeedMs` interval, looping.
- Subsequent press: selects the currently highlighted item.
- After a sub-scan ends (pop), scan continues automatically from the
  parent's next item.
- Scanner pauses on Run; resumes idle after Reset.

## TTS

Speak the highlighted item's label on each step.

- Build label strings directly from Blockly model (no DOM scraping needed):
  - Toolbox / workspace blocks: use `messages.ts` strings keyed by block
    type, plus field values.
  - DOM scan items: read `aria-label` or text content.
- Use the Web Speech API (`speechSynthesis.speak`).
- Cancel any in-progress utterance when the scan advances.
- Off by default; toggled via settings (`?scanAudio=on`).
- Strings do **not** include "in toolbox" / "in workspace" — context is
  obvious from the scan flow.

## Pause-During-Run

When `runProgram` starts:
- Halt the auto-scan timer (if running).
- Disable switch key handlers.
- Clear any highlight.

When the run completes (or Reset is pressed):
- Re-enable handlers.
- Set scan focus to top of top-level region.

Hook into the same `executing` pattern that `GridCodingModeController` uses,
or wrap maze execution in a promise the controller awaits.

## Reset Behavior

Scan focus and committed cursor both **reset to top of top-level region**
on:
- Level change (next/prev/back)
- Reset button
- Page load

(No exceptions identified yet; revisit if testing finds friction.)

## Files Touched

### New

- `test/maze-game/switch-scan-mode.ts` — `SwitchScanController` class:
  region discovery, scan-state machine, key handling, settings IO, TTS.

### Modified

- `test/maze-game/index.ts`
  - URL param parsing for `inputMode=switch-scan` and key/speed/audio params.
  - Instantiate `SwitchScanController` (mutually exclusive with
    `GridCodingModeController`).
  - Add `role="region"` / `data-scan-region` attributes to existing wrapper
    elements for header and maze-actions.
  - Settings panel: add Switch Scan section.
- `test/maze-game/grid-coding-mode.ts`
  - Extract `insertBlock` heuristic to a shared helper module that both
    controllers can call. (Optional refactor — could also be left in
    place and re-imported.)
- `test/maze-game/index.html`
  - Add `data-scan-item` attributes to existing header / maze-action
    buttons that don't already have stable identifiers.

### Possibly modified

- `src/navigation_controller.ts` / `src/actions/*` — only if we need a
  hook to disable Blockly's keyboard navigation when switch-scan is active.

## Phased Rollout

1. **Phase 1 — Two-switch step scan, core flow.**
   - Regions: header (subset), toolbox, workspace, maze actions.
   - Block action menu: select, edit (dropdown), delete. Move deferred.
   - URL-param key bindings; no settings UI.
   - Pause-during-run.
   - Goal: a switch user can complete a Stage 1 maze level end-to-end.
2. **Phase 2 — Settings panel.**
   - In-app key capture, mode switch, speed slider, audio toggle.
   - `localStorage` persistence with URL-wins.
3. **Phase 3 — Move action + dropdowns in header (character, language).**
4. **Phase 4 — Single-switch auto-scan.**
5. **Phase 5 — TTS.**

## End-of-Group Sentinel

Every scan group ends with an explicit **"Back to top"** (or "Back to
parent") sentinel item before wrapping. Benefits:

- Makes the wrap point predictable instead of "the highlight suddenly
  jumped" — important in auto-scan where users don't drive timing.
- Gives TTS something to announce ("back to top") that signals the loop.
- Functions as a soft "back" for users who didn't intend to enter the
  group: select the sentinel to pop without picking anything.

The sentinel costs one extra scan step per group, which is acceptable
given the predictability gain.

## Open Questions to Revisit During Build / Test

- Scan position vs committed cursor — current decision is separate state
  with two visual indicators; revisit after user testing (see above).
- Whether to disable Blockly's keyboard nav entirely while switch-scan is
  active, or run them in parallel.
- Gamepad API support for switch interfaces that emulate gamepad buttons.
