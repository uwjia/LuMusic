// In-memory PlayerApi used by tests and `npm run dev:mock`.
//
// It mirrors the backend's observable behavior:
// - search: every whitespace-separated term must match (AND);
// - playback auto-advance follows repeat/shuffle rules;
// - events fire through the same subscription callbacks.

import type { PlayerApi, Unsubscribe } from './types';
import type {
  PlayerState,
  Playlist,
  RepeatMode,
  ScanProgress,
  ScanSummary,
  Track,
  TrackQuery,
} from '../types/track';

type Listener<T> = (payload: T) => void;

function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(cb: Listener<T>): Unsubscribe {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(payload: T) {
      listeners.forEach((cb) => cb(payload));
    },
  };
}

const makeTrack = (
  id: string,
  title: string,
  artist: string,
  album: string,
  durationSecs: number,
): Track => ({
  id,
  title,
  artist,
  album,
  albumArtist: artist,
  trackNo: null,
  discNo: null,
  year: 2024,
  genre: 'Demo',
  durationSecs,
  filePath: `C:/mock/${id}.mp3`,
  sizeBytes: Math.round(durationSecs * 1000),
});

const SAMPLE_TRACKS: Track[] = [
  makeTrack('t1', 'Alpha Waves', 'Nova Fields', 'Aurora', 184),
  makeTrack('t2', 'Blue Horizon', 'Nova Fields', 'Aurora', 205),
  makeTrack('t3', 'Crimson Sky', 'The Ember Set', 'Dusk', 167),
  makeTrack('t4', 'Drift', 'The Ember Set', 'Dusk', 232),
  makeTrack('t5', 'Echo Lake', 'Nova Fields', 'Aurora', 198),
];

class MockApi implements PlayerApi {
  private tracks = [...SAMPLE_TRACKS];
  private playlists: Playlist[] = [];
  private queue: Track[] = [];
  private queuePosition: number | null = null;
  private status: PlayerState['status'] = 'stopped';
  private positionSecs = 0;
  private volume = 0.8;
  private shuffle = false;
  private repeat: RepeatMode = 'off';

  private stateEvents = emitter<PlayerState>();
  private progressEvents = emitter<{ positionSecs: number; durationSecs: number | null }>();
  private scanProgressEvents = emitter<ScanProgress>();
  private libraryEvents = emitter<ScanSummary>();

  private timer: ReturnType<typeof setInterval> | null = null;

  // ----- helpers -----

  private snapshot(): PlayerState {
    return {
      status: this.status,
      currentTrack: this.queuePosition != null ? this.queue[this.queuePosition] ?? null : null,
      queuePosition: this.queuePosition,
      queueLen: this.queue.length,
      positionSecs: this.positionSecs,
      durationSecs: this.queuePosition != null
        ? this.queue[this.queuePosition]?.durationSecs ?? null
        : null,
      volume: this.volume,
      shuffle: this.shuffle,
      repeat: this.repeat,
    };
  }

  private publish() {
    this.stateEvents.emit(this.snapshot());
  }

  private ensureTicker() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.status !== 'playing') return;
      const duration = this.snapshot().durationSecs ?? Number.POSITIVE_INFINITY;
      this.positionSecs += 0.25;
      this.progressEvents.emit({
        positionSecs: this.positionSecs,
        durationSecs: this.snapshot().durationSecs,
      });
      if (this.positionSecs >= duration) {
        // Mirror the backend auto-advance rules.
        if (this.repeat === 'one') {
          this.positionSecs = 0;
          this.publish();
        } else if (this.queuePosition != null && this.queuePosition + 1 < this.queue.length) {
          this.queuePosition += 1;
          this.positionSecs = 0;
          this.publish();
        } else if (this.repeat === 'all' && this.queue.length > 0) {
          this.queuePosition = 0;
          this.positionSecs = 0;
          this.publish();
        } else {
          this.status = 'stopped';
          this.publish();
        }
      }
    }, 250);
  }

  // ----- PlayerApi -----

  async appInfo() {
    return { name: 'lumusic-mock', version: '0.1.0' };
  }

  async scanLibrary(root: string): Promise<ScanSummary> {
    const total = this.tracks.length;
    for (let i = 1; i <= total; i++) {
      this.scanProgressEvents.emit({ scanned: i, total });
    }
    const summary: ScanSummary = {
      root,
      filesSeen: total,
      added: total,
      updated: 0,
      removed: 0,
      skipped: 0,
      warnings: [],
    };
    this.libraryEvents.emit(summary);
    return summary;
  }

  async getTracks(query?: Partial<TrackQuery>): Promise<Track[]> {
    const terms = (query?.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const sort = query?.sort ?? 'title';
    const descending = query?.descending ?? false;
    const field = (t: Track) => (t[sort] as string | null) ?? '\uffff';
    return this.tracks
      .filter((t) => {
        const haystack = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => field(a).localeCompare(field(b)) * (descending ? -1 : 1));
  }

  async playerState() {
    return this.snapshot();
  }

  async playerLoad(ids: string[], startIndex?: number) {
    this.queue = ids
      .map((id) => this.tracks.find((t) => t.id === id))
      .filter((t): t is Track => Boolean(t));
    this.queuePosition = Math.min(startIndex ?? 0, Math.max(0, this.queue.length - 1));
    this.positionSecs = 0;
    this.status = 'playing';
    this.ensureTicker();
    this.publish();
    return this.snapshot();
  }

  async playerToggle() {
    if (this.status === 'playing') this.status = 'paused';
    else {
      this.status = 'playing';
      this.ensureTicker();
    }
    this.publish();
    return this.snapshot();
  }

  async playerPause() {
    this.status = 'paused';
    this.publish();
    return this.snapshot();
  }

  async playerResume() {
    this.status = 'playing';
    this.ensureTicker();
    this.publish();
    return this.snapshot();
  }

  async playerStop() {
    this.status = 'stopped';
    this.positionSecs = 0;
    this.publish();
    return this.snapshot();
  }

  private step(direction: 1 | -1) {
    if (this.queue.length === 0) return this.snapshot();
    if (this.queuePosition == null) this.queuePosition = 0;
    else if (this.repeat === 'all') {
      this.queuePosition = (this.queuePosition + direction + this.queue.length) % this.queue.length;
    } else {
      this.queuePosition = Math.min(
        this.queue.length - 1,
        Math.max(0, this.queuePosition + direction),
      );
    }
    this.positionSecs = 0;
    this.status = 'playing';
    this.ensureTicker();
    this.publish();
    return this.snapshot();
  }

  async playerNext() {
    return this.step(1);
  }

  async playerPrev() {
    return this.step(-1);
  }

  async playerSeek(secs: number) {
    const duration = this.snapshot().durationSecs;
    this.positionSecs = duration != null ? Math.min(Math.max(0, secs), duration) : Math.max(0, secs);
    this.publish();
    return this.snapshot();
  }

  async playerSetVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.publish();
    return this.snapshot();
  }

  async playerSetMode(shuffle?: boolean, repeat?: RepeatMode) {
    if (shuffle != null) this.shuffle = shuffle;
    if (repeat != null) this.repeat = repeat;
    this.publish();
    return this.snapshot();
  }

  async playlistList() {
    return this.playlists;
  }

  async playlistCreate(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.playlists.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`invalid or duplicate playlist name: ${name}`);
    }
    const playlist: Playlist = {
      id: `pl-${Date.now()}`,
      name: trimmed,
      items: [],
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.playlists.push(playlist);
    this.playlists.sort((a, b) => a.name.localeCompare(b.name));
    return playlist;
  }

  async playlistRename(id: string, newName: string) {
    const playlist = this.playlists.find((p) => p.id === id);
    if (!playlist) throw new Error('playlist not found');
    playlist.name = newName.trim();
  }

  async playlistDelete(id: string) {
    this.playlists = this.playlists.filter((p) => p.id !== id);
  }

  async playlistAddTrack(id: string, trackId: string) {
    const playlist = this.playlists.find((p) => p.id === id);
    if (!playlist) throw new Error('playlist not found');
    if (playlist.items.includes(trackId)) return false;
    playlist.items.push(trackId);
    return true;
  }

  async playlistRemoveTrack(id: string, trackId: string) {
    const playlist = this.playlists.find((p) => p.id === id);
    if (!playlist) throw new Error('playlist not found');
    playlist.items = playlist.items.filter((t) => t !== trackId);
  }

  async playlistMoveTrack(id: string, from: number, to: number) {
    const playlist = this.playlists.find((p) => p.id === id);
    if (!playlist) throw new Error('playlist not found');
    if (from < 0 || to < 0 || from >= playlist.items.length || to >= playlist.items.length) {
      throw new Error('position out of range');
    }
    const [moved] = playlist.items.splice(from, 1);
    playlist.items.splice(to, 0, moved);
  }

  async playlistGetTracks(id: string) {
    const playlist = this.playlists.find((p: Playlist) => p.id === id);
    if (!playlist) throw new Error('playlist not found');
    return playlist.items
      .map((t: string) => this.tracks.find((track: Track) => track.id === t))
      .filter((t): t is Track => Boolean(t));
  }

  async settingsGet() {
    return { volume: this.volume, lastFolder: 'C:/mock-music' };
  }

  onPlayerState(cb: (state: PlayerState) => void) {
    return this.stateEvents.on(cb);
  }

  onProgress(cb: (p: { positionSecs: number; durationSecs: number | null }) => void) {
    return this.progressEvents.on(cb);
  }

  onScanProgress(cb: (p: ScanProgress) => void) {
    return this.scanProgressEvents.on(cb);
  }

  onLibraryUpdated(cb: (s: ScanSummary) => void) {
    return this.libraryEvents.on(cb);
  }
}

export const mockApi = new MockApi();
