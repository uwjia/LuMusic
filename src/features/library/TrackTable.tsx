// Virtualized track table: sort headers, current-track highlight,
// double-click to play from a position.

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDuration } from '../../lib/format';
import type { SortField, Track } from '../../types/track';

export const ROW_HEIGHT = 36;

interface TrackTableProps {
  tracks: Track[];
  currentId?: string | null;
  sort: SortField;
  descending: boolean;
  onSort: (field: SortField) => void;
  /** Start playback with `tracks[index]` as the current track. */
  onPlay: (index: number) => void;
  /** Optional per-row action (e.g. "add to playlist"). */
  rowAction?: (track: Track) => React.ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
}

const COLUMNS: { key: SortField | 'index' | 'duration'; label: string; className: string }[] = [
  { key: 'index', label: '#', className: 'col-index' },
  { key: 'title', label: 'Title', className: 'col-title' },
  { key: 'artist', label: 'Artist', className: 'col-artist' },
  { key: 'album', label: 'Album', className: 'col-album' },
  { key: 'duration', label: 'Time', className: 'col-duration' },
];

export function TrackTable({
  tracks,
  currentId,
  sort,
  descending,
  onSort,
  onPlay,
  rowAction,
  emptyTitle = 'No tracks yet',
  emptyHint = 'Scan a music folder to fill your library.',
}: TrackTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // jsdom reports a 0px scroll element; seed a viewport so rows render in tests.
    initialRect: { width: 900, height: 600 },
  });

  if (tracks.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">{emptyTitle}</div>
        <div className="empty-state-hint">{emptyHint}</div>
      </div>
    );
  }

  return (
    <div className="track-table" role="grid" aria-label="Tracks">
      <div className="track-header" role="row">
        {COLUMNS.map((col) => {
          const sortable = col.key === 'title' || col.key === 'artist' || col.key === 'album';
          const active = sort === col.key;
          return (
            <button
              key={col.key}
              type="button"
              role="columnheader"
              disabled={!sortable}
              className={`track-header-cell ${col.className} ${active ? 'is-active' : ''}`}
              aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
              onClick={() => sortable && onSort(col.key as SortField)}
            >
              {col.label}
              {active ? (descending ? ' ↓' : ' ↑') : ''}
            </button>
          );
        })}
      </div>

      <div ref={parentRef} className="track-body">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const track = tracks[row.index];
            const isCurrent = track.id === currentId;
            return (
              <div
                key={track.id}
                role="row"
                aria-rowindex={row.index + 1}
                className={`track-row ${isCurrent ? 'is-current' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${row.start}px)`,
                }}
                onDoubleClick={() => onPlay(row.index)}
                data-testid={`track-row-${row.index}`}
              >
                <span className={`cell ${COLUMNS[0].className}`}>
                  {isCurrent ? <span className="playing-dot" aria-label="playing" /> : row.index + 1}
                </span>
                <span className={`cell ${COLUMNS[1].className}`} title={track.title}>
                  {track.title}
                </span>
                <span className={`cell ${COLUMNS[2].className}`}>{track.artist ?? '—'}</span>
                <span className={`cell ${COLUMNS[3].className}`}>{track.album ?? '—'}</span>
                <span className={`cell ${COLUMNS[4].className}`}>
                  {track.durationSecs != null ? formatDuration(track.durationSecs) : '—'}
                  {rowAction ? <span className="row-action">{rowAction(track)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
