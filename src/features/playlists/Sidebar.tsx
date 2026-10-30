// Sidebar navigation: library, playlists (create/select), settings.

import { useState } from 'react';
import { usePlaylistStore } from '../../stores/playlistStore';
import { usePlayerStore } from '../../stores/playerStore';

interface SidebarProps {
  view: { kind: 'library' } | { kind: 'settings' } | { kind: 'playlist'; id: string };
  onNavigate: (view: SidebarProps['view']) => void;
}

export function Sidebar({ view, onNavigate }: SidebarProps) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const error = usePlaylistStore((s) => s.error);
  const { create, select } = usePlaylistStore.getState();
  const currentTrackId = usePlayerStore((s) => s.state?.currentTrack?.id ?? null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    // Trim here so the API contract stays "display-ready name".
    const ok = await create(newName.trim());
    if (ok) {
      setNewName('');
      setCreating(false);
    }
  };

  return (
    <nav className="sidebar" aria-label="Navigation">
      <div className="brand">LuMusic</div>

      <button
        type="button"
        className={`nav-item ${view.kind === 'library' ? 'is-active' : ''}`}
        onClick={() => onNavigate({ kind: 'library' })}
      >
        🎵 Library
      </button>

      <div className="sidebar-section">
        <div className="sidebar-heading">Playlists</div>
        <ul className="playlist-list">
          {playlists.map((playlist) => {
            const playingHere = playlist.items.includes(currentTrackId ?? '');
            return (
              <li key={playlist.id}>
                <button
                  type="button"
                  className={`nav-item ${view.kind === 'playlist' && view.id === playlist.id ? 'is-active' : ''}`}
                  onClick={() => {
                    void select(playlist.id);
                    onNavigate({ kind: 'playlist', id: playlist.id });
                  }}
                >
                  {playingHere ? '🔊 ' : '🗎 '}
                  <span className="nav-label">{playlist.name}</span>
                  <span className="muted count">{playlist.items.length}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {creating ? (
          <form
            className="playlist-create"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              aria-label="New playlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => newName.trim() === '' && setCreating(false)}
            />
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="nav-item playlist-new"
            onClick={() => setCreating(true)}
            data-testid="new-playlist"
          >
            ＋ New playlist
          </button>
        )}
        {error ? <div className="sidebar-error" role="alert">{error}</div> : null}
      </div>

      <button
        type="button"
        className={`nav-item ${view.kind === 'settings' ? 'is-active' : ''}`}
        onClick={() => onNavigate({ kind: 'settings' })}
      >
        ⚙ Settings
      </button>
    </nav>
  );
}
