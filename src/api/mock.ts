// In-memory PlayerApi used by tests and `npm run dev:mock`.
//
// It mirrors the backend's observable behavior:
// - search: every whitespace-separated term must match (AND);
// - playback auto-advance follows repeat/shuffle rules;
// - events fire through the same subscription callbacks.

import type { PlayerApi, Unsubscribe } from '@/api/types';
import type {
  EqSettings,
  Lyrics,
  PlayerState,
  Playlist,
  RepeatMode,
  ScanProgress,
  ScanSummary,
  Settings,
  SpectrumFrame,
  Track,
  TrackQuery,
  TrayLabels,
} from '@/types/track';
import { SPECTRUM_BARS } from '@/types/track';

const TRACKS_ROOT = 'C:/mock-music';

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
  folder = '',
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
  filePath: `${TRACKS_ROOT}/${folder ? `${folder}/` : ''}${title}.mp3`,
  sizeBytes: Math.round(durationSecs * 1000),
});

const SAMPLE_TRACKS: Track[] = [
  // Files directly in the scan root -> "Default" playlist.
  makeTrack('t1', 'Alpha Waves', 'Nova Fields', 'Aurora', 184),
  makeTrack('t2', 'Blue Horizon', 'Nova Fields', 'Aurora', 205),
  // Files inside a first-level folder -> one playlist per folder.
  makeTrack('t3', 'Crimson Sky', 'The Ember Set', 'Dusk', 167, 'The Ember Set'),
  makeTrack('t4', 'Drift', 'The Ember Set', 'Dusk', 232, 'The Ember Set'),
  makeTrack('t5', 'Echo Lake', 'Nova Fields', 'Aurora', 198, 'Nova Fields'),
];

// Parsed form of a fictional `Alpha Waves.lrc` next to the mock track —
// mirrors what the backend returns for a real sibling .lrc file (lines
// sorted, offset applied, empty-text interludes kept).
const SAMPLE_LYRICS: Lyrics = {
  sourcePath: `${TRACKS_ROOT}/Alpha Waves.lrc`,
  lines: [
    { timeMs: 0, text: 'Nova Fields - Alpha Waves' },
    { timeMs: 4_000, text: 'Ride the alpha waves tonight' },
    { timeMs: 8_000, text: 'Colors bloom behind your eyes' },
    { timeMs: 12_500, text: '' },
    { timeMs: 13_000, text: 'Slow down, let the evening in' },
    { timeMs: 17_000, text: 'Ride the alpha waves again' },
  ],
};

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
  private spectrumEvents = emitter<SpectrumFrame>();

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Monotonic playlist id suffix (Date.now() can collide under fake timers). */
  private playlistSeq = 0;
  /** Smoothed synthetic spectrum state (dev:mock visualization only). */
  private spectrumState: SpectrumFrame = Array(SPECTRUM_BARS).fill(0);
  private closeToTray = true;
  /** Mirrors the persisted backend EQ (disabled/flat by default). */
  private eq: EqSettings = { enabled: false, preampDb: 0, gainsDb: Array(10).fill(0) };
  private trayLabels: TrayLabels | null = null;
  /** Only t1 "ships" with a sibling .lrc file. */
  private lyrics = new Map<string, Lyrics>([['t1', SAMPLE_LYRICS]]);

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
      // Mirror the backend: frames only flow while playing. The mock
      // synthesizes a decaying, low-biased curve so dev:mock shows motion.
      this.spectrumState = this.spectrumState.map((value, bar) => {
        const target =
          Math.max(0.06, 0.85 - bar * 0.032) * (0.5 + 0.5 * Math.random());
        return value * 0.45 + target * 0.55;
      });
      this.spectrumEvents.emit([...this.spectrumState]);
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

    // Mirror the backend auto-playlist rules: one playlist per first-level
    // folder, root files go to Default, everything to All Tracks.
    const rootPrefix = `${root.replace(/[\\/]+$/, '')}/`;
    const folders = new Map<string, string[]>();
    const rootFiles: string[] = [];
    const all: string[] = [];
    for (const track of this.tracks) {
      all.push(track.id);
      const relative = track.filePath.startsWith(rootPrefix)
        ? track.filePath.slice(rootPrefix.length)
        : null;
      const slash = relative?.indexOf('/');
      if (relative != null && slash != null && slash >= 0) {
        const folder = relative.slice(0, slash);
        folders.set(folder, [...(folders.get(folder) ?? []), track.id]);
      } else {
        rootFiles.push(track.id);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const autoSpecs: Playlist[] = [
      { id: 'auto:all', name: 'All Tracks', items: all, createdAt: now, autoGenerated: true },
    ];
    if (rootFiles.length > 0) {
      autoSpecs.push({ id: 'auto:root', name: 'Default', items: rootFiles, createdAt: now, autoGenerated: true });
    }
    for (const [name, items] of folders) {
      autoSpecs.push({ id: `auto:dir:${name}`, name, items, createdAt: now, autoGenerated: true });
    }

    // Mirror the backend overwrite semantics: a playlist (manual or auto)
    // with the same name is the target and gets its items overwritten;
    // repeated scans never multiply playlists.
    const used = new Set<string>();
    const creations: Playlist[] = [];
    for (const spec of autoSpecs) {
      const existing = this.playlists.find(
        (p) => !used.has(p.id) && p.name.toLowerCase() === spec.name.toLowerCase(),
      );
      if (existing) {
        used.add(existing.id);
        existing.items = spec.items;
        existing.autoGenerated = true;
      } else {
        used.add(spec.id);
        creations.push(spec);
      }
    }
    this.playlists = [
      ...this.playlists.filter((p) => !p.autoGenerated || used.has(p.id)),
      ...creations,
    ];
    this.playlists.sort((a, b) => a.id.localeCompare(b.id));

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
      // Monotonic suffix keeps ids unique even when fake timers freeze
      // Date.now() within one millisecond (duplicate ids made lookups
      // resolve to the wrong playlist).
      id: `pl-${Date.now()}-${++this.playlistSeq}`,
      name: trimmed,
      items: [],
      createdAt: Math.floor(Date.now() / 1000),
      autoGenerated: false,
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

  async settingsGet(): Promise<Settings> {
    return {
      volume: this.volume,
      lastFolder: TRACKS_ROOT,
      closeToTray: this.closeToTray,
      eq: { ...this.eq, gainsDb: [...this.eq.gainsDb] },
    };
  }

  async settingsSet(patch: { closeToTray?: boolean; eq?: EqSettings }): Promise<Settings> {
    // Mirrors the backend: only provided fields change, the rest persists.
    if (patch.closeToTray != null) this.closeToTray = patch.closeToTray;
    if (patch.eq != null) {
      // Mirrors backend sanitization: clamp + pad/truncate to 10 bands.
      const gains = patch.eq.gainsDb.slice(0, 10);
      while (gains.length < 10) gains.push(0);
      this.eq = {
        enabled: patch.eq.enabled,
        preampDb: Math.min(12, Math.max(-12, patch.eq.preampDb || 0)),
        gainsDb: gains.map((g) => Math.min(12, Math.max(-12, g || 0))),
      };
    }
    return this.settingsGet();
  }

  async traySetLabels(labels: TrayLabels): Promise<void> {
    // The mock has no OS tray; recording keeps the seam observable in tests.
    this.trayLabels = labels;
  }

  async lyricsGet(trackId: string): Promise<Lyrics | null> {
    // Mirrors the backend: only tracks with a sibling .lrc have lyrics.
    return this.lyrics.get(trackId) ?? null;
  }

  /** Last labels pushed by the UI (test/dev seam, not part of PlayerApi). */
  get lastTrayLabels(): TrayLabels | null {
    return this.trayLabels;
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

  onSpectrum(cb: (frame: SpectrumFrame) => void) {
    return this.spectrumEvents.on(cb);
  }
}

export const mockApi = new MockApi();
