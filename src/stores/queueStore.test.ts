// Behavior tests for the queue store (api mocked at the seam).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { useQueueStore } from '@/stores/queueStore';
import type { PlayerState, QueueView } from '@/types/track';

vi.mock('@/api', () => ({
  api: {
    playerQueue: vi.fn(),
    playerQueueInsertNext: vi.fn(),
    playerQueueAppend: vi.fn(),
    playerQueueRemove: vi.fn(),
    playerQueueJump: vi.fn(),
  },
}));

const view: QueueView = {
  tracks: [
    {
      id: 'a',
      title: 'A',
      artist: null,
      album: null,
      albumArtist: null,
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      durationSecs: 10,
      filePath: 'C:/a.mp3',
      sizeBytes: 1,
    },
  ],
  position: 0,
};

const state = (): PlayerState => ({
  status: 'playing',
  currentTrack: view.tracks[0],
  queuePosition: 0,
  queueLen: 1,
  positionSecs: 0,
  durationSecs: 10,
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
});

beforeEach(() => {
  vi.clearAllMocks();
  useQueueStore.setState({ open: false, queue: null, error: null });
});

describe('queueStore', () => {
  it('refresh stores the queue snapshot', async () => {
    vi.mocked(api.playerQueue).mockResolvedValue(view);
    await useQueueStore.getState().refresh();
    expect(useQueueStore.getState().queue).toEqual(view);
    expect(useQueueStore.getState().error).toBeNull();
  });

  it('actions call the api and refetch the queue', async () => {
    vi.mocked(api.playerQueueInsertNext).mockResolvedValue(state());
    vi.mocked(api.playerQueueAppend).mockResolvedValue(state());
    vi.mocked(api.playerQueueRemove).mockResolvedValue(state());
    vi.mocked(api.playerQueueJump).mockResolvedValue(state());
    vi.mocked(api.playerQueue).mockResolvedValue(view);

    await useQueueStore.getState().insertNext('a');
    expect(api.playerQueueInsertNext).toHaveBeenCalledWith('a');
    await useQueueStore.getState().append('a');
    expect(api.playerQueueAppend).toHaveBeenCalledWith('a');
    await useQueueStore.getState().remove(0);
    expect(api.playerQueueRemove).toHaveBeenCalledWith(0);
    await useQueueStore.getState().jump(0);
    expect(api.playerQueueJump).toHaveBeenCalledWith(0);

    // Every action refreshed the snapshot afterwards.
    expect(api.playerQueue).toHaveBeenCalledTimes(4);
    expect(useQueueStore.getState().queue).toEqual(view);
  });

  it('failures surface as store errors without clobbering the list', async () => {
    useQueueStore.setState({ queue: view });
    vi.mocked(api.playerQueueRemove).mockRejectedValue(
      new Error('cannot remove the playing track from the queue'),
    );
    vi.mocked(api.playerQueue).mockResolvedValue(view);
    await useQueueStore.getState().remove(0);
    expect(useQueueStore.getState().error).toContain('playing track');
    expect(useQueueStore.getState().queue).toEqual(view);
  });
});
