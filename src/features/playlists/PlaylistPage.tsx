// Playlist detail page: play the playlist, remove/reorder entries.
// Playlist-level actions (rename / duplicate / delete) live in the sidebar's
// right-click menu, so the header only identifies the playlist.

import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/i18n';
import { displayPlaylistName } from '@/lib/playlistDisplay';
import { TrackTable } from '@/features/library/TrackTable';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';

export function PlaylistPage({ playlistId }: { playlistId: string }) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const tracks = usePlaylistStore((s) => s.selectedTracks);
  const playerState = usePlayerStore((s) => s.state);
  const error = usePlaylistStore((s) => s.error);
  const { removeTrack } = usePlaylistStore.getState();
  const { t } = useTranslation();

  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist) {
    return (
      <section className="page">
        <div className="empty-state">
          <div className="empty-state-title">{t('playlist.notFound')}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="page" data-testid="playlist-page">
      <header className="page-header">
        <h2>{displayPlaylistName(playlist, t)}</h2>
        <span className="muted">
          {tracks.length === 1
            ? t('playlist.trackCountOne', { count: tracks.length })
            : t('playlist.trackCount', { count: tracks.length })}
        </span>
      </header>

      {error ? (
        <div className="page-error" role="alert">
          {error}
        </div>
      ) : null}

      <TrackTable
        tracks={tracks}
        currentId={playerState?.currentTrack?.id ?? null}
        sort="title"
        descending={false}
        onSort={() => {
          /* playlists keep their own order; header sorting is disabled here */
        }}
        onPlay={(index) => void usePlayerStore.getState().load(tracks.map((tr) => tr.id), index)}
        emptyTitle={t('playlist.empty')}
        emptyHint={t('playlist.emptyHint')}
        rowAction={(track) => (
          <Button
            className="row-btn"
            aria-label={t('playlist.removeTrack', { title: track.title })}
            onClick={() => void removeTrack(track.id)}
          >
            ✕
          </Button>
        )}
      />
    </section>
  );
}
