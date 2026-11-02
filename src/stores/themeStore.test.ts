// Store behavior: initial resolution + <html data-theme> publish,
// persisted switching, and live OS-following in system mode. The store
// reads matchMedia at import time, so each test installs a fake media
// query list first and imports a fresh module instance.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';

/** Stand-in for MediaQueryList: tests flip `matches` and dispatch the
 * change event the store subscribes to. */
class FakeMediaQueryList {
  matches: boolean;
  readonly media = '(prefers-color-scheme: dark)';
  private readonly listeners = new Set<(event: { matches: boolean }) => void>();

  constructor(prefersDark: boolean) {
    this.matches = prefersDark;
  }

  addEventListener(_type: string, listener: (event: { matches: boolean }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: { matches: boolean }) => void): void {
    this.listeners.delete(listener);
  }

  /** Simulates an OS appearance switch. */
  setOsTheme(prefersDark: boolean): void {
    this.matches = prefersDark;
    for (const listener of this.listeners) listener({ matches: prefersDark });
  }
}

function installMedia(prefersDark: boolean): FakeMediaQueryList {
  const mql = new FakeMediaQueryList(prefersDark);
  vi.stubGlobal('matchMedia', () => mql);
  return mql;
}

/** Imports a fresh store instance so module-init runs against the current
 * fake media state. */
async function importThemeStore() {
  vi.resetModules();
  return await import('@/stores/themeStore');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('themeStore init', () => {
  it('defaults to dark when nothing is stored, regardless of the OS appearance', async () => {
    installMedia(false);
    const { useThemeStore } = await importThemeStore();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    installMedia(true);
    const again = await importThemeStore();
    expect(again.useThemeStore.getState().preference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to dark when the OS appearance is undetectable', async () => {
    vi.stubGlobal('matchMedia', undefined);
    const { useThemeStore } = await importThemeStore();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('lets a stored explicit preference win over the OS appearance', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    installMedia(true);
    const { useThemeStore } = await importThemeStore();
    expect(useThemeStore.getState().preference).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('treats a corrupt stored value as the dark default', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    installMedia(false);
    const { useThemeStore } = await importThemeStore();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows the OS appearance only when system is the stored choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    installMedia(false);
    const { useThemeStore } = await importThemeStore();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('themeStore setPreference', () => {
  it('persists the choice and re-applies immediately', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    installMedia(false);
    const { useThemeStore } = await importThemeStore();
    expect(document.documentElement.dataset.theme).toBe('light');

    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    useThemeStore.getState().setPreference('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('themeStore OS following', () => {
  it('follows OS appearance switches while in system mode', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const mql = installMedia(true);
    await importThemeStore();
    expect(document.documentElement.dataset.theme).toBe('dark');

    mql.setOsTheme(false);
    expect(document.documentElement.dataset.theme).toBe('light');

    mql.setOsTheme(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores OS appearance switches after an explicit choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const mql = installMedia(true);
    const { useThemeStore } = await importThemeStore();
    expect(document.documentElement.dataset.theme).toBe('dark');

    useThemeStore.getState().setPreference('dark');
    mql.setOsTheme(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
