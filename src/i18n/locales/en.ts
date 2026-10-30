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
  'settings.library': 'Library',
  'settings.musicFolder': 'Music folder',
  'settings.browse': 'Browse…',
  'settings.scanFolder': 'Scan folder',
  'settings.scanning': 'Scanning…',
  'settings.lastScan':
    'Last scan of {root}: {filesSeen} files · {added} added · {updated} updated · {removed} removed · {skipped} skipped',
  'settings.about': 'About',
  'settings.aboutText':
    'Supported formats: MP3, FLAC, WAV, OGG. Settings and the library cache live in the app data directory.',
  'settings.language': 'Language',
  'settings.tray': 'Tray',
  'settings.closeToTray': 'Close to tray',
  'settings.closeToTrayHint':
    'Keep playing in the background when the window is closed. Restore it with the tray icon, or exit via Quit.',
} as const;

export type MessageKey = keyof typeof en;

/** Interpolation values: `{count}`-style placeholders in message templates. */
export type MessageParams = Record<string, string | number>;
