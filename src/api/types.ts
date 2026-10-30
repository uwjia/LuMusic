// The single seam between UI code and the backend.
// Two implementations exist: `tauri.ts` (real app) and `mock.ts`
// (tests + `npm run dev:mock` browser development).

import type {
  PlayerState,
  Playlist,
  ScanProgress,
  ScanSummary,
  Settings,
  Track,
  TrackId,
  TrackQuery,
} from '@/types/track';

export type Unsubscribe = () => void;

export interface PlayerApi {
  appInfo(): Promise<{ name: string; version: string }>;

  // library
  scanLibrary(root: string): Promise<ScanSummary>;
  getTracks(query?: Partial<TrackQuery>): Promise<Track[]>;

  // playback (each control returns the resulting state)
  playerState(): Promise<PlayerState>;
  playerLoad(ids: TrackId[], startIndex?: number): Promise<PlayerState>;
  playerToggle(): Promise<PlayerState>;
  playerPause(): Promise<PlayerState>;
  playerResume(): Promise<PlayerState>;
  playerStop(): Promise<PlayerState>;
  playerNext(): Promise<PlayerState>;
  playerPrev(): Promise<PlayerState>;
  playerSeek(secs: number): Promise<PlayerState>;
  playerSetVolume(volume: number): Promise<PlayerState>;
  playerSetMode(shuffle?: boolean, repeat?: PlayerState['repeat']): Promise<PlayerState>;

  // playlists
  playlistList(): Promise<Playlist[]>;
  playlistCreate(name: string): Promise<Playlist>;
  playlistRename(id: string, newName: string): Promise<void>;
  playlistDelete(id: string): Promise<void>;
  playlistAddTrack(id: string, trackId: TrackId): Promise<boolean>;
  playlistRemoveTrack(id: string, trackId: TrackId): Promise<void>;
  playlistMoveTrack(id: string, from: number, to: number): Promise<void>;
  playlistGetTracks(id: string): Promise<Track[]>;

  // settings
  settingsGet(): Promise<Settings>;

  // events
  onPlayerState(cb: (state: PlayerState) => void): Unsubscribe;
  onProgress(cb: (p: { positionSecs: number; durationSecs: number | null }) => void): Unsubscribe;
  onScanProgress(cb: (p: ScanProgress) => void): Unsubscribe;
  onLibraryUpdated(cb: (summary: ScanSummary) => void): Unsubscribe;
}
