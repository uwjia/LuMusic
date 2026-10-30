// Behavior tests for the library page: debounced search + wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../api';
import type { Track } from '../../types/track';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePlayerStore } from '../../stores/playerStore';
import { LibraryPage } from './LibraryPage';

vi.mock('../../api', () => ({
  api: {
    getTracks: vi.fn(),
    playerLoad: vi.fn(),
    playerState: vi.fn(),
  },
}));

const tracks: Track[] = [
  {
    id: 't1',
    title: 'Alpha Waves',
    artist: 'Nova Fields',
    album: 'Aurora',
    albumArtist: null,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    durationSecs: 184,
    filePath: 'C:/m/t1.mp3',
    sizeBytes: 1,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(api.getTracks).mockResolvedValue(tracks);
  useLibraryStore.setState({
    tracks,
    query: { search: null, sort: 'title', descending: false },
    loading: false,
    scanProgress: null,
    lastScan: null,
    error: null,
  });
  usePlayerStore.setState({ state: null, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LibraryPage', () => {
  it('renders the track count and rows', () => {
    render(<LibraryPage onOpenSettings={() => {}} />);
    expect(screen.getByTestId('track-count')).toHaveTextContent('1 tracks');
    expect(screen.getByText('Alpha Waves')).toBeInTheDocument();
  });

  it('debounces search input into one query per pause', async () => {
    render(<LibraryPage onOpenSettings={() => {}} />);
    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: 'n' } });
    fireEvent.change(input, { target: { value: 'no' } });
    fireEvent.change(input, { target: { value: 'nova' } });
    expect(api.getTracks).not.toHaveBeenCalledWith(
      expect.objectContaining({ search: 'n' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.getTracks).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'nova' }),
    );
  });

  it('double-click on a row loads the queue starting at that row', async () => {
    vi.mocked(api.playerLoad).mockResolvedValue(
      (await api.playerState()) as never,
    );
    vi.mocked(api.playerLoad).mockClear();
    render(<LibraryPage onOpenSettings={() => {}} />);
    fireEvent.doubleClick(screen.getByTestId('track-row-0'));
    expect(api.playerLoad).toHaveBeenCalledWith(['t1'], 0);
  });

  it('shows the scan progress bar while scanning', () => {
    useLibraryStore.setState({ scanProgress: { scanned: 2, total: 5 } });
    render(<LibraryPage onOpenSettings={() => {}} />);
    expect(screen.getByTestId('scan-progress')).toHaveTextContent('2/5');
  });

  it('shows an empty-library CTA when there are no tracks', () => {
    useLibraryStore.setState({ tracks: [] });
    render(<LibraryPage onOpenSettings={() => {}} />);
    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
  });
});
