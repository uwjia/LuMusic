// Behavior tests for the event bridge hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { api } from '@/api';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlayerEvents } from '@/hooks/usePlayerEvents';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock('@/api', () => ({
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
    act(() =>
      handlers.get('progress')!({ trackId: null, positionSecs: 12.5, durationSecs: 100 }),
    );
    expect(usePlayerStore.getState().state).toEqual(
      expect.objectContaining({ positionSecs: 12.5, durationSecs: 100 }),
    );
  });

  it('ignores progress ticks before the first state snapshot', () => {
    renderHook(() => usePlayerEvents());
    act(() =>
      handlers.get('progress')!({ trackId: null, positionSecs: 5, durationSecs: 10 }),
    );
    expect(usePlayerStore.getState().state).toBeNull();
  });

  // Regression pin: a tick serialized before a track switch can arrive in
  // the webview after the switch's fresh state (events and invoke responses
  // travel on different channels). Applying it rewound the seek bar into
  // the previous track's position — "next/previous didn't restart at 0".
  it('drops progress ticks that belong to the previous track', () => {
    const trackA = { id: 'a', title: 'A' } as never;
    const trackB = { id: 'b', title: 'B' } as never;
    renderHook(() => usePlayerEvents());
    act(() =>
      handlers.get('state')!({ ...idleState, currentTrack: trackA, positionSecs: 137 }),
    );
    // Fresh state from playerNext: track B restarted at 0.
    act(() =>
      handlers.get('state')!({ ...idleState, currentTrack: trackB, positionSecs: 0 }),
    );
    // Stale tick for track A lands last: must be ignored, not applied.
    act(() =>
      handlers.get('progress')!({ trackId: 'a', positionSecs: 137.25, durationSecs: 200 }),
    );
    expect(usePlayerStore.getState().state).toEqual(
      expect.objectContaining({ currentTrack: trackB, positionSecs: 0 }),
    );

    // A live tick for the current track still applies.
    act(() =>
      handlers.get('progress')!({ trackId: 'b', positionSecs: 0.25, durationSecs: 180 }),
    );
    expect(usePlayerStore.getState().state).toEqual(
      expect.objectContaining({ positionSecs: 0.25, durationSecs: 180 }),
    );
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
