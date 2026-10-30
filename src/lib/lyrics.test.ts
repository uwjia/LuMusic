import { describe, expect, it } from 'vitest';
import { activeLyricIndex } from '@/lib/lyrics';
import type { LyricLine } from '@/types/track';

const lines: LyricLine[] = [
  { timeMs: 0, text: 'a' },
  { timeMs: 5_000, text: 'b' },
  { timeMs: 10_000, text: 'c' },
];

describe('activeLyricIndex', () => {
  it('returns -1 while the intro plays before the first line', () => {
    expect(activeLyricIndex(lines, 0)).toBe(0); // line at exactly 0ms is active
    expect(activeLyricIndex(lines, -1)).toBe(-1);
    expect(
      activeLyricIndex(
        [
          { timeMs: 2_000, text: 'late start' },
        ],
        1.5,
      ),
    ).toBe(-1);
  });

  it('returns the last line at or before the position', () => {
    expect(activeLyricIndex(lines, 4.999)).toBe(0);
    expect(activeLyricIndex(lines, 5)).toBe(1);
    expect(activeLyricIndex(lines, 9.9)).toBe(1);
    expect(activeLyricIndex(lines, 42)).toBe(2); // past the end keeps the last line
  });

  it('handles empty lyrics', () => {
    expect(activeLyricIndex([], 10)).toBe(-1);
  });
});
