// Play-mode icon family. Paths are the official Lucide glyphs
// (lucide-static v1.65.0, ISC license): repeat / repeat-1 / shuffle and
// arrow-right-to-line for sequential ("play through, stop at the end").
// Keep the paths verbatim — hand-tweaked variants looked off at 16px.

import type { ReactNode } from 'react';
import type { PlayMode } from '@/stores/playerStore';

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

/** Sequential play: arrow running into the end bar — plays through, stops. */
export function SequentialIcon() {
  return (
    <Lucide>
      <path d="M17 12H3" />
      <path d="m11 18 6-6-6-6" />
      <path d="M21 5v14" />
    </Lucide>
  );
}

export function RepeatAllIcon() {
  return (
    <Lucide>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Lucide>
  );
}

export function RepeatOneIcon() {
  return (
    <Lucide>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      <path d="M11 10h1v4" />
    </Lucide>
  );
}

export function ShuffleIcon() {
  return (
    <Lucide>
      <path d="m18 14 4 4-4 4" />
      <path d="m18 2 4 4-4 4" />
      <path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22" />
      <path d="M2 6h1.972a4 4 0 0 1 3.6 2.2" />
      <path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45" />
    </Lucide>
  );
}

export const MODE_ICON: Record<PlayMode, ReactNode> = {
  sequential: <SequentialIcon />,
  repeatAll: <RepeatAllIcon />,
  repeatOne: <RepeatOneIcon />,
  shuffle: <ShuffleIcon />,
};
