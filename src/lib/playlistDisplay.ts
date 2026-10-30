// Display-name mapping for the fixed auto playlists.
//
// The backend persists canonical English names ("All Tracks" / "Default"
// from `domain/scan.rs`) because they double as the same-name-overwrite key
// for rescans. Localizing the stored name would orphan those playlists on
// a language switch. Instead the UI translates at render time, keyed on the
// stable auto-playlist ids (`auto:all`, `auto:root`); everything else —
// manual playlists and folder-derived autos (`auto:dir:<name>`) — is real
// user data and must be shown verbatim.

import type { MessageKey, Translate } from '@/i18n';
import type { Playlist } from '@/types/track';

const AUTO_PLAYLIST_LABEL: Record<string, MessageKey> = {
  'auto:all': 'playlist.allTracks',
  'auto:root': 'playlist.defaultPlaylist',
};

/** Localized name for the fixed auto playlists; the stored name otherwise. */
export function displayPlaylistName(playlist: Pick<Playlist, 'id' | 'name'>, t: Translate): string {
  const key = AUTO_PLAYLIST_LABEL[playlist.id];
  return key ? t(key) : playlist.name;
}
