// Sidebar navigation: library, playlists (create/select), settings.
//
// Playlist row actions (rename / duplicate / delete) live in a custom
// right-click menu on the row; renaming swaps the row for an inline editor.

import { useState } from 'react';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useTranslation } from '@/i18n';
import { displayPlaylistName } from '@/lib/playlistDisplay';

interface SidebarProps {
  view: { kind: 'library' } | { kind: 'settings' } | { kind: 'playlist'; id: string };
  onNavigate: (view: SidebarProps['view']) => void;
}

export function Sidebar({ view, onNavigate }: SidebarProps) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const error = usePlaylistStore((s) => s.error);
  const { create, select, rename, duplicate, remove } = usePlaylistStore.getState();
  const currentTrackId = usePlayerStore((s) => s.state?.currentTrack?.id ?? null);
  const { t } = useTranslation();

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Context menu target: which playlist row was right-clicked, and where.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const submit = async () => {
    // Trim here so the API contract stays "display-ready name".
    const ok = await create(newName.trim());
    if (ok) {
      setNewName('');
      setCreating(false);
    }
  };

  const submitRename = async () => {
    if (renamingId == null) return;
    const trimmed = draftName.trim();
    const current = playlists.find((p) => p.id === renamingId);
    // Unchanged or empty input just closes the editor — nothing to save.
    if (trimmed === '' || trimmed === current?.name) {
      setRenamingId(null);
      return;
    }
    const ok = await rename(renamingId, trimmed);
    // On failure keep the editor open so the sidebar error (duplicate/
    // empty name) renders next to it and the name can be corrected.
    if (ok) setRenamingId(null);
  };

  const menuPlaylist = menu ? playlists.find((p) => p.id === menu.id) : undefined;
  const menuItems = (playlist: NonNullable<typeof menuPlaylist>): ContextMenuItem[] => [
    {
      key: 'rename',
      label: t('playlist.rename'),
      onSelect: () => {
        // Seed the editor with the canonical stored name, never the
        // localized display name: saving the latter would persist a
        // translated name and break the rescan overwrite semantics.
        setDraftName(playlist.name);
        setRenamingId(playlist.id);
      },
    },
    {
      key: 'duplicate',
      label: t('playlist.duplicate'),
      onSelect: () => void duplicate(playlist.id),
    },
    {
      key: 'delete',
      label: t('playlist.delete'),
      danger: true,
      onSelect: () => void remove(playlist.id),
    },
  ];

  return (
    <nav className="sidebar" aria-label={t('nav.navigation')}>
      <button
        type="button"
        className={`nav-item ${view.kind === 'library' ? 'is-active' : ''}`}
        onClick={() => onNavigate({ kind: 'library' })}
      >
        🎵 {t('nav.library')}
      </button>

      <div className="sidebar-section">
        <div className="sidebar-heading">{t('nav.playlists')}</div>
        <ul className="playlist-list">
          {playlists.map((playlist) => {
            const playingHere = playlist.items.includes(currentTrackId ?? '');
            return (
              <li key={playlist.id}>
                {renamingId === playlist.id ? (
                  <form
                    className="playlist-rename"
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
                      onKeyDown={(e) => e.key === 'Escape' && setRenamingId(null)}
                    />
                    <button type="submit" className="btn btn-primary">
                      {t('playlist.save')}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className={`nav-item ${view.kind === 'playlist' && view.id === playlist.id ? 'is-active' : ''}`}
                    onClick={() => {
                      // Single click only opens the playlist view; playback
                      // starts by double-clicking a row in the playlist page.
                      void select(playlist.id);
                      onNavigate({ kind: 'playlist', id: playlist.id });
                    }}
                    onContextMenu={(e) => {
                      // Suppress the native menu — the app renders its own.
                      e.preventDefault();
                      setMenu({ id: playlist.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    {playingHere ? '🔊 ' : '🗎 '}
                    <span className="nav-label">{displayPlaylistName(playlist, t)}</span>
                    <span className="muted count">{playlist.items.length}</span>
                  </button>
                )}
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
              aria-label={t('nav.newPlaylistName')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => newName.trim() === '' && setCreating(false)}
            />
            <button type="submit" className="btn btn-primary">
              {t('nav.add')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="nav-item playlist-new"
            onClick={() => setCreating(true)}
            data-testid="new-playlist"
          >
            {t('nav.newPlaylist')}
          </button>
        )}
        {error ? <div className="sidebar-error" role="alert">{error}</div> : null}
      </div>

      <button
        type="button"
        className={`nav-item ${view.kind === 'settings' ? 'is-active' : ''}`}
        onClick={() => onNavigate({ kind: 'settings' })}
      >
        ⚙ {t('nav.settings')}
      </button>

      {menu && menuPlaylist ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t('playlist.actions')}
          items={menuItems(menuPlaylist)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </nav>
  );
}
