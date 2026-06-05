# scripts/

One-off and rerunnable project scripts.

Generic, reusable utilities live in `scripts/utils/` and are catalogued in
`scripts/utils/README.md`.

## Entries

### `check-i18n.ts`

Static analyser for the maze-game i18n system. Runs three checks:

- **Locale parity**: every locale in `test/maze-game/messages.ts`'s `MESSAGES`
  object must define the same keys as `en` (generic over whatever locales
  are present — currently `en`, `fr`, `es`).
- **Referenced-but-missing keys**: scans `.ts` files under `test/maze-game/`
  (excluding `messages.ts` and `test/`) plus `index.html` for `msg('KEY')`,
  `%{BKY_KEY}`, and `data-msg*="KEY"` references and verifies each key
  exists in `MESSAGES.en`.
- **Hardcoded user-facing strings** (warnings only, exit 0): heuristic for
  `.textContent =`, `.innerHTML =`, `.setAttribute('aria-label'/'title'/
  'placeholder', ...)`, `alert/confirm/prompt(...)`, and `<button>`/`<h1>`–
  `<h3>`/`<label>`/`<option>`/`<a>` elements with text but no `data-msg*`
  attribute.

Exit codes: `0` parity & references clean, `1` parity or reference failure,
`2` internal error (e.g. can't locate `MESSAGES`).

Run:

```bash
npm run check:i18n          # direct
npm run prebuild:maze       # also invoked here, gating build:maze
```

### `generate-build-info.js`

Writes `src/build_info.ts` with the current git SHA, dirty flag, and build
timestamp. Run automatically via `prebuild`, `prestart`, and `prebuild:maze`.

### `deploy.js`

GitHub Pages deploy helper (invoked by `npm run ghpages`).
