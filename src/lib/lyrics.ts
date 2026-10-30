// Pure lyric helpers shared by the lyrics page (unit-tested here).

import type { LyricLine } from '@/types/track';

/**
 * Index of the line sung at `positionSecs`: the last line at or before the
 * position (the backend delivers lines sorted by `timeMs`). `-1` while the
 * song intro plays, before the first line.
 */
export function activeLyricIndex(lines: readonly LyricLine[], positionSecs: number): number {
  const positionMs = positionSecs * 1000;
  let active = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].timeMs <= positionMs) {
      active = i;
    } else {
      break; // sorted input: nothing later can match
    }
  }
  return active;
}
