// Behavior tests for the drag-and-drop import bridge.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { api } from '@/api';
import { useDragDropImport } from '@/hooks/useDragDropImport';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import type { DragDropEvent } from '@/types/track';

let handler: ((event: DragDropEvent) => void) | null = null;

vi.mock('@/api', () => ({
  api: {
    onDragDrop: vi.fn((cb: (event: DragDropEvent) => void) => {
      handler = cb;
      return () => {
        handler = null;
      };
    }),
    libraryImport: vi
      .fn()
      .mockResolvedValue({ imported: 1, addedToPlaylist: 1, skipped: 0, warnings: [] }),
    getTracks: vi.fn().mockResolvedValue([]),
    playlistList: vi.fn().mockResolvedValue([]),
    playlistGetTracks: vi.fn().mockResolvedValue([]),
  },
}));

const fire = (event: DragDropEvent) => act(() => handler?.(event));

beforeEach(() => {
  handler = null;
  vi.clearAllMocks();
  useLibraryStore.setState({ tracks: [], loading: false, error: null });
  usePlaylistStore.setState({ playlists: [], selectedTracks: [], selectedId: null, error: null });
});

afterEach(() => {
  cleanup();
});

describe('useDragDropImport', () => {
  it('reports hovering while files are over the window', () => {
    const { result } = renderHook(() => useDragDropImport('p1'));
    expect(result.current).toBe(false);
    fire({ type: 'enter', paths: ['C:/m/a.mp3'] });
    expect(result.current).toBe(true);
    fire({ type: 'over' });
    expect(result.current).toBe(true);
    fire({ type: 'leave' });
    expect(result.current).toBe(false);
  });

  it('imports dropped files into the open playlist and refreshes', async () => {
    const { result } = renderHook(() => useDragDropImport('p1'));
    fire({ type: 'drop', paths: ['C:/m/a.mp3', 'C:/m/b.flac'] });
    // The overlay never lingers after the drop.
    expect(result.current).toBe(false);
    await waitFor(() =>
      expect(api.libraryImport).toHaveBeenCalledWith(['C:/m/a.mp3', 'C:/m/b.flac'], 'p1'),
    );
    // The import may have appended to the playlist: both lists refresh.
    await waitFor(() => expect(api.playlistList).toHaveBeenCalled());
    expect(useLibraryStore.getState().error).toBeNull();
  });

  it('imports without a playlist target on non-playlist views', async () => {
    renderHook(() => useDragDropImport(null));
    fire({ type: 'drop', paths: ['C:/m/a.mp3'] });
    await waitFor(() => expect(api.libraryImport).toHaveBeenCalledWith(['C:/m/a.mp3'], undefined));
  });

  it('uses the playlist open at drop time, not at mount time', async () => {
    const { rerender } = renderHook(({ id }) => useDragDropImport(id), {
      initialProps: { id: 'p1' as string | null },
    });
    rerender({ id: 'p2' });
    fire({ type: 'drop', paths: ['C:/m/a.mp3'] });
    await waitFor(() => expect(api.libraryImport).toHaveBeenCalledWith(['C:/m/a.mp3'], 'p2'));
  });

  it('drops without paths import nothing', () => {
    renderHook(() => useDragDropImport('p1'));
    fire({ type: 'leave' });
    expect(api.libraryImport).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useDragDropImport(null));
    unmount();
    expect(handler).toBeNull();
  });
});
