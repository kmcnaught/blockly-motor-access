# Notes from todo.md pass

Append findings, decisions, or blockers here. Each entry should
state which todo it relates to and be self-contained enough to
read without conversation context.

## todo.md #2 — switch-scan coverage audit (2026-06-05)

Elements audited:
- 3 native `<select>` dropdowns inside the page (`#languageSelect`,
  `#stageDropdown`, `#blockMovementSelect` + `#highlightSizeSelect`
  inside `#shortcutsModal`).
- 1 custom popover (`#pegmanMenu`, opened via `#pegmanButton`).
- 9 `<dialog>` elements: `#resultModal`, `#graduationModal`,
  `#confirmationModal`, `#stageIntroModal`, `#gridCodingIntroModal`,
  `#gridPracticeIntroModal`, `#shortcutsModal`, `#switchSettingsModal`,
  plus the unused `#hintDialog` stub.
- 1 dynamically-shown bare `<div id="hintDialog">` that turns out to
  be vestigial — no JS reads or shows it (the contextual hint goes
  into `#contextualHint` in the instruction bar).

Implemented this pass:
- `#stageDropdown` — tagged `data-scan-item
  data-scan-dropdown-source="stage"`, registered a matching source
  in `buildHeaderDropdownSources()` mirroring the `language` shape
  (commit 9c6eeb7).

Deferred gaps:

- **`#resultModal`** — opens at run-end with dynamic structure:
  Cancel button is toggled on only for the "advance to next level"
  success-non-final-level case; OK + Cancel are both hidden in grid
  coding success; message2 only present in some flows; auto-close
  timer races with user input. Tagging buttons is not enough — the
  scanner would need a way to re-discover items when the modal
  reconfigures itself between opens, plus a push hook from the
  AutoCloseDialog's `show()`. Defer until a settled design.
- **`#graduationModal`** — 2 fixed buttons (`#graduationTryCoding`,
  `#graduationStay`), structure is static, so tagging is easy. The
  blocker is the open hook: Dialog class has no `onOpen` callback,
  so push would need to live in `showGraduationModal()` and pop in
  a Dialog `onClose` option (the constructor is currently created
  without `onClose`). Touches more than tag attributes, deferred to
  the broader modal-scan refactor.
- **`#stageIntroModal`** — single OK button, fully static. Same
  Dialog-constructor wiring problem as graduationModal. Trivial
  once a generic push/pop pattern exists for the Dialog wrapper.
- **`#confirmationModal`** — 2 fixed buttons (Confirm / Cancel)
  but the handlers are attached per-call via `showConfirmationModal`
  with `{once: true}`, so push/pop needs to slot into that same
  call site. Easy in isolation, but consistent with the rest of the
  modal-coverage gap. Currently only used by the "delete all data"
  button inside #shortcutsModal — which itself is not switch-scan
  reachable yet, so this modal is not a current dead-end (no switch
  path opens it).
- **`#shortcutsModal`** — opened by the instruction-bar `#infoBtn`
  (already scannable), so a switch user CAN open this dialog. The
  dialog contains two `<select>` settings, a delete-data button,
  and a close button — none tagged. Same Dialog onOpen wiring gap
  plus the inner selects would each need a `data-scan-dropdown-
  source` provider. Defer: needs design for which subset of
  shortcuts-modal settings switch users should be able to change.
- **`#gridCodingIntroModal` / `#gridPracticeIntroModal`** — not a
  gap. Grid mode (`?grid=1`) is mutually exclusive with switch-scan
  mode, so a switch user never sees these dialogs.
- **`#hintDialog`** (`<div>`) — vestigial. HTML + CSS exist but no
  JS imports or shows it. Not a gap; flagged for future cleanup.
- **`#scanSpeedSlider`** (range input inside switchSettingsModal) —
  intentionally untagged per existing inline comment: there is no
  clean switch-scan UX for a continuous range with two switches.
  Out of scope.
- **#pegmanMenu** — already covered by the `character` dropdown
  source. Not a gap.

## todo.md #1 — settings UI refactor (2026-06-05)

Replaced the `?` info button with a settings cog (`#settingsBtn`,
glyph `&#9881;`) in the instruction bar. Dropped the URL-gated
`#switchSettingsBtn` and its dedicated `#switchSettingsModal`
dialog. The cog now opens a single unified settings modal
(`#shortcutsModal` element id retained for minimal churn) that
contains, in order:

1. The existing block-movement + connection-highlight selects.
2. A "Switch access" checkbox row. Checking it calls
   `SwitchScanController.enable()` and un-hides the inline
   `#switchAccessPanel`; unchecking calls `disable()` and hides the
   panel. State persists to `localStorage` key
   `mazeSwitchScan.enabled` ('on' / 'off').
3. The keyboard shortcuts list, demoted to a `<details>` collapsible
   disclosure.
4. Delete-all-data + Close buttons.

**Design choice — keyboard shortcuts disclosure pattern:** chose a
plain `<details>` element over a sub-dialog. Less new code (zero
JS, zero focus-trap work, no extra Dialog wiring), plays well with
the existing modal's scroll, and switch-scan reaches it as a
`data-scan-item` summary which already toggles the disclosure on
"Enter" via the browser default.

**Live toggle wiring:** SwitchScanController is now constructed
unconditionally (except in grid / grid-coding modes, where it
remains mutually exclusive). `enable()` / `disable()` are
idempotent and safe to call repeatedly — confirmed against the
existing implementation in `switch-scan-mode.ts`. Settings panel
was refactored to drop the dialog + Save/Cancel paradigm: every
accepted control change fires `onChange` which persists + live-
applies via `setKeyBindings` / `setMode` / `SwitchScanTts.setEnabled`.

`?inputMode=switch-scan` is still honored on first load — it
seeds the checkbox checked, taking precedence over the persisted
LS value (see `switchScanInitialEnabled`).

Grid-mode mutual exclusion: the whole switch-access section is
hidden via CSS (`body.grid-mode .switch-access-section`) AND the
JS controller is not constructed at all in grid modes.

**Not tested live** — verified by build + tsc + code-reading only;
no browser run was attempted in this session.
