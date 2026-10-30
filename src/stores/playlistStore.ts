// Playlist store: list + the selected playlist's tracks.

import { create } from 'zustand';
import { api } from '@/api';
import { t } from '@/i18n';
import { displayPlaylistName } from '@/lib/playlistDisplay';
import type { Playlist, Track } from '@/types/track';

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
  duplicate: (id: string) => Promise<boolean>;
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

  // There is no dedicated backend command; copying is composed from the
  // existing api surface: create the copy, then replay every track in order.
  duplicate: (id) =>
    guard(set, async () => {
      const source = get().playlists.find((p) => p.id === id);
      if (!source) throw new Error('playlist not found');
      // The "(copy)" suffix is locale-aware ("（副本）" in Chinese); the
      // first untaken name is picked so repeated duplicates don't fail on
      // the DuplicateName check. Copies are manual playlists, so they are
      // named after the *display* name (a Chinese UI duplicating "Default"
      // should read "默认歌单（副本）", not mix scripts).
      const baseName = displayPlaylistName(source, t);
      const taken = new Set(get().playlists.map((p) => p.name.toLowerCase()));
      let name = t('playlist.copyName', { name: baseName });
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
        name = t('playlist.copyNameN', { name: baseName, n });
      }
      const created = await api.playlistCreate(name);
      for (const trackId of source.items) {
        await api.playlistAddTrack(created.id, trackId);
      }
      // Keep the source selected: the page stays on the playlist the user
      // is looking at; the copy shows up in the sidebar list.
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
