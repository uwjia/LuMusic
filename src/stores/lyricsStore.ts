// Lyrics state: page visibility + per-track lyric loading.
// Data flows through the api seam (mockable); time-based highlighting
// stays in the page component where the playback position lives.

import { create } from 'zustand';
import { api } from '@/api';
import type { LyricLine } from '@/types/track';

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

interface LyricsStoreState {
  /** Whether the lyrics page is shown (toggled from the player bar). */
  open: boolean;
  /** Track the loaded lyrics belong to; null = nothing loaded. */
  trackId: string | null;
  lines: LyricLine[];
  sourcePath: string | null;
  status: LyricsStatus;
  error: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Loads lyrics for a track; `null` resets to idle (no current track). */
  load: (trackId: string | null) => Promise<void>;
}

// Shared "nothing loaded" shape for resets.
const IDLE = {
  trackId: null,
  lines: [] as LyricLine[],
  sourcePath: null,
  status: 'idle' as LyricsStatus,
  error: null,
};

// Monotonic request counter: only the newest load may write state, so a
// slow answer for an old track cannot resurrect stale lyrics after a switch.
let loadRequest = 0;

export const useLyricsStore = create<LyricsStoreState>((set) => ({
  open: false,
  ...IDLE,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),

  load: async (trackId) => {
    const request = ++loadRequest;
    if (trackId == null) {
      set({ ...IDLE });
      return;
    }
    set({ trackId, status: 'loading', error: null });
    try {
      const lyrics = await api.lyricsGet(trackId);
      if (request !== loadRequest) return; // superseded by a newer load
      if (lyrics == null) {
        set({ lines: [], sourcePath: null, status: 'missing' });
      } else {
        set({ lines: lyrics.lines, sourcePath: lyrics.sourcePath, status: 'ready' });
      }
    } catch (err) {
      if (request !== loadRequest) return;
      set({
        lines: [],
        sourcePath: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
