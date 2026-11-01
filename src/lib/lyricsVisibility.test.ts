// localStorage round-trips for the lyrics-page visibility flag (jsdom
// provides the real localStorage; the fallback path is forced by swapping
// the global).
import { afterEach, describe, expect, it } from 'vitest';
import {
  LYRICS_OPEN_STORAGE_KEY,
  loadStoredLyricsOpen,
  persistLyricsOpen,
} from '@/lib/lyricsVisibility';

afterEach(() => {
  localStorage.clear();
});

describe('lyricsVisibility persistence', () => {
  it('round-trips the flag through localStorage', () => {
    expect(loadStoredLyricsOpen()).toBe(false); // nothing stored yet
    persistLyricsOpen(true);
    expect(localStorage.getItem(LYRICS_OPEN_STORAGE_KEY)).toBe('true');
    expect(loadStoredLyricsOpen()).toBe(true);
    persistLyricsOpen(false);
    expect(loadStoredLyricsOpen()).toBe(false);
  });

  it('treats corrupt stored values as hidden', () => {
    localStorage.setItem(LYRICS_OPEN_STORAGE_KEY, 'yes');
    expect(loadStoredLyricsOpen()).toBe(false);
    localStorage.setItem(LYRICS_OPEN_STORAGE_KEY, 'TRUE');
    expect(loadStoredLyricsOpen()).toBe(false);
  });

  it('degrades gracefully when storage is unavailable', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
      configurable: true,
    });
    try {
      // Reads fall back to hidden; writes are silently best-effort.
      expect(loadStoredLyricsOpen()).toBe(false);
      expect(() => persistLyricsOpen(true)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
