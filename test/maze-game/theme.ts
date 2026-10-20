/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Theme resolution for the maze game.
 *
 * The page supports four theme modes exposed to the user via the
 * Appearance picker in the unified settings modal:
 *
 *  - `system` — follow OS. `prefers-color-scheme: dark`,
 *    `prefers-contrast: more`, and `forced-colors: active` are checked
 *    in order and collapse into one of light / dark / hc.
 *  - `light` — force the baseline palette regardless of OS state.
 *  - `dark` — force a dark page-chrome palette. Blockly stays Classic.
 *  - `hc` — force the hardcoded black / white / yellow high-contrast
 *    palette. Blockly switches to its HighContrast theme. If the OS is
 *    also in forced-colors mode the CSS further refines the HC branch
 *    to use system colour keywords so the user's OS palette wins.
 *
 * The resolved "effective theme" (light / dark / hc) is applied by
 * setting `document.documentElement.dataset.theme`. All CSS palette
 * cascades key off `:root[data-theme="…"]`, so a single attribute write
 * swaps the chrome surfaces atomically.
 *
 * Persistence follows the same URL > localStorage > default pattern
 * used by other maze-game settings (`?skin=` / `mazeGameSkin`,
 * `?mode=` / `mazeExecutionMode`, etc.). The storage key is `mazeTheme`;
 * the URL parameter is `?theme=`.
 */

export type ThemeSetting = 'system' | 'light' | 'dark' | 'hc';
export type EffectiveTheme = 'light' | 'dark' | 'hc';

const STORAGE_KEY = 'mazeTheme';
const URL_PARAM = 'theme';
const VALID_SETTINGS: readonly ThemeSetting[] = [
  'system',
  'light',
  'dark',
  'hc',
] as const;

function isValidSetting(value: string | null | undefined): value is ThemeSetting {
  return (
    value != null && (VALID_SETTINGS as readonly string[]).indexOf(value) !== -1
  );
}

/**
 * Resolve the user's chosen theme setting.
 *
 * Precedence: `?theme=` URL parameter > `mazeTheme` localStorage > `system`.
 * Invalid values at either tier fall through to the next.
 */
export function resolveThemeSetting(): ThemeSetting {
  const urlVal = new URLSearchParams(window.location.search).get(URL_PARAM);
  if (isValidSetting(urlVal)) return urlVal;
  try {
    const lsVal = window.localStorage?.getItem(STORAGE_KEY);
    if (isValidSetting(lsVal)) return lsVal;
  } catch {
    // localStorage can throw in private browsing / sandboxed iframes.
    // Fall through to default.
  }
  return 'system';
}

/**
 * Collapse a user setting into the one of three concrete palettes the
 * CSS knows how to render. For `system`, consults the OS media queries
 * in priority order: forced-colors → prefers-contrast → prefers-color-scheme.
 */
export function resolveEffectiveTheme(setting: ThemeSetting): EffectiveTheme {
  if (setting === 'light' || setting === 'dark' || setting === 'hc') {
    return setting;
  }
  if (window.matchMedia('(forced-colors: active)').matches) return 'hc';
  if (window.matchMedia('(prefers-contrast: more)').matches) return 'hc';
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

/**
 * Apply the effective theme to the document root. CSS palette cascades
 * key off `:root[data-theme="…"]`.
 */
export function applyTheme(effective: EffectiveTheme): void {
  document.documentElement.dataset.theme = effective;
}

/**
 * Persist the user's theme setting to localStorage. Silently no-ops if
 * storage is unavailable.
 */
export function persistThemeSetting(setting: ThemeSetting): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, setting);
  } catch {
    // See resolveThemeSetting — storage can be unavailable.
  }
}

/**
 * Install listeners for OS preference changes. The callback fires only
 * when the user is on `system`; explicit light/dark/hc overrides the OS,
 * so there's nothing to react to. The caller supplies a getter rather
 * than a snapshot so the listener reflects the live setting value.
 */
export function installThemeListeners(
  getSetting: () => ThemeSetting,
  onChange: (effective: EffectiveTheme) => void,
): void {
  const queries = [
    '(forced-colors: active)',
    '(prefers-contrast: more)',
    '(prefers-color-scheme: dark)',
  ];
  const handler = () => {
    if (getSetting() === 'system') {
      onChange(resolveEffectiveTheme('system'));
    }
  };
  for (const query of queries) {
    window.matchMedia(query).addEventListener('change', handler);
  }
}

/**
 * Was the active theme setting supplied via `?theme=` URL parameter?
 * Used by the settings modal to show the "URL settings active" indicator.
 */
export function isThemeFromUrl(): boolean {
  const urlVal = new URLSearchParams(window.location.search).get(URL_PARAM);
  return isValidSetting(urlVal);
}
