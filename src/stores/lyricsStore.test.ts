// Lyrics store behavior (api mocked at the seam).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { Lyrics } from '@/types/track';
import { LYRICS_OPEN_STORAGE_KEY } from '@/lib/lyricsVisibility';
import { useLyricsStore } from '@/stores/lyricsStore';

vi.mock('@/api', () => ({
  api: { lyricsGet: vi.fn() },
}));

const lyrics: Lyrics = {
  sourcePath: 'C:/m/a.lrc',
  lines: [
    { timeMs: 0, text: 'first' },
    { timeMs: 4_000, text: 'second' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // The visibility flag only reads storage at module load; clearing keeps
  // assertions on freshly written values honest.
  localStorage.removeItem(LYRICS_OPEN_STORAGE_KEY);
  useLyricsStore.setState({
    open: false,
    trackId: null,
    lines: [],
    sourcePath: null,
    status: 'idle',
    error: null,
  });
});

describe('lyricsStore', () => {
  it('toggle and setOpen flip the page visibility', () => {
    useLyricsStore.getState().toggle();
    expect(useLyricsStore.getState().open).toBe(true);
    useLyricsStore.getState().setOpen(false);
    expect(useLyricsStore.getState().open).toBe(false);
  });

  it('persists the visibility flag on setOpen and toggle', () => {
    useLyricsStore.getState().setOpen(true);
    expect(localStorage.getItem(LYRICS_OPEN_STORAGE_KEY)).toBe('true');
    useLyricsStore.getState().toggle();
    expect(localStorage.getItem(LYRICS_OPEN_STORAGE_KEY)).toBe('false');
  });

  it('restores the persisted visibility when the store is (re)created', async () => {
    // Simulates a restart: a fresh module registry re-reads localStorage.
    localStorage.setItem(LYRICS_OPEN_STORAGE_KEY, 'true');
    vi.resetModules();
    const { useLyricsStore: fresh } = await import('@/stores/lyricsStore');
    expect(fresh.getState().open).toBe(true);
    // Hidden is the default for a missing/cleared value.
    localStorage.removeItem(LYRICS_OPEN_STORAGE_KEY);
    vi.resetModules();
    const { useLyricsStore: cleared } = await import('@/stores/lyricsStore');
    expect(cleared.getState().open).toBe(false);
    // Leave a module registry consistent with the top-level import above.
    vi.resetModules();
  });

  it('load(null) resets to idle (playback stopped)', async () => {
    useLyricsStore.setState({ status: 'ready', trackId: 't1', lines: lyrics.lines });
    await useLyricsStore.getState().load(null);
    const s = useLyricsStore.getState();
    expect(s.status).toBe('idle');
    expect(s.trackId).toBeNull();
    expect(s.lines).toEqual([]);
    expect(s.sourcePath).toBeNull();
  });

  it('loads lyrics through the api and exposes ready state', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
    await useLyricsStore.getState().load('t1');
    const s = useLyricsStore.getState();
    expect(api.lyricsGet).toHaveBeenCalledWith('t1');
    expect(s.trackId).toBe('t1');
    expect(s.status).toBe('ready');
    expect(s.lines).toEqual(lyrics.lines);
    expect(s.sourcePath).toBe('C:/m/a.lrc');
  });

  it('a null answer surfaces as missing (no .lrc file)', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(null);
    await useLyricsStore.getState().load('t2');
    const s = useLyricsStore.getState();
    expect(s.status).toBe('missing');
    expect(s.lines).toEqual([]);
  });

  it('api failures surface as error with the message', async () => {
    vi.mocked(api.lyricsGet).mockRejectedValue(new Error('boom'));
    await useLyricsStore.getState().load('t1');
    const s = useLyricsStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('ignores a stale response that resolves after a newer load started', async () => {
    let resolveFirst!: (value: Lyrics | null) => void;
    vi.mocked(api.lyricsGet)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(null);
    const first = useLyricsStore.getState().load('t1');
    const second = useLyricsStore.getState().load('t2');
    resolveFirst(lyrics); // the old track's lyrics arrive last
    await Promise.all([first, second]);
    const s = useLyricsStore.getState();
    expect(s.trackId).toBe('t2');
    expect(s.status).toBe('missing');
    expect(s.lines).toEqual([]);
  });
});
