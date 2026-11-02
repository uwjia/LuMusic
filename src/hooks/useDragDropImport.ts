// Bridges native file drag-and-drop into a library import.
//
// The drop zone is the whole content area: files dropped while a playlist
// page is open join that playlist, anywhere else they only enter the
// library. Mount once near the content root; returns whether a drag is
// currently hovering the window (for the highlight overlay).

import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';

export function useDragDropImport(targetPlaylistId: string | null): boolean {
  const [dragging, setDragging] = useState(false);
  // The subscription outlives view switches; the ref keeps the drop
  // targeting whatever playlist is open at drop time, without resubscribing.
  const targetRef = useRef(targetPlaylistId);
  useEffect(() => {
    targetRef.current = targetPlaylistId;
  }, [targetPlaylistId]);

  useEffect(() => {
    return api.onDragDrop((event) => {
      if (event.type === 'leave') {
        setDragging(false);
        return;
      }
      if (event.type === 'enter' || event.type === 'over') {
        setDragging(true);
        return;
      }
      setDragging(false);
      if (event.paths.length === 0) return;
      void (async () => {
        const summary = await useLibraryStore
          .getState()
          .importFiles(event.paths, targetRef.current ?? undefined);
        // The import may have appended to the open playlist; refresh the
        // sidebar counts and the open playlist's tracks.
        if (summary) void usePlaylistStore.getState().load();
      })();
    });
  }, []);

  return dragging;
}
