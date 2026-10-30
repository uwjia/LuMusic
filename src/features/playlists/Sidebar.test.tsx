// Behavior tests for the sidebar navigation (api mocked).
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../api';
import type { Playlist } from '../../types/track';
import { usePlayerStore } from '../../stores/playerStore';
import { usePlaylistStore } from '../../stores/playlistStore';
import { Sidebar } from './Sidebar';

vi.mock('../../api', () => ({
  api: {
    playlistList: vi.fn(),
    playlistGetTracks: vi.fn(),
    playlistCreate: vi.fn(),
    playlistDelete: vi.fn(),
    playlistRename: vi.fn(),
  },
}));

const playlists: Playlist[] = [
  { id: 'p1', name: 'Chill', items: ['t1'], createdAt: 1 },
  { id: 'p2', name: 'Focus', items: [], createdAt: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.playlistList).mockResolvedValue(playlists);
  vi.mocked(api.playlistGetTracks).mockResolvedValue([]);
  usePlaylistStore.setState({
    playlists,
    selectedTracks: [],
    selectedId: null,
    error: null,
  });
  usePlayerStore.setState({ state: null, error: null });
});

describe('Sidebar', () => {
  const onNavigate = vi.fn();

  it('lists playlists with item counts', () => {
    render(<Sidebar view={{ kind: 'library' }} onNavigate={onNavigate} />);
    expect(screen.getByText('Chill')).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // Chill count
  });

  it('clicking a playlist selects it and navigates', async () => {
    render(<Sidebar view={{ kind: 'library' }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Chill'));
    await vi.waitFor(() => expect(api.playlistGetTracks).toHaveBeenCalledWith('p1'));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'playlist', id: 'p1' });
  });

  it('creating a playlist posts the trimmed name', async () => {
    vi.mocked(api.playlistCreate).mockResolvedValue(playlists[0]);
    render(<Sidebar view={{ kind: 'library' }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('new-playlist'));
    const input = screen.getByLabelText('New playlist name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Road Trip  ' } });
    fireEvent.submit(input.form!);
    await vi.waitFor(() =>
      expect(api.playlistCreate).toHaveBeenCalledWith('Road Trip'),
    );
  });

  it('keeps duplicate-name errors visible for correction', async () => {
    vi.mocked(api.playlistCreate).mockRejectedValue(
      new Error("a playlist named 'Chill' already exists"),
    );
    render(<Sidebar view={{ kind: 'library' }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('new-playlist'));
    const input = screen.getByLabelText('New playlist name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Chill' } });
    fireEvent.submit(input.form!);
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('already exists'),
    );
  });
});
