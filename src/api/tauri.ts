// PlayerApi implementation backed by real Tauri IPC.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EventCallback } from '@tauri-apps/api/event';

import type { PlayerApi, Unsubscribe } from './types';
import {
  LIBRARY_SCAN_PROGRESS_EVENT,
  LIBRARY_UPDATED_EVENT,
  PLAYER_PROGRESS_EVENT,
  PLAYER_STATE_EVENT,
  type PlayerState,
  type ScanProgress,
  type ScanSummary,
  type Track,
} from '../types/track';

function wire<T>(event: string, cb: (payload: T) => void): Unsubscribe {
  // `listen` returns a promise with an unlisten fn; bridge to sync API shape.
  let unlisten: (() => void) | null = null;
  let disposed = false;
  const handler: EventCallback<T> = (event) => cb(event.payload);
  listen<T>(event, handler).then((fn) => {
    if (disposed) {
      fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export const tauriApi: PlayerApi = {
  appInfo: () => invoke('app_info'),

  scanLibrary: (root) => invoke('scan_library', { root }),
  getTracks: (query) =>
    invoke('get_tracks', {
      query: { search: null, sort: 'title', descending: false, ...query },
    }) as Promise<Track[]>,

  playerState: () => invoke('player_state'),
  playerLoad: (ids, startIndex) => invoke('player_load', { ids, startIndex }),
  playerToggle: () => invoke('player_toggle'),
  playerPause: () => invoke('player_pause'),
  playerResume: () => invoke('player_resume'),
  playerStop: () => invoke('player_stop'),
  playerNext: () => invoke('player_next'),
  playerPrev: () => invoke('player_prev'),
  playerSeek: (secs) => invoke('player_seek', { secs }),
  playerSetVolume: (volume) => invoke('player_set_volume', { volume }),
  playerSetMode: (shuffle, repeat) => invoke('player_set_mode', { shuffle, repeat }),

  playlistList: () => invoke('playlist_list'),
  playlistCreate: (name) => invoke('playlist_create', { name }),
  playlistRename: (id, newName) => invoke('playlist_rename', { id, newName }),
  playlistDelete: (id) => invoke('playlist_delete', { id }),
  playlistAddTrack: (id, trackId) => invoke('playlist_add_track', { id, trackId }),
  playlistRemoveTrack: (id, trackId) => invoke('playlist_remove_track', { id, trackId }),
  playlistMoveTrack: (id, from, to) => invoke('playlist_move_track', { id, from, to }),
  playlistGetTracks: (id) => invoke('playlist_get_tracks', { id }),

  settingsGet: () => invoke('settings_get'),

  onPlayerState: (cb) => wire<PlayerState>(PLAYER_STATE_EVENT, cb),
  onProgress: (cb) => wire(PLAYER_PROGRESS_EVENT, cb),
  onScanProgress: (cb) => wire<ScanProgress>(LIBRARY_SCAN_PROGRESS_EVENT, cb),
  onLibraryUpdated: (cb) => wire<ScanSummary>(LIBRARY_UPDATED_EVENT, cb),
};
