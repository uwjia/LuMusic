// Behavior tests for the player store (api layer is mocked).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { PlayerState } from '../types/track';
import { nextRepeatMode, usePlayerStore } from './playerStore';

vi.mock('../api', () => ({
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

  it('setShuffle keeps repeat untouched', async () => {
    const state = playing({ shuffle: true, repeat: 'one' });
    vi.mocked(api.playerSetMode).mockResolvedValue(state);
    await usePlayerStore.getState().setShuffle(true);
    expect(api.playerSetMode).toHaveBeenCalledWith(true);
    expect(usePlayerStore.getState().state?.repeat).toBe('one');
  });

  it('cycleRepeat walks off -> all -> one -> off preserving shuffle', async () => {
    let current = idle;
    vi.mocked(api.playerSetMode).mockImplementation(
      async (shuffle?: boolean, repeat?: PlayerState['repeat']) =>
        playing({ shuffle: shuffle ?? false, repeat: repeat ?? 'off' }),
    );
    const cycle = async () => {
      usePlayerStore.setState({ state: current });
      await usePlayerStore.getState().cycleRepeat();
      current = usePlayerStore.getState().state ?? idle;
    };

    await cycle();
    expect(current.repeat).toBe('all');
    await cycle();
    expect(current.repeat).toBe('one');
    await cycle();
    expect(current.repeat).toBe('off');

    // Shuffle flag survives the cycle.
    usePlayerStore.setState({ state: playing({ shuffle: true, repeat: 'off' }) });
    await usePlayerStore.getState().cycleRepeat();
    expect(usePlayerStore.getState().state?.shuffle).toBe(true);
    expect(api.playerSetMode).toHaveBeenLastCalledWith(true, 'all');
  });
});

describe('nextRepeatMode', () => {
  it('follows the UI cycle order', () => {
    expect(nextRepeatMode('off')).toBe('all');
    expect(nextRepeatMode('all')).toBe('one');
    expect(nextRepeatMode('one')).toBe('off');
  });
});
