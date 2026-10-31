// Spectrum state: panel visibility + the latest frame pushed by the
// backend (mock) event. Frames are transient — nothing is persisted.

import { create } from 'zustand';
import type { SpectrumFrame } from '@/types/track';
import { SPECTRUM_BARS } from '@/types/track';

export const SILENT_FRAME: SpectrumFrame = Array<number>(SPECTRUM_BARS).fill(0);

interface SpectrumStoreState {
  /** Whether the panel is shown (toggled from the player bar). */
  open: boolean;
  /** Latest backend frame; silent (all-zero) until frames arrive. */
  frame: SpectrumFrame;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  applyFrame: (frame: SpectrumFrame) => void;
}

export const useSpectrumStore = create<SpectrumStoreState>((set) => ({
  open: false,
  frame: [...SILENT_FRAME],

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),

  applyFrame: (frame) => set({ frame: frame.slice(0, SPECTRUM_BARS) }),
}));
