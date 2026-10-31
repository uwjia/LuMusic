// Volume icons. Paths are verbatim Lucide glyphs (lucide-static, ISC
// license), matching the ModeIcons/EqualizerIcons stroke family. Three
// states so the speaker button doubles as a level indicator.

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

const Speaker = () => <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />;

/** Volume off: speaker + cross. */
export function VolumeMuteIcon() {
  return (
    <Lucide>
      <Speaker />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </Lucide>
  );
}

/** Low volume: speaker + one arc. */
export function VolumeLowIcon() {
  return (
    <Lucide>
      <Speaker />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Lucide>
  );
}

/** High volume: speaker + two arcs. */
export function VolumeHighIcon() {
  return (
    <Lucide>
      <Speaker />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Lucide>
  );
}
