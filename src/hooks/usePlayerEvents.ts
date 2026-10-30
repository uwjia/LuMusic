// Bridges backend push events into the stores.
// Mount once near the app root.

import { useEffect } from 'react';
import { api } from '../api';
import { useLibraryStore } from '../stores/libraryStore';
import { usePlayerStore } from '../stores/playerStore';
import { usePlaylistStore } from '../stores/playlistStore';

export function usePlayerEvents(): void {
  useEffect(() => {
    const unsubs = [
      api.onPlayerState((state) => usePlayerStore.getState().applyState(state)),
      api.onProgress((p) => {
        // Progress updates only move the position/duration fields.
        const store = usePlayerStore.getState();
        if (store.state) {
          store.applyState({ ...store.state, ...p });
        }
      }),
      api.onScanProgress((p) => useLibraryStore.getState().applyScanProgress(p)),
      api.onLibraryUpdated(() => {
        // Scan finished: refresh lists (progress event already carried totals).
        void useLibraryStore.getState().load();
        void usePlaylistStore.getState().load();
      }),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, []);
}
