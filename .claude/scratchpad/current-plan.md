# Plan: Centre the "Back to top" sentinel chip on its group

## Context

The sentinel chip currently lives in a fixed slot (`bottom: 16px; right: 16px`, maze.css:2273). It's the user's way to bail out of a sub-scan without committing an action, but its position has no semantic relationship to the group they're bailing out of — the user has to re-orient to a corner every time they want to exit.

Design agreed in session `a5dae277...`: centre the chip on the **group bounding box** of the frame being exited, with the group **semi-transparently greyed out**. That turns the chip into a semantic "exit" from the group rather than another item in the stream, matches what's actually happening (leaving the group, not continuing it), and gives switch/eye-gaze users a predictable spatial anchor — the chip appears "on top of" the thing they were just scanning.

**Key insight**: this change only takes effect at the sentinel slot. The scan cursor's non-sentinel positions are unchanged.

**Edge cases to handle:**
- **Tiny groups** (e.g. 2-button modal): centre-of-bbox puts the chip between the two buttons — cramped. Need a minimum-size fallback.
- **Workspace blocks group** on the maze: the group bbox is nearly the full workspace, so "centre" is a lot of empty space with a small chip adrift. Needs a different strategy (either clamp the chip or fall back to the fixed slot).
- **Occlusion of interactive elements**: the group members are greyed out, so clicking through them is already discouraged — but any UI outside the group that happens to sit near the centre of the bbox could get visually blocked. Low risk in practice because `pointer-events: none` on both overlays.

**Scope**: the sentinel chip itself + a new greyout mask overlay + a per-strategy `groupRect()` method. Does not change: non-sentinel highlight positioning, TTS, auto-scan timing, action-menu/dropdown rendering, keyboard inputs.

**Out of scope**: changing the chip's text/icon, animating the group→chip transition, applying the pattern to the `autoIdleChip` or action/dropdown menus.

**Key files**:
- `test/maze-game/switch-scan-mode.ts` — strategies (interface at ~line 382, impls at 420/452/512/619/729/787), `createOverlayElements` (1490), `renderHighlight` (1616).
- `test/maze-game/maze.css` — `.switch-scan-sentinel` at line 2273; new `.switch-scan-group-mask` rule to add.
- `test/maze-game/test/` — strategy / rendering tests.

---

## Step 1: Add `groupRect` to FrameStrategy, implement per kind

**Goal**: Extend the strategy interface with `groupRect(frame, ctx): DOMRect | null`. Each strategy returns the bounding box of the group the sentinel exits from. Pure data computation — no rendering changes yet.

**Why first**: locks the policy of "what counts as the group for each frame kind" in one place, with no visible side-effects. Reviewer can read six implementations side-by-side and sanity-check them before anything moves on screen.

**Resolver policy per kind**:
- `top` → N/A (no sentinel, returns `null`; keep implementation for exhaustiveness).
- `dom-items` → union of all `items[].getBoundingClientRect()`. For the settings modal this is tight around the controls.
- `blocks` → union of all workspace block rects. **Will often span most of the viewport on the maze workspace — flagged for Step 3 fallback.**
- `action-menu` → the menu element's `getBoundingClientRect()` (menu is a single DOM container).
- `dropdown-values` → the dropdown element's `getBoundingClientRect()`.
- `move-candidates` → union of all candidate connector rects (the cluster around the moving block).

**Union helper**: add a small `unionRects(rects: DOMRect[]): DOMRect | null` utility near the existing `getSingleBlockViewportRect` helper. Reject zero-area entries (same defensive filter as the main highlight path).

**Files**:
- `test/maze-game/switch-scan-mode.ts` — extend `FrameStrategy<K>` interface; add method to all six strategy entries in `STRATEGIES`.

**Verify**:
- `npm run build` passes.
- Unit test (step 4) will exercise this.
- No visible behavior change yet.

---

## Step 2: Add group-mask overlay + render pass at the sentinel slot

**Goal**: Create a new overlay element `groupMaskEl` with class `.switch-scan-group-mask` (semi-transparent grey panel, no border). In `renderHighlight`, when `atSentinel(frame)` is true, compute `groupRect`, position both the mask (covering the group) and the sentinel chip (centred on it), and show them. On non-sentinel slots or `groupRect === null`, hide the mask (chip already hides via existing path).

**Why**: this is the one place the design decision lands visually. Keeping the Step 1 data separate from this Step 2 rendering means a reviewer can bisect which half broke if something goes wrong.

**CSS additions** (maze.css):
- `.switch-scan-group-mask` — `position: fixed; pointer-events: none; background: rgba(100, 100, 100, 0.45); border-radius: 8px; z-index: 9998;` (below the solid highlight at 10000 and the pinned outline at 9999 — the mask sits furthest back).
- Update `.switch-scan-sentinel` to drop its fixed `bottom`/`right` and use `transform: translate(-50%, -50%)` so JS can position its centre at a point. Also scale it up slightly in group-centred mode (per the design discussion: chip should read as primary target in a greyed field). Simplest: new modifier class `.switch-scan-sentinel--centred` with larger padding/font — JS adds the class when positioning on a group.

**Positioning in `renderHighlight` sentinel branch** (around line 1645):
```ts
const sentinel = this.atSentinel(frame);
if (sentinel) {
  const group = strategyFor(frame).groupRect(frame as never, this.getStrategyCtx());
  this.highlightEl.style.display = 'none';
  // Step 3 decides the fallback policy for group === null / too-large / too-small.
  this.applySentinelChip(group);  // helper encapsulates mask + chip positioning
  if (shouldSpeak) this.speakCurrentLabel();
  return;
}
```

**Files**:
- `test/maze-game/switch-scan-mode.ts` — new `groupMaskEl` field; create in `createOverlayElements`; remove in `disable()`; hide in `handleRunStart`; new `applySentinelChip(groupRect)` private method; call from the sentinel branch of `renderHighlight`.
- `test/maze-game/maze.css` — new `.switch-scan-group-mask` rule; adjust `.switch-scan-sentinel` positioning (translate-based); new `--centred` modifier.

**Verify** (manual, before Step 3's guardrails):
- Open settings modal, scan to sentinel → chip appears centred on the modal, modal greys out.
- Open action menu on a block, scan past last item → chip appears centred on the action menu, menu greys out.
- Open Edit dropdown, scan past last option → chip appears centred on the dropdown.
- Workspace: scan the blocks list to sentinel → chip appears somewhere in the middle of the workspace (will look wrong — this is what Step 3 fixes).
- Move: scan past last candidate → chip appears centred on candidate cluster.
- Pop out of any sentinel → mask disappears.

---

## Step 3: Guardrails — min-size, max-size, viewport-clamp fallback

**Goal**: Handle the two visual failure modes without regressing the clean cases.

**Rules** (applied inside `applySentinelChip`):
1. If `groupRect === null` → use the current fixed-slot fallback (bottom-right, no mask). Keeps the chip reachable even when a strategy can't compute a group (defensive).
2. If `groupRect.width * groupRect.height < MIN_GROUP_AREA` (e.g. chip itself is bigger than the group): skip the mask, position the chip just below the group's bottom edge instead of inside it. Threshold: twice the chip's rendered bbox — tune during Step 5.
3. If `groupRect.width > viewport.width * MAX_FRACTION` OR `height > viewport.height * MAX_FRACTION` (e.g. 0.7): the group is "the whole screen" — the workspace case. Skip the mask (greying 70% of the viewport reads as a modal, not a group marker, and confuses the semantics). Position the chip at `groupRect`'s **top-centre**, offset inside by ~24px. This still gives it a spatial relationship to the group without flooding the viewport.
4. Otherwise (the common case): draw the mask over the group bbox, centre the chip on the bbox centre.

**Why thresholds not a single rule**: the two failure modes are different in kind. A tiny group wants the chip *outside* the group (don't crowd the content); a huge group wants the chip *anchored to a specific edge of the group* (centre is lost). One policy can't cover both.

**Constants**: declare `MIN_GROUP_AREA` and `MAX_FRACTION` as module-level `const` at the top of the file, next to any other tunables. Comment with the specific symptom each guards against (tiny-group crowding / viewport-flood).

**Files**:
- `test/maze-game/switch-scan-mode.ts` — expand `applySentinelChip` with the branch logic + two constants.

**Verify**:
- Settings modal (small-ish group) → mask + centre.
- Workspace blocks list (full viewport) → no mask, chip at top-centre of workspace bbox.
- A hypothetical 2-item modal (if present / construct one in test) → no mask, chip below the two items. If no such modal exists in the maze game today, note in step status that this branch is covered by the Step 4 unit test only.
- Action menu / dropdown (small overlay) → mask + centre.
- Move candidates (varies by block location) → mask + centre; verify it doesn't overshoot the viewport when the moving block is near an edge.

---

## Step 4: Unit tests — groupRect per strategy + applySentinelChip branches

**Goal**: Regression guard for the two things most likely to silently break:
1. A strategy's `groupRect` returning the wrong rect (easy to introduce when a new frame kind is added — same risk pattern as the exhaustiveness guard added in commit `654e42a`).
2. The `applySentinelChip` branch selection — tiny-group / huge-group / normal / null — all four paths covered.

**Approach**:
- For `groupRect`: construct a synthetic frame per kind, stub the DOM / workspace surfaces the strategy reads, assert the returned rect matches the expected union of inputs.
- For `applySentinelChip`: call with hand-crafted DOMRects (tiny / huge / normal / null), assert the resulting element style on `groupMaskEl` and `sentinelChip` matches each branch's spec.

**Files**:
- `test/maze-game/test/` — extend an existing switch-scan rendering spec if one exists; otherwise one new spec file.

**Verify**:
- `npm test` passes.
- Deliberately break one strategy's `groupRect` → corresponding test fails. Revert.
- Deliberately swap the tiny/huge thresholds → corresponding branch tests fail. Revert.

---

## Step 5: Manual browser verification + side-by-side comparison

**Goal**: Confirm the centred-with-greyout chip actually reads better than the current fixed-slot chip in practice. Per the original design discussion, the agreed path was "prototype so you can compare side-by-side with the current fixed-position chip" — this step honours that.

**Protocol**:
- Launch maze game (`npm run start:maze`).
- Walk through each frame kind at normal scan speed, both manual and auto:
  - **Dialogs** (settings / graduation / confirmation / stage-intro / result-modal): the pattern-case. Chip should feel like it "belongs to" the dialog.
  - **Action menu**: scan past Delete into the sentinel. Mask over the menu.
  - **Edit dropdown**: scan past last value.
  - **Move candidates**: scan past last connector.
  - **Workspace blocks**: the viewport-clamp branch — confirm the top-centre position doesn't collide with the toolbox or run button.
- Check at Grid 3's typical window size, not just full desktop — the viewport-fraction threshold might need re-tuning for narrower frames.
- Toggle TTS on; confirm the "Back to top" announcement still fires once per sentinel landing (no change expected — speech is driven by `atSentinel`, not by chip position).

**Side-by-side comparison**: temporarily revert maze.css's `.switch-scan-sentinel` to its old fixed-slot position, exercise two or three flows with the old chip, swap back. Record qualitative impressions in `step-5-status.txt`:
- Does the new chip read as "exit from group" or as "random floating button"?
- Any flow where the fixed slot felt better than the centred one? (Workspace is the predicted candidate — if so, the viewport-clamp fallback should be the mode, not the exception.)

**Verify**:
- Record findings in `step-5-status.txt`. If the centred-mode read is confirmed better in the normal cases and the clamped-mode read is at-least-equivalent in the workspace case, the plan is done. Otherwise, log the specific regressions and schedule a Step 6 revisit.

---

## Open questions to resolve during execution

- **Mask colour**: `rgba(100, 100, 100, 0.45)` is a reasonable starting point but may compete with the orange chip in dark-background cases (does any dialog have a dark background?). Candidate alternative: `rgba(0, 0, 0, 0.3)` — cooler, less chromatic competition.
- **Chip scale in centred mode**: how much bigger? Design discussion said "scale up a bit" — propose +25% padding, +2px font. Revisit in Step 5 if it looks either timid or oversized.
- **Transition / animation**: should the mask fade in rather than hard-cut? Risk: adds a dead beat where the user is waiting on an animation to confirm their switch press. Default: no transition, consistent with the pinned-outline decision.
