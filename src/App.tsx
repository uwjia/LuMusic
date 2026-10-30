// App shell: title bar, sidebar navigation, routed content, player bar,
// event bridge.

import { useEffect, useState } from 'react';
import { LibraryPage } from '@/features/library/LibraryPage';
import { PlayerBar } from '@/features/player/PlayerBar';
import { PlaylistPage } from '@/features/playlists/PlaylistPage';
import { Sidebar } from '@/features/playlists/Sidebar';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TitleBar } from '@/features/shell/TitleBar';
import { usePlayerEvents } from '@/hooks/usePlayerEvents';
import { useTraySync } from '@/hooks/useTraySync';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';

type View = { kind: 'library' } | { kind: 'settings' } | { kind: 'playlist'; id: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: 'library' });

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
      <Sidebar view={view} onNavigate={setView} />
      <main className="content">
        {view.kind === 'library' ? <LibraryPage onOpenSettings={() => setView({ kind: 'settings' })} /> : null}
        {view.kind === 'settings' ? <SettingsPage /> : null}
        {view.kind === 'playlist' ? <PlaylistPage playlistId={view.id} /> : null}
      </main>
      <PlayerBar />
    </div>
  );
}
