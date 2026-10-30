// Library page: search + track table + scan status.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useTranslation } from '@/i18n';
import { TrackTable } from '@/features/library/TrackTable';

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
  const { t } = useTranslation();

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

  const trackCount =
    tracks.length === 1
      ? t('library.trackCountOne', { count: tracks.length })
      : t('library.trackCount', { count: tracks.length });

  return (
    <section className="page" data-testid="library-page">
      <header className="page-header">
        <input
          type="search"
          className="search-input"
          placeholder={t('library.searchPlaceholder')}
          aria-label={t('library.searchLabel')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          data-testid="search-input"
        />
        <span className="muted" data-testid="track-count">
          {trackCount}
          {loading ? t('library.loadingSuffix') : ''}
        </span>
        <Button variant="primary" onClick={onOpenSettings}>
          {t('library.manage')}
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
            {t('library.scanning', {
              scanned: scanProgress.scanned,
              total: scanProgress.total || '?',
            })}
          </span>
        </div>
      ) : null}

      <TrackTable
        tracks={tracks}
        currentId={playerState?.currentTrack?.id ?? null}
        sort={query.sort}
        descending={query.descending}
        onSort={(field) => void toggleSort(field)}
        onPlay={(index) => void usePlayerStore.getState().load(tracks.map((tr) => tr.id), index)}
        emptyTitle={query.search ? t('library.noMatches') : t('library.empty')}
        emptyHint={
          query.search ? t('library.noMatchesHint') : t('library.emptyHint')
        }
      />

      {tracks.length === 0 && !query.search ? (
        <div className="page-footer">
          <Button onClick={() => void load()}>{t('library.refresh')}</Button>
        </div>
      ) : null}
    </section>
  );
}
