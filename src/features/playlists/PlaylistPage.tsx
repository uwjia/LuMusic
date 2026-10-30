// Playlist detail page: play the playlist, remove/reorder entries.

import { Button } from '../../components/ui/Button';
import { TrackTable } from '../library/TrackTable';
import { usePlayerStore } from '../../stores/playerStore';
import { usePlaylistStore } from '../../stores/playlistStore';

export function PlaylistPage({ playlistId }: { playlistId: string }) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const tracks = usePlaylistStore((s) => s.selectedTracks);
  const playerState = usePlayerStore((s) => s.state);
  const { removeTrack, remove, rename } = usePlaylistStore.getState();

  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist) {
    return (
      <section className="page">
        <div className="empty-state">
          <div className="empty-state-title">Playlist not found</div>
        </div>
      </section>
    );
  }

  return (
    <section className="page" data-testid="playlist-page">
      <header className="page-header">
        <h2>{playlist.name}</h2>
        <span className="muted">
          {tracks.length} track{tracks.length === 1 ? '' : 's'}
        </span>
        <div className="header-actions">
          <Button onClick={() => void rename(playlist.id, `${playlist.name} (copy)`)}>Duplicate</Button>
          <Button
            className="danger"
            onClick={() => {
              void remove(playlist.id);
            }}
          >
            Delete playlist
          </Button>
        </div>
      </header>

      <TrackTable
        tracks={tracks}
        currentId={playerState?.currentTrack?.id ?? null}
        sort="title"
        descending={false}
        onSort={() => {
          /* playlists keep their own order; header sorting is disabled here */
        }}
        onPlay={(index) => void usePlayerStore.getState().load(tracks.map((t) => t.id), index)}
        emptyTitle="This playlist is empty"
        emptyHint="Add tracks from the library using the ＋ button on each row."
        rowAction={(track) => (
          <Button
            className="row-btn"
            aria-label={`Remove ${track.title} from playlist`}
            onClick={() => void removeTrack(track.id)}
          >
            ✕
          </Button>
        )}
      />
    </section>
  );
}
