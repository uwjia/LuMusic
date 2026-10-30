// Behavior tests for the event bridge hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { api } from '../api';
import { useLibraryStore } from '../stores/libraryStore';
import { usePlayerStore } from '../stores/playerStore';
import { usePlayerEvents } from './usePlayerEvents';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock('../api', () => ({
  api: {
    onPlayerState: vi.fn((cb: Handler) => {
      handlers.set('state', cb);
      return () => handlers.delete('state');
    }),
    onProgress: vi.fn((cb: Handler) => {
      handlers.set('progress', cb);
      return () => handlers.delete('progress');
    }),
    onScanProgress: vi.fn((cb: Handler) => {
      handlers.set('scan', cb);
      return () => handlers.delete('scan');
    }),
    onLibraryUpdated: vi.fn((cb: Handler) => {
      handlers.set('library', cb);
      return () => handlers.delete('library');
    }),
    getTracks: vi.fn().mockResolvedValue([]),
    playlistList: vi.fn().mockResolvedValue([]),
  },
}));

const idleState = {
  status: 'playing' as const,
  currentTrack: null,
  queuePosition: 0,
  queueLen: 1,
  positionSecs: 0,
  durationSecs: 100,
  volume: 0.5,
  shuffle: false,
  repeat: 'off' as const,
};

beforeEach(() => {
  handlers.clear();
  usePlayerStore.setState({ state: null, error: null });
  useLibraryStore.setState({ tracks: [], scanProgress: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePlayerEvents', () => {
  it('routes player state events into the player store', () => {
    renderHook(() => usePlayerEvents());
    act(() => handlers.get('state')!(idleState));
    expect(usePlayerStore.getState().state).toEqual(idleState);
  });

  it('merges progress ticks into the current state', () => {
    renderHook(() => usePlayerEvents());
    act(() => handlers.get('state')!(idleState));
    act(() => handlers.get('progress')!({ positionSecs: 12.5, durationSecs: 100 }));
    expect(usePlayerStore.getState().state).toEqual(
      expect.objectContaining({ positionSecs: 12.5, durationSecs: 100 }),
    );
  });

  it('ignores progress ticks before the first state snapshot', () => {
    renderHook(() => usePlayerEvents());
    act(() => handlers.get('progress')!({ positionSecs: 5, durationSecs: 10 }));
    expect(usePlayerStore.getState().state).toBeNull();
  });

  it('feeds scan progress and reloads the library on update', () => {
    renderHook(() => usePlayerEvents());
    act(() => handlers.get('scan')!({ scanned: 3, total: 10 }));
    expect(useLibraryStore.getState().scanProgress).toEqual({ scanned: 3, total: 10 });

    act(() => handlers.get('library')!({}));
    expect(api.getTracks).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => usePlayerEvents());
    unmount();
    expect(handlers.size).toBe(0);
  });
});
