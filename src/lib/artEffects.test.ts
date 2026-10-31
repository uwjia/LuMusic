// Registry behavior: id uniqueness, sanitize fallbacks and storage
// round-trips (localStorage exists in jsdom, so the real one is used).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ART_EFFECTS,
  ART_EFFECT_STORAGE_KEY,
  DEFAULT_ART_EFFECT,
  isArtEffectId,
  loadStoredArtEffect,
  persistArtEffect,
  sanitizeArtEffect,
} from '@/lib/artEffects';

beforeEach(() => {
  localStorage.clear();
});

describe('artEffects registry', () => {
  it('lists unique preset ids with "off" as the default first entry', () => {
    expect(new Set(ART_EFFECTS).size).toBe(ART_EFFECTS.length);
    expect(ART_EFFECTS[0]).toBe('off');
    expect(DEFAULT_ART_EFFECT).toBe('off');
  });

  it('accepts every listed id and rejects everything else', () => {
    for (const id of ART_EFFECTS) {
      expect(isArtEffectId(id)).toBe(true);
      expect(sanitizeArtEffect(id)).toBe(id);
    }
    // Unknown strings, non-strings and legacy junk all fall back to off.
    expect(sanitizeArtEffect('disco')).toBe('off');
    expect(sanitizeArtEffect('')).toBe('off');
    expect(sanitizeArtEffect(null)).toBe('off');
    expect(sanitizeArtEffect(undefined)).toBe('off');
    expect(sanitizeArtEffect({ id: 'aurora' })).toBe('off');
  });

  it('round-trips a choice through localStorage', () => {
    persistArtEffect('starfield');
    expect(localStorage.getItem(ART_EFFECT_STORAGE_KEY)).toBe('starfield');
    expect(loadStoredArtEffect()).toBe('starfield');
  });

  it('falls back to off when storage holds an unknown value', () => {
    localStorage.setItem(ART_EFFECT_STORAGE_KEY, 'vhs-noise');
    expect(loadStoredArtEffect()).toBe('off');
  });

  it('returns off when storage is unavailable', () => {
    const original = globalThis.localStorage;
    // jsdom throws on property access once removed — the read/write paths
    // must swallow that instead of crashing startup.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage denied');
      },
    });
    try {
      expect(loadStoredArtEffect()).toBe('off');
      expect(() => persistArtEffect('wave')).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      });
    }
  });
});
