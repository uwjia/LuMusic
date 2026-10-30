// Player state store: mirrors backend PlayerState, updated by command
// results and push events (see usePlayerEvents). All mutations flow through
// the api layer so tests can intercept them.

import { create } from 'zustand';
import { api } from '@/api';
import type { PlayerState, RepeatMode } from '@/types/track';

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
  /** Advances the single play-mode button: 顺序 → 列表循环 → 单曲循环 → 随机. */
  cyclePlayMode: () => Promise<void>;
}

/** The four play modes offered by the single transport button. */
export type PlayMode = 'sequential' | 'repeatAll' | 'repeatOne' | 'shuffle';

/** Cycle order of the play-mode button. */
export const PLAY_MODE_ORDER: PlayMode[] = ['sequential', 'repeatAll', 'repeatOne', 'shuffle'];

/**
 * Backend (shuffle, repeat) flags each UI mode maps to. Shuffle keeps
 * `repeat: all` so a shuffled session never dead-ends after one pass.
 */
const PLAY_MODE_FLAGS: Record<PlayMode, { shuffle: boolean; repeat: RepeatMode }> = {
  sequential: { shuffle: false, repeat: 'off' },
  repeatAll: { shuffle: false, repeat: 'all' },
  repeatOne: { shuffle: false, repeat: 'one' },
  shuffle: { shuffle: true, repeat: 'all' },
};

/** Derives the UI mode from any backend state (shuffle flag wins). */
export function playModeOf(state: Pick<PlayerState, 'shuffle' | 'repeat'>): PlayMode {
  if (state.shuffle) return 'shuffle';
  if (state.repeat === 'all') return 'repeatAll';
  if (state.repeat === 'one') return 'repeatOne';
  return 'sequential';
}

export function nextPlayMode(current: PlayMode): PlayMode {
  return PLAY_MODE_ORDER[(PLAY_MODE_ORDER.indexOf(current) + 1) % PLAY_MODE_ORDER.length];
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

  // Play mode cycles sequential -> repeat all -> repeat one -> shuffle;
  // each step sends the full (shuffle, repeat) pair so any legacy backend
  // combination is normalized on the first click.
  cyclePlayMode: async () => {
    const current = usePlayerStore.getState().state;
    const next = nextPlayMode(playModeOf(current ?? { shuffle: false, repeat: 'off' }));
    const flags = PLAY_MODE_FLAGS[next];
    await run(set, () => api.playerSetMode(flags.shuffle, flags.repeat));
  },
}));
