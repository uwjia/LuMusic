// Pure rules for the theme preference: guard, resolution matrix,
// best-effort persistence and the <html data-theme> publish.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  loadStoredTheme,
  persistTheme,
  resolveTheme,
} from '@/lib/theme';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('isThemePreference', () => {
  it('accepts the three preference modes', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isThemePreference('blue')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});

describe('loadStoredTheme', () => {
  it('returns a stored valid preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(loadStoredTheme()).toBe('light');
  });

  it('treats an unrecognized stored value as no choice made', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    expect(loadStoredTheme()).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadStoredTheme()).toBeNull();
  });

  it('tolerates unavailable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadStoredTheme()).toBeNull();
  });
});

describe('persistTheme', () => {
  it('writes the preference', () => {
    persistTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('swallows a failing write', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => persistTheme('light')).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('lets an explicit choice win over the OS appearance', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS appearance in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('falls back to dark when no appearance is detectable', () => {
    expect(resolveTheme('system', null)).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('publishes the theme on <html data-theme>', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
