import { describe, expect, it } from 'vitest';
import {
  EQ_BAND_COUNT,
  EQ_PRESETS,
  clampGain,
  flatGains,
  normalizeGains,
  presetIdOf,
} from '@/lib/equalizer';

describe('equalizer presets', () => {
  it('every preset defines exactly EQ_BAND_COUNT in-range gains', () => {
    for (const preset of EQ_PRESETS) {
      expect(preset.gains).toHaveLength(EQ_BAND_COUNT);
      for (const gain of preset.gains) {
        expect(clampGain(gain)).toBe(gain);
      }
    }
  });

  it('identifies the matching preset by gains', () => {
    const rock = EQ_PRESETS.find((p) => p.id === 'rock')!;
    expect(presetIdOf(rock.gains)).toBe('rock');
    expect(presetIdOf(flatGains())).toBe('flat');
  });

  it('hand-edited curves are custom, not a preset', () => {
    const gains = flatGains();
    gains[3] = 2;
    expect(presetIdOf(gains)).toBeNull();
  });

  it('matching tolerates unclamped/out-of-shape input', () => {
    expect(presetIdOf(flatGains().concat(99))).toBe('flat');
    // NaN collapses to 0 dB, which still matches the flat preset.
    expect(presetIdOf([Number.NaN, ...flatGains().slice(1)])).toBe('flat');
    // An out-of-range value clamps to +12: custom, not flat.
    expect(presetIdOf([99, ...flatGains().slice(1)])).toBeNull();
  });
});

describe('normalizeGains', () => {
  it('pads, truncates and clamps into a valid band vector', () => {
    expect(normalizeGains([])).toEqual(flatGains());
    expect(normalizeGains([99, -99, Number.NaN])).toEqual([
      12, -12, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(normalizeGains(Array(15).fill(5))).toHaveLength(EQ_BAND_COUNT);
  });
});

describe('clampGain', () => {
  it('keeps in-range values and collapses NaN', () => {
    expect(clampGain(0)).toBe(0);
    expect(clampGain(7.5)).toBe(7.5);
    expect(clampGain(20)).toBe(12);
    expect(clampGain(-20)).toBe(-12);
    expect(clampGain(Number.NaN)).toBe(0);
  });
});
