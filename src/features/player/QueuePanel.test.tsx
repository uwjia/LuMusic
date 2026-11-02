// Behavior tests for the play-queue panel popover (api mocked at the seam).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { api } from '@/api';
import { useQueueStore } from '@/stores/queueStore';
import { QueuePanel } from '@/features/player/QueuePanel';
import type { Track } from '@/types/track';

vi.mock('@/api', () => ({
  api: {
    playerQueue: vi.fn(),
    playerQueueInsertNext: vi.fn(),
    playerQueueAppend: vi.fn(),
    playerQueueRemove: vi.fn(),
    playerQueueJump: vi.fn(),
  },
}));

const makeTrack = (id: string, title: string, artist: string | null): Track => ({
  id,
  title,
  artist,
  album: null,
  albumArtist: null,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  durationSecs: 100 + title.length,
  filePath: `C:/${id}.mp3`,
  sizeBytes: 1,
});

const tracks = [
  makeTrack('a', 'Alpha', 'Nova'),
  makeTrack('b', 'Blue', null),
  makeTrack('c', 'Crimson', 'Ember'),
];

const anchorRef = createRef<HTMLButtonElement>();

beforeEach(() => {
  vi.clearAllMocks();
  useQueueStore.setState({ open: true, queue: null, error: null });
});

describe('QueuePanel', () => {
  it('loads the queue on mount and lists rows with the playing one marked', async () => {
    vi.mocked(api.playerQueue).mockResolvedValue({ tracks, position: 1 });
    render(<QueuePanel anchorRef={anchorRef} />);
    expect(await screen.findByTestId('queue-row-0')).toBeInTheDocument();
    expect(api.playerQueue).toHaveBeenCalledTimes(1);

    // All rows render (virtualization seeded for jsdom) with metadata.
    expect(screen.getByTestId('queue-row-0')).toHaveTextContent('Alpha');
    expect(screen.getByTestId('queue-row-1')).toHaveTextContent('Blue');
    expect(screen.getByTestId('queue-row-2')).toHaveTextContent('Crimson');
    // Count text reflects the queue length.
    expect(screen.getByText('3 tracks')).toBeInTheDocument();
    // The playing row protects its remove button.
    expect(screen.getByTestId('queue-remove-1')).toBeDisabled();
    expect(screen.getByTestId('queue-remove-0')).toBeEnabled();
  });

  it('shows the empty state for an idle queue', async () => {
    vi.mocked(api.playerQueue).mockResolvedValue({ tracks: [], position: null });
    render(<QueuePanel anchorRef={anchorRef} />);
    expect(await screen.findByTestId('queue-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('queue-list')).not.toBeInTheDocument();
  });

  it('clicking a row jumps playback to it', async () => {
    vi.mocked(api.playerQueue).mockResolvedValue({ tracks, position: 0 });
    vi.mocked(api.playerQueueJump).mockResolvedValue({
      status: 'playing',
      currentTrack: tracks[2],
      queuePosition: 2,
      queueLen: 3,
      positionSecs: 0,
      durationSecs: 107,
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
    });
    render(<QueuePanel anchorRef={anchorRef} />);
    fireEvent.click(await screen.findByTestId('queue-row-2'));
    expect(api.playerQueueJump).toHaveBeenCalledWith(2);
  });

  it('the remove button drops upcoming rows', async () => {
    vi.mocked(api.playerQueue).mockResolvedValue({ tracks, position: 0 });
    vi.mocked(api.playerQueueRemove).mockResolvedValue({
      status: 'playing',
      currentTrack: tracks[0],
      queuePosition: 0,
      queueLen: 2,
      positionSecs: 0,
      durationSecs: 105,
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
    });
    render(<QueuePanel anchorRef={anchorRef} />);
    fireEvent.click(await screen.findByTestId('queue-remove-1'));
    expect(api.playerQueueRemove).toHaveBeenCalledWith(1);
  });

  it('renders refresh failures as an alert', async () => {
    vi.mocked(api.playerQueue).mockRejectedValue(new Error('boom'));
    render(<QueuePanel anchorRef={anchorRef} />);
    expect(await screen.findByTestId('queue-error')).toHaveTextContent('boom');
  });

  it('closes on Escape and outside presses, but not on the anchor', async () => {
    vi.mocked(api.playerQueue).mockResolvedValue({ tracks, position: 0 });
    render(<QueuePanel anchorRef={anchorRef} />);
    await screen.findByTestId('queue-panel');

    // Outside press closes the popover.
    fireEvent.pointerDown(document.body, { clientX: 300, clientY: 0 });
    expect(useQueueStore.getState().open).toBe(false);

    useQueueStore.getState().setOpen(true);
    // A press on the anchor button is the toggle's own job.
    const anchor = anchorRef.current ?? document.createElement('button');
    fireEvent.pointerDown(anchor);
    expect(useQueueStore.getState().open).toBe(true);

    // Escape closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useQueueStore.getState().open).toBe(false);
  });
});
