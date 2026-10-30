// App shell: title bar, sidebar navigation, routed content, player bar,
// event bridge.

import { useEffect, useState } from 'react';
import { LibraryPage } from '@/features/library/LibraryPage';
import { LyricsPage } from '@/features/lyrics/LyricsPage';
import { PlayerBar } from '@/features/player/PlayerBar';
import { PlaylistPage } from '@/features/playlists/PlaylistPage';
import { Sidebar } from '@/features/playlists/Sidebar';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TitleBar } from '@/features/shell/TitleBar';
import { usePlayerEvents } from '@/hooks/usePlayerEvents';
import { useTraySync } from '@/hooks/useTraySync';
import { useLibraryStore } from '@/stores/libraryStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';

type View = { kind: 'library' } | { kind: 'settings' } | { kind: 'playlist'; id: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: 'library' });
  // Lyrics is a full-content page toggled from the player bar (not a
  // sidebar destination), so it lives beside the routed views.
  const lyricsOpen = useLyricsStore((s) => s.open);

  // Picking any sidebar destination (library / settings / playlist) is an
  // explicit request to leave the lyrics page, so navigation dismisses it.
  const navigate = (next: View) => {
    setView(next);
    useLyricsStore.getState().setOpen(false);
  };

  // Push events (player state/progress, scan progress) -> stores.
  usePlayerEvents();
  // Localize the native tray menu (and re-push on locale switch).
  useTraySync();

  // Initial hydration: player snapshot + library + playlists.
  useEffect(() => {
    void usePlayerStore.getState().refresh();
    void useLibraryStore.getState().load();
    void usePlaylistStore.getState().load();
  }, []);

  return (
    <div className="app-shell">
      <TitleBar />
      <Sidebar view={view} onNavigate={navigate} />
      <main className="content">
        {lyricsOpen ? (
          <LyricsPage />
        ) : (
          <>
            {view.kind === 'library' ? (
              <LibraryPage onOpenSettings={() => setView({ kind: 'settings' })} />
            ) : null}
            {view.kind === 'settings' ? <SettingsPage /> : null}
            {view.kind === 'playlist' ? <PlaylistPage playlistId={view.id} /> : null}
          </>
        )}
      </main>
      <PlayerBar />
    </div>
  );
}
