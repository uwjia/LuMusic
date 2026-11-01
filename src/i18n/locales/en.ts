// English messages - the source of truth for the message catalogue.
// Keys are flat and dotted ('section.name') so they are greppable and
// type-checkable; zh-CN.ts must define the exact same key set (enforced by
// the `Record<MessageKey, string>` type).

export const en = {
  // sidebar navigation
  'nav.navigation': 'Navigation',
  'nav.library': 'Library',
  'nav.playlists': 'Playlists',
  'nav.newPlaylist': '＋ New playlist',
  'nav.newPlaylistName': 'New playlist name',
  'nav.add': 'Add',
  'nav.settings': 'Settings',

  // title bar window controls
  'titlebar.minimize': 'Minimize',
  'titlebar.maximize': 'Maximize',
  'titlebar.restore': 'Restore',
  'titlebar.close': 'Close',

  // system tray menu (labels are pushed to the backend's native menu)
  'tray.show': 'Show LuMusic',
  'tray.quit': 'Quit',

  // library page
  'library.searchPlaceholder': 'Search title, artist, album…',
  'library.searchLabel': 'Search tracks',
  'library.trackCount': '{count} tracks',
  'library.trackCountOne': '{count} track',
  'library.loadingSuffix': ' · loading…',
  'library.manage': 'Manage library',
  'library.scanning': 'Scanning… {scanned}/{total}',
  'library.noMatches': 'No matches',
  'library.noMatchesHint': 'Try different search terms.',
  'library.empty': 'Your library is empty',
  'library.emptyHint': 'Pick a music folder in Settings and scan it.',
  'library.refresh': 'Refresh',

  // track table
  'table.tracks': 'Tracks',
  'table.index': '#',
  'table.title': 'Title',
  'table.artist': 'Artist',
  'table.album': 'Album',
  'table.duration': 'Time',
  'table.playing': 'playing',
  'table.emptyTitle': 'No tracks yet',
  'table.emptyHint': 'Scan a music folder to fill your library.',

  // player bar
  'player.loading': 'Loading player…',
  'player.unknownArtist': 'Unknown artist',
  'player.nothingPlaying': 'Nothing playing',
  'player.shuffle': 'Shuffle',
  'player.prev': 'Previous track',
  'player.play': 'Play',
  'player.pause': 'Pause',
  'player.next': 'Next track',
  'player.modeSequential': 'Sequential play',
  'player.repeatAll': 'Repeat all',
  'player.repeatOne': 'Repeat one',
  'player.seek': 'Seek',
  'player.volume': 'Volume',
  'player.showLyrics': 'Show lyrics',
  'player.hideLyrics': 'Hide lyrics',
  'player.showEqualizer': 'Show equalizer',
  'player.hideEqualizer': 'Hide equalizer',
  'player.showSpectrum': 'Show spectrum',
  'player.hideSpectrum': 'Hide spectrum',
  'player.showArtEffects': 'Show art effects',
  'player.hideArtEffects': 'Hide art effects',

  // spectrum panel
  'spectrum.title': 'Spectrum',
  'spectrum.canvasLabel': 'Live frequency spectrum',

  // art effects panel (lyrics-page background presets)
  'fx.title': 'Art effects',
  'fx.hint': 'Renders behind the lyrics page.',
  'fx.off': 'Off',
  'fx.aurora': 'Aurora',
  'fx.starfield': 'Starfield',
  'fx.bubbles': 'Bubbles',
  'fx.particles': 'Particles',
  'fx.wave': 'Waves',
  'fx.moonsea': 'Moon & Stars',
  'fx.snow': 'Snowfall',
  'fx.canvasLabel': 'Artistic background effect',

  // equalizer panel
  'eq.title': 'Equalizer',
  'eq.enable': 'Enable',
  'eq.preset': 'Preset',
  'eq.preset.custom': 'Custom',
  'eq.preset.flat': 'Flat',
  'eq.preset.rock': 'Rock',
  'eq.preset.pop': 'Pop',
  'eq.preset.jazz': 'Jazz',
  'eq.preset.classical': 'Classical',
  'eq.preset.electronic': 'Electronic',
  'eq.preset.bassBoost': 'Bass Boost',
  'eq.preset.trebleBoost': 'Treble Boost',
  'eq.reset': 'Reset',
  'eq.preamp': 'Preamp (dB)',
  'eq.preampShort': 'Pre',
  'eq.band': '{freq} Hz gain',

  // lyrics page
  'lyrics.title': 'Lyrics',
  'lyrics.close': 'Close lyrics',
  'lyrics.loading': 'Loading lyrics…',
  'lyrics.nothingPlaying': 'Nothing playing',
  'lyrics.nothingPlayingHint': 'Start a track to see its lyrics.',
  'lyrics.noLyrics': 'No lyrics found',
  'lyrics.noLyricsHint':
    'Place a .lrc file with the same name as the song in the same folder, then reopen the lyrics page.',
  'lyrics.seekTo': 'Jump to {time}',

  // playlist page
  // Fixed auto playlists keep their canonical backend names ("All Tracks" /
  // "Default" from domain/scan.rs); these keys localize them for display.
  'playlist.allTracks': 'All Tracks',
  'playlist.defaultPlaylist': 'Default',
  'playlist.notFound': 'Playlist not found',
  'playlist.trackCount': '{count} tracks',
  'playlist.trackCountOne': '{count} track',
  'playlist.nameLabel': 'Playlist name',
  'playlist.save': 'Save',
  'playlist.actions': 'Playlist actions',
  'playlist.rename': 'Rename',
  'playlist.duplicate': 'Duplicate',
  'playlist.delete': 'Delete playlist',
  'playlist.empty': 'This playlist is empty',
  'playlist.emptyHint': 'Add tracks from the library using the ＋ button on each row.',
  'playlist.removeTrack': 'Remove {title} from playlist',
  'playlist.copyName': '{name} (copy)',
  'playlist.copyNameN': '{name} (copy) {n}',

  // settings page
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageHint': 'Interface language — applies immediately.',
  'settings.library': 'Library',
  'settings.libraryHint': 'Choose the folder your music lives in, then scan it.',
  'settings.musicFolder': 'Music folder',
  'settings.browse': 'Browse…',
  'settings.scanFolder': 'Scan folder',
  'settings.scanning': 'Scanning…',
  'settings.lastScanRoot': 'Last scanned: {root}',
  'settings.scanFiles': '{count} files',
  'settings.scanFilesOne': '{count} file',
  'settings.scanAdded': '{count} added',
  'settings.scanAddedOne': '{count} added',
  'settings.scanUpdated': '{count} updated',
  'settings.scanUpdatedOne': '{count} updated',
  'settings.scanRemoved': '{count} removed',
  'settings.scanRemovedOne': '{count} removed',
  'settings.scanSkipped': '{count} skipped',
  'settings.scanSkippedOne': '{count} skipped',
  'settings.tray': 'Tray',
  'settings.closeToTray': 'Close to tray',
  'settings.closeToTrayHint':
    'Keep playing in the background when the window is closed. Restore it with the tray icon, or exit via Quit.',
  'settings.about': 'About',
  'settings.aboutText':
    'Supported formats: MP3, FLAC, WAV, OGG. Settings and the library cache live in the app data directory.',
} as const;

export type MessageKey = keyof typeof en;

/** Interpolation values: `{count}`-style placeholders in message templates. */
export type MessageParams = Record<string, string | number>;
