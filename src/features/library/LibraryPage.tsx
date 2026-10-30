// Library page: search + track table + scan status.

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePlayerStore } from '../../stores/playerStore';
import { TrackTable } from './TrackTable';

const SEARCH_DEBOUNCE_MS = 250;

interface LibraryPageProps {
  onOpenSettings: () => void;
}

export function LibraryPage({ onOpenSettings }: LibraryPageProps) {
  const tracks = useLibraryStore((s) => s.tracks);
  const query = useLibraryStore((s) => s.query);
  const loading = useLibraryStore((s) => s.loading);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const { setSearch, toggleSort, load } = useLibraryStore.getState();
  const playerState = usePlayerStore((s) => s.state);

  const [term, setTerm] = useState(query.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search: local input stays responsive, the query fires once.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void setSearch(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, setSearch]);

  return (
    <section className="page" data-testid="library-page">
      <header className="page-header">
        <input
          type="search"
          className="search-input"
          placeholder="Search title, artist, album…"
          aria-label="Search tracks"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          data-testid="search-input"
        />
        <span className="muted" data-testid="track-count">
          {tracks.length} tracks{loading ? ' · loading…' : ''}
        </span>
        <Button variant="primary" onClick={onOpenSettings}>
          Manage library
        </Button>
      </header>

      {scanProgress ? (
        <div className="scan-progress" data-testid="scan-progress">
          <div className="scan-progress-bar">
            <div
              className="scan-progress-fill"
              style={{
                width:
                  scanProgress.total > 0
                    ? `${Math.round((scanProgress.scanned / scanProgress.total) * 100)}%`
                    : '0%',
              }}
            />
          </div>
          <span className="muted">
            Scanning… {scanProgress.scanned}/{scanProgress.total || '?'}
          </span>
        </div>
      ) : null}

      <TrackTable
        tracks={tracks}
        currentId={playerState?.currentTrack?.id ?? null}
        sort={query.sort}
        descending={query.descending}
        onSort={(field) => void toggleSort(field)}
        onPlay={(index) => void usePlayerStore.getState().load(tracks.map((t) => t.id), index)}
        emptyTitle={query.search ? 'No matches' : 'Your library is empty'}
        emptyHint={
          query.search
            ? 'Try different search terms.'
            : 'Pick a music folder in Settings and scan it.'
        }
      />

      {tracks.length === 0 && !query.search ? (
        <div className="page-footer">
          <Button onClick={() => void load()}>Refresh</Button>
        </div>
      ) : null}
    </section>
  );
}
