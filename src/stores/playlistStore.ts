// Playlist store: list + the selected playlist's tracks.

import { create } from 'zustand';
import { api } from '../api';
import type { Playlist, Track } from '../types/track';

interface PlaylistStoreState {
  playlists: Playlist[];
  /** Tracks of `selectedId`, refreshed on selection/mutation. */
  selectedTracks: Track[];
  selectedId: string | null;
  error: string | null;
  load: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  create: (name: string) => Promise<boolean>;
  rename: (id: string, newName: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  addTrack: (trackId: string) => Promise<boolean>;
  removeTrack: (trackId: string) => Promise<boolean>;
  moveTrack: (from: number, to: number) => Promise<boolean>;
}

async function guard(
  set: (partial: Partial<PlaylistStoreState>) => void,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    set({ error: null });
    await action();
    return true;
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export const usePlaylistStore = create<PlaylistStoreState>((set, get) => ({
  playlists: [],
  selectedTracks: [],
  selectedId: null,
  error: null,

  load: async () => {
    const playlists = await api.playlistList();
    set({ playlists });
    const { selectedId } = get();
    if (selectedId && !playlists.some((p) => p.id === selectedId)) {
      set({ selectedId: null, selectedTracks: [] });
    }
  },

  select: async (id) => {
    set({ selectedId: id });
    if (id == null) {
      set({ selectedTracks: [] });
      return;
    }
    const selectedTracks = await api.playlistGetTracks(id);
    set({ selectedTracks });
  },

  create: (name) =>
    guard(set, async () => {
      await api.playlistCreate(name);
      await get().load();
    }),

  rename: (id, newName) =>
    guard(set, async () => {
      await api.playlistRename(id, newName);
      await get().load();
    }),

  remove: (id) =>
    guard(set, async () => {
      await api.playlistDelete(id);
      if (get().selectedId === id) {
        set({ selectedId: null, selectedTracks: [] });
      }
      await get().load();
    }),

  addTrack: (trackId) =>
    guard(set, async () => {
      const { selectedId } = get();
      if (!selectedId) throw new Error('no playlist selected');
      await api.playlistAddTrack(selectedId, trackId);
      await get().select(selectedId);
      await get().load();
    }),

  removeTrack: (trackId) =>
    guard(set, async () => {
      const { selectedId } = get();
      if (!selectedId) throw new Error('no playlist selected');
      await api.playlistRemoveTrack(selectedId, trackId);
      await get().select(selectedId);
      await get().load();
    }),

  moveTrack: (from, to) =>
    guard(set, async () => {
      const { selectedId } = get();
      if (!selectedId) throw new Error('no playlist selected');
      await api.playlistMoveTrack(selectedId, from, to);
      await get().select(selectedId);
      await get().load();
    }),
}));
