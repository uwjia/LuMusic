// Playlist detail page: play the playlist, remove/reorder entries.

import { useState } from 'react';
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
  const { removeTrack, remove, rename, duplicate } = usePlaylistStore.getState();
  const { t } = useTranslation();

  // Inline rename editor state in the page header.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

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

  const submitRename = async () => {
    const trimmed = draftName.trim();
    // Unchanged or empty input just closes the editor — nothing to save.
    if (trimmed === '' || trimmed === playlist.name) {
      setEditing(false);
      return;
    }
    const ok = await rename(playlist.id, trimmed);
    // On failure keep the editor open so the error (duplicate/empty name)
    // renders next to it and the name can be corrected.
    if (ok) setEditing(false);
  };

  return (
    <section className="page" data-testid="playlist-page">
      <header className="page-header">
        {editing ? (
          <form
            className="header-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRename();
            }}
          >
            <input
              autoFocus
              aria-label={t('playlist.nameLabel')}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            />
            <Button variant="primary" type="submit">
              {t('playlist.save')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('playlist.cancel')}</Button>
          </form>
        ) : (
          <>
            <h2>{displayPlaylistName(playlist, t)}</h2>
            <span className="muted">
              {tracks.length === 1
                ? t('playlist.trackCountOne', { count: tracks.length })
                : t('playlist.trackCount', { count: tracks.length })}
            </span>
          </>
        )}
        <div className="header-actions">
          <Button
            onClick={() => {
              // Seed the editor with the canonical stored name, never the
              // localized display name: saving the latter would persist a
              // translated name and break the rescan overwrite semantics.
              setDraftName(playlist.name);
              setEditing(true);
            }}
          >
            {t('playlist.rename')}
          </Button>
          <Button onClick={() => void duplicate(playlist.id)}>{t('playlist.duplicate')}</Button>
          <Button
            className="danger"
            onClick={() => {
              void remove(playlist.id);
            }}
          >
            {t('playlist.delete')}
          </Button>
        </div>
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
