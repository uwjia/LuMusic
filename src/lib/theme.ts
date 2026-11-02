// Theme preference: the three-state choice persisted in localStorage (a
// pure-UI preference next to the language key — the backend never observes
// it) plus the pure rules that resolve it to one effective palette. The
// only DOM touch is publishing the resolved palette via <html data-theme>;
// the OS-appearance media query lives in the store.

export type Theme = 'light' | 'dark';
export type ThemePreference = 'system' | Theme;

/** Preference modes in display order. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_STORAGE_KEY = 'lumusic.theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Reads the stored preference; anything unreadable or unrecognized reads
 * as "no choice made" so resolution falls through to the OS appearance. */
export function loadStoredTheme(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (privacy mode / disabled webview storage).
    return null;
  }
}

/** Best-effort save; a failing write must not block the in-app switch. */
export function persistTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Persistence is best-effort; the active theme still applies.
  }
}

/**
 * Explicit light/dark wins. `system` follows the OS appearance, where
 * `prefersDark: null` means no appearance is detectable — resolved to
 * dark, the pre-existing look.
 */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean | null,
): Theme {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark === false ? 'light' : 'dark';
}

/**
 * Publishes the effective palette. The dark tokens on :root already render
 * dark without an attribute; setting it unconditionally keeps the override
 * selector and tests unambiguous.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}
