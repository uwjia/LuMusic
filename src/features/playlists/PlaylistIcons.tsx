// Playlist row icons. Paths are verbatim Lucide glyphs
// (lucide-static, ISC license), extending the app-wide stroke family
// (SettingsIcons, ModeIcons, ...). Default size is 1em so a row glyph
// always matches its 14px label, like the sidebar nav buttons.

import type { ReactNode } from 'react';
import type { Playlist } from '@/types/track';

function Lucide({ children }: { children: ReactNode }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** "All Tracks" — the whole library as one vinyl record (lucide `disc`).
 *  A disc reads instantly at 1em, where the shelf glyph's four strokes
 *  turned to noise, and stays distinct from the EQ/spectrum bar looks. */
export function DiscIcon() {
  return (
    <Lucide>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2" />
    </Lucide>
  );
}

/** Every playlist except All Tracks — folder autos, the root "Default"
 *  list and manual playlists alike (lucide `list-music`): they are all
 *  "a list of tracks" to the user, regardless of how they were born. */
export function ListMusicIcon() {
  return (
    <Lucide>
      <path d="M21 15V6" />
      <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M12 12H3" />
      <path d="M16 6H3" />
      <path d="M12 18H3" />
    </Lucide>
  );
}

/** Row indicator while the queue plays from this playlist: the original
 *  colored speaker emoji (rendered by the Sidebar, not this stroke family
 *  — its color is the attention cue). */
export const PLAYING_GLYPH = '🔊 ';

export type PlaylistRowIcon = () => ReactNode;

/**
 * Picks a row's type icon: `auto:all` gets its dedicated disc (the whole
 * collection, not just another list); every other playlist — folder
 * autos, Default, manual — shares the generic list-with-note.
 */
export function playlistRowIcon(playlist: Pick<Playlist, 'id'>): PlaylistRowIcon {
  if (playlist.id === 'auto:all') return DiscIcon;
  return ListMusicIcon;
}
