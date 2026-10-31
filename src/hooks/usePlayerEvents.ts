// Bridges backend push events into the stores.
// Mount once near the app root.

import { useEffect } from 'react';
import { api } from '@/api';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';

export function usePlayerEvents(): void {
  useEffect(() => {
    const unsubs = [
      api.onPlayerState((state) => usePlayerStore.getState().applyState(state)),
      api.onProgress((p) => {
        const store = usePlayerStore.getState();
        if (!store.state) return;
        // A tick serialized just before a track switch can arrive after the
        // switch's fresh state (events and invoke responses travel on
        // different channels); applying it would rewind the seek bar into
        // the previous track's position instead of restarting at 0. The
        // track id makes such ticks recognizable and droppable.
        if (p.trackId !== (store.state.currentTrack?.id ?? null)) return;
        store.applyState({
          ...store.state,
          positionSecs: p.positionSecs,
          durationSecs: p.durationSecs,
        });
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
