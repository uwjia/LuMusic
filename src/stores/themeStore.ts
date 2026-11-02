// Theme state: the persisted three-state preference, resolved to an
// effective palette and published as <html data-theme>. Mirrors the
// language store (localStorage preference, module-init document sync) —
// nothing flows through the api seam because theming is entirely a
// webview concern.

import { create } from 'zustand';
import {
  applyTheme,
  loadStoredTheme,
  persistTheme,
  resolveTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeStoreState {
  /** The user's choice; `dark` is the unset default, `system` follows the OS. */
  preference: ThemePreference;
  /** Switches, persists and re-applies the preference. */
  setPreference: (preference: ThemePreference) => void;
}

/** OS appearance probe: `null` when matchMedia is unavailable, resolved
 * to dark by the resolution rules. */
function readPrefersDark(): boolean | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function refreshTheme(): void {
  const { preference } = useThemeStore.getState();
  applyTheme(resolveTheme(preference, readPrefersDark()));
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  // Unset/corrupt storage defaults to dark — the pre-existing look — even
  // when the OS reports a light appearance; `system` is an explicit choice.
  preference: loadStoredTheme() ?? 'dark',

  setPreference: (preference) => {
    set({ preference });
    persistTheme(preference);
    refreshTheme();
  },
}));

// Theme before first paint (switches are handled by setPreference), the
// same technique the i18n store uses for <html lang>.
refreshTheme();

// While the preference is `system` the app keeps following the OS; an
// explicit light/dark makes refreshTheme a no-op re-apply of that choice.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => refreshTheme());
}
