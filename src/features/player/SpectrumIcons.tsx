// Spectrum icons. Paths are verbatim Lucide glyphs (lucide-static, ISC
// license), matching the ModeIcons/LyricsIcons/EqualizerIcons family.

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
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Spectrum toggle: the conventional audio-lines glyph. */
export function SpectrumIcon() {
  return (
    <Lucide>
      <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
    </Lucide>
  );
}
