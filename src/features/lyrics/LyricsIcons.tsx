// Lyrics page icons. Paths are verbatim Lucide glyphs (lucide-static,
// ISC license), matching the ModeIcons/SettingsIcons stroke family so all
// app icons share the same 17px 2px-stroke look.

import type { ReactNode } from 'react';

function Lucide({ size = 17, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
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

/** Lyrics toggle: a subtitle/caption frame — the conventional "lyrics" glyph.
 * Used both by the player-bar entry and the lyrics page's close button so
 * the feature has a single visual identity. */
export function LyricsIcon() {
  return (
    <Lucide>
      <rect width="18" height="14" x="3" y="5" rx="2" ry="2" />
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
    </Lucide>
  );
}

/** Small file glyph for the .lrc source chip in the lyrics header. */
export function SourceFileIcon() {
  return (
    <Lucide size={12}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Lucide>
  );
}
