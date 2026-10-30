// Player state store: mirrors backend PlayerState, updated by command
// results and push events (see usePlayerEvents). All mutations flow through
// the api layer so tests can intercept them.

import { create } from 'zustand';
import { api } from '../api';
import type { PlayerState, RepeatMode } from '../types/track';

interface PlayerStoreState {
  /** Last known backend state; null until the first fetch completes. */
  state: PlayerState | null;
  /** Set when the latest command failed (surfaces as a toast). */
  error: string | null;
  applyState: (state: PlayerState) => void;
  setError: (error: string | null) => void;
  refresh: () => Promise<void>;
  load: (ids: string[], startIndex?: number) => Promise<void>;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (secs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setShuffle: (shuffle: boolean) => Promise<void>;
  cycleRepeat: () => Promise<void>;
}

/** Repeat modes in UI cycle order. */
export const REPEAT_ORDER: RepeatMode[] = ['off', 'all', 'one'];

export function nextRepeatMode(current: RepeatMode): RepeatMode {
  return REPEAT_ORDER[(REPEAT_ORDER.indexOf(current) + 1) % REPEAT_ORDER.length];
}

async function run(
  set: (partial: Partial<PlayerStoreState>) => void,
  action: () => Promise<PlayerState>,
): Promise<void> {
  try {
    set({ error: null });
    set({ state: await action() });
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const usePlayerStore = create<PlayerStoreState>((set) => ({
  state: null,
  error: null,

  applyState: (state) => set({ state }),
  setError: (error) => set({ error }),

  refresh: () => run(set, () => api.playerState()),
  load: (ids, startIndex) => run(set, () => api.playerLoad(ids, startIndex)),
  toggle: () => run(set, () => api.playerToggle()),
  pause: () => run(set, () => api.playerPause()),
  resume: () => run(set, () => api.playerResume()),
  stop: () => run(set, () => api.playerStop()),
  next: () => run(set, () => api.playerNext()),
  prev: () => run(set, () => api.playerPrev()),
  seek: (secs) => run(set, () => api.playerSeek(secs)),
  setVolume: (volume) => run(set, () => api.playerSetVolume(volume)),

  setShuffle: (shuffle) => run(set, () => api.playerSetMode(shuffle)),

  // Repeat cycles off -> all -> one -> off, keeping the current shuffle flag.
  cycleRepeat: async () => {
    const current = usePlayerStore.getState().state;
    const nextMode = nextRepeatMode(current?.repeat ?? 'off');
    await run(set, () =>
      api.playerSetMode(current?.shuffle ?? false, nextMode),
    );
  },
}));
