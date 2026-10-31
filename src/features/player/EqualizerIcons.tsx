// Equalizer icons. Paths are verbatim Lucide glyphs (lucide-static, ISC
// license), matching the ModeIcons/LyricsIcons stroke family.

import type { ReactNode } from 'react';

function Lucide({ children }: { children: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Equalizer toggle: the conventional vertical fader bank glyph. */
export function EqualizerIcon() {
  return (
    <Lucide>
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
    </Lucide>
  );
}
