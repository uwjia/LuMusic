// Behavior tests for the player store (api layer is mocked).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { PlayerState } from '@/types/track';
import {
  nextPlayMode,
  playModeOf,
  usePlayerStore,
} from '@/stores/playerStore';

vi.mock('@/api', () => ({
  api: {
    playerState: vi.fn(),
    playerToggle: vi.fn(),
    playerLoad: vi.fn(),
    playerSetVolume: vi.fn(),
    playerSetMode: vi.fn(),
  },
}));

const idle: PlayerState = {
  status: 'stopped',
  currentTrack: null,
  queuePosition: null,
  queueLen: 0,
  positionSecs: 0,
  durationSecs: null,
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
};

function playing(overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...idle, status: 'playing', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ state: null, error: null });
});

describe('playerStore', () => {
  it('refresh stores the fetched state', async () => {
    vi.mocked(api.playerState).mockResolvedValue(playing());
    await usePlayerStore.getState().refresh();
    expect(usePlayerStore.getState().state?.status).toBe('playing');
    expect(usePlayerStore.getState().error).toBeNull();
  });

  it('toggle applies the returned state', async () => {
    vi.mocked(api.playerToggle).mockResolvedValue(playing());
    await usePlayerStore.getState().toggle();
    expect(api.playerToggle).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().state?.status).toBe('playing');
  });

  it('command failures surface as error and keep old state', async () => {
    usePlayerStore.setState({ state: idle });
    vi.mocked(api.playerToggle).mockRejectedValue(new Error('boom'));
    await usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().error).toBe('boom');
    expect(usePlayerStore.getState().state).toEqual(idle);
  });

  it('load passes ids and start index', async () => {
    vi.mocked(api.playerLoad).mockResolvedValue(playing());
    await usePlayerStore.getState().load(['a', 'b'], 1);
    expect(api.playerLoad).toHaveBeenCalledWith(['a', 'b'], 1);
  });

  it('cyclePlayMode walks sequential -> repeat all -> repeat one -> shuffle', async () => {
    // Mirror the backend: echo the requested flags back as the new state.
    vi.mocked(api.playerSetMode).mockImplementation(
      async (shuffle?: boolean, repeat?: PlayerState['repeat']) =>
        playing({ shuffle: shuffle ?? false, repeat: repeat ?? 'off' }),
    );
    const step = async (from: Partial<PlayerState>) => {
      usePlayerStore.setState({ state: playing(from) });
      await usePlayerStore.getState().cyclePlayMode();
    };

    await step({ shuffle: false, repeat: 'off' });
    expect(api.playerSetMode).toHaveBeenLastCalledWith(false, 'all');

    await step({ shuffle: false, repeat: 'all' });
    expect(api.playerSetMode).toHaveBeenLastCalledWith(false, 'one');

    await step({ shuffle: false, repeat: 'one' });
    // Shuffle keeps the queue wrapping so random play never dead-ends.
    expect(api.playerSetMode).toHaveBeenLastCalledWith(true, 'all');

    await step({ shuffle: true, repeat: 'all' });
    expect(api.playerSetMode).toHaveBeenLastCalledWith(false, 'off');

    expect(api.playerSetMode).toHaveBeenCalledTimes(4);
  });

  it('cyclePlayMode before the first state fetch starts from sequential', async () => {
    vi.mocked(api.playerSetMode).mockResolvedValue(playing({ repeat: 'all' }));
    await usePlayerStore.getState().cyclePlayMode();
    expect(api.playerSetMode).toHaveBeenCalledWith(false, 'all');
  });
});

describe('play mode helpers', () => {
  it('nextPlayMode follows the UI cycle order', () => {
    expect(nextPlayMode('sequential')).toBe('repeatAll');
    expect(nextPlayMode('repeatAll')).toBe('repeatOne');
    expect(nextPlayMode('repeatOne')).toBe('shuffle');
    expect(nextPlayMode('shuffle')).toBe('sequential');
  });

  it('playModeOf derives the mode, shuffle flag winning over repeat', () => {
    expect(playModeOf({ shuffle: false, repeat: 'off' })).toBe('sequential');
    expect(playModeOf({ shuffle: false, repeat: 'all' })).toBe('repeatAll');
    expect(playModeOf({ shuffle: false, repeat: 'one' })).toBe('repeatOne');
    expect(playModeOf({ shuffle: true, repeat: 'off' })).toBe('shuffle');
    expect(playModeOf({ shuffle: true, repeat: 'one' })).toBe('shuffle');
  });
});
