// Settings section icons. Paths are verbatim Lucide glyphs
// (lucide-static, ISC license), matching the player's ModeIcons family
// so every icon in the app shares the same stroke style and size.

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

export function LanguagesIcon() {
  return (
    <Lucide>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </Lucide>
  );
}

export function MusicIcon() {
  return (
    <Lucide>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </Lucide>
  );
}

export function MonitorIcon() {
  return (
    <Lucide>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </Lucide>
  );
}

export function InfoIcon() {
  return (
    <Lucide>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Lucide>
  );
}
