# Phase 1 Switch-Scan: Manual Verification Recipe

Informational only — not committed. Run after the automated checks
(build + lint + smoke test) pass, to confirm the user-facing flow
actually works end-to-end with only two keys.

## Setup

1. `cd /workspace && npm run start:maze`
2. Open `http://localhost:8080/?inputMode=switch-scan&switchAdvance=Space&switchSelect=Enter`
   (the dev server may pick 8081 / 8082 if 8080 is busy — check the
   webpack log).
3. Keep your hands off the mouse. From here on, only Space (advance)
   and Enter (select).

## Keys

- Space  — advance the highlight to the next region/item.
- Enter  — select the currently-highlighted region/item.

## Sequence — Stage 1 Level 1

A successful Phase 1 run should walk the four top-level regions
(header → toolbox → workspace → maze-actions → sentinel) and complete
the level with no mouse use.

1. Confirm the amber highlight is around the header on page load.
2. Press Space twice — highlight lands on the toolbox.
3. Press Enter — toolbox sub-scan opens. First flyout block highlighted.
4. Press Enter — a "move forward" block is inserted into the workspace.
   Highlight pops back to the top-level scan past the toolbox.
5. Repeat steps 2–4 to insert a "turn" block.
6. Press Space to advance to the workspace; press Enter to enter the
   workspace sub-scan; advance to the turn block; press Enter.
7. The action menu appears next to the block (Select / Edit / Delete).
   Advance to Edit; press Enter.
8. The dropdown values menu appears (left / right). Advance to the
   desired direction; press Enter. The block updates; highlight is
   back at the top.
9. Advance to the maze-actions region; sub-scan; select Run Program.
   Highlight disappears while the maze animates.
10. After the run ends (success, failure, or reset), the highlight
    reappears on the header — ready for another attempt.
11. Test Reset via the maze-actions sub-scan as well.

## What "good" looks like

- Highlight visible against both light page chrome and Blockly's
  workspace background at every step.
- Sentinel chip "↺ Back to top" appears at end of each cycle.
- Default-mode page (no URL params) is untouched: load
  `http://localhost:8080/` directly and confirm no amber outline, no
  console errors, no extra key-binding side effects.
