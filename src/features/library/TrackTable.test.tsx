// Rendering + interaction tests for the track table (pure component).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '../../types/track';
import { TrackTable } from './TrackTable';

const track = (id: string, title: string, artist: string, album: string): Track => ({
  id,
  title,
  artist,
  album,
  albumArtist: null,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  durationSecs: 125,
  filePath: `C:/m/${id}.mp3`,
  sizeBytes: 1,
});

const tracks = [
  track('a', 'Alpha', 'Nova', 'Aurora'),
  track('b', 'Beta', 'Ember', 'Dusk'),
];

describe('TrackTable', () => {
  const onPlay = vi.fn();
  const onSort = vi.fn();

  function renderTable(overrides: Partial<Parameters<typeof TrackTable>[0]> = {}) {
    render(
      <TrackTable
        tracks={tracks}
        currentId={null}
        sort="title"
        descending={false}
        onPlay={onPlay}
        onSort={onSort}
        {...overrides}
      />,
    );
  }

  it('renders all rows with their metadata', () => {
    renderTable();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.getAllByText('2:05')).toHaveLength(2);
  });

  it('double-click starts playback at the row index', () => {
    renderTable();
    fireEvent.doubleClick(screen.getByTestId('track-row-1'));
    expect(onPlay).toHaveBeenCalledWith(1);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('highlights the current track with aria and styles', () => {
    renderTable({ currentId: 'b' });
    expect(document.querySelector('.track-row.is-current')).toBeTruthy();
  });

  it('clicking a sortable header requests that sort field', () => {
    renderTable();
    fireEvent.click(screen.getByRole('columnheader', { name: /artist/i }));
    expect(onSort).toHaveBeenCalledWith('artist');
  });

  it('marks the active column with aria-sort direction', () => {
    renderTable({ sort: 'album', descending: true });
    expect(screen.getByRole('columnheader', { name: /album/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('shows the empty state instead of a table when there are no tracks', () => {
    renderTable({ tracks: [], emptyTitle: 'Nothing here', emptyHint: 'Scan something' });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByTestId('track-row-0')).toBeNull();
  });
});
