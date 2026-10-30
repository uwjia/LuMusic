// Behavior tests for the library store (api layer is mocked).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { ScanSummary, Track } from '@/types/track';
import { DEFAULT_QUERY, useLibraryStore } from '@/stores/libraryStore';

vi.mock('@/api', () => ({
  api: {
    getTracks: vi.fn(),
    scanLibrary: vi.fn(),
  },
}));

const tracks = (n: number): Track[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Track ${i}`,
    artist: 'Artist',
    album: 'Album',
    albumArtist: null,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    durationSecs: 100 + i,
    filePath: `C:/m/t${i}.mp3`,
    sizeBytes: 1,
  }));

const summary: ScanSummary = {
  root: 'C:/music',
  filesSeen: 3,
  added: 3,
  updated: 0,
  removed: 0,
  skipped: 0,
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({
    tracks: [],
    query: { ...DEFAULT_QUERY },
    loading: false,
    scanProgress: null,
    lastScan: null,
    error: null,
  });
});

describe('libraryStore', () => {
  it('load stores tracks for the current query', async () => {
    vi.mocked(api.getTracks).mockResolvedValue(tracks(2));
    await useLibraryStore.getState().load();
    expect(api.getTracks).toHaveBeenCalledWith(DEFAULT_QUERY);
    expect(useLibraryStore.getState().tracks).toHaveLength(2);
    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it('load failure sets error', async () => {
    vi.mocked(api.getTracks).mockRejectedValue(new Error('io'));
    await useLibraryStore.getState().load();
    expect(useLibraryStore.getState().error).toBe('io');
    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it('setSearch trims input and nulls blanks', async () => {
    vi.mocked(api.getTracks).mockResolvedValue([]);
    await useLibraryStore.getState().setSearch('  nova fields ');
    expect(api.getTracks).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'nova fields' }),
    );
    await useLibraryStore.getState().setSearch('   ');
    expect(api.getTracks).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: null }),
    );
  });

  it('toggleSort flips direction on the same column and resets on a new one', async () => {
    vi.mocked(api.getTracks).mockResolvedValue([]);
    await useLibraryStore.getState().toggleSort('title');
    expect(useLibraryStore.getState().query.descending).toBe(true); // default title asc -> desc

    await useLibraryStore.getState().toggleSort('artist');
    expect(useLibraryStore.getState().query).toEqual(
      expect.objectContaining({ sort: 'artist', descending: false }),
    );
  });

  it('scan tracks progress, stores summary and reloads tracks', async () => {
    vi.mocked(api.scanLibrary).mockImplementation(async () => {
      useLibraryStore.getState().applyScanProgress({ scanned: 2, total: 3 });
      return summary;
    });
    vi.mocked(api.getTracks).mockResolvedValue(tracks(3));

    const ok = await useLibraryStore.getState().scan('C:/music');
    expect(ok).toBe(true);
    expect(useLibraryStore.getState().lastScan).toEqual(summary);
    expect(useLibraryStore.getState().scanProgress).toBeNull();
    expect(useLibraryStore.getState().tracks).toHaveLength(3);
  });

  it('scan failure records the error and returns false', async () => {
    vi.mocked(api.scanLibrary).mockRejectedValue(new Error('denied'));
    const ok = await useLibraryStore.getState().scan('C:/nope');
    expect(ok).toBe(false);
    expect(useLibraryStore.getState().error).toBe('denied');
    expect(useLibraryStore.getState().scanProgress).toBeNull();
  });
});
