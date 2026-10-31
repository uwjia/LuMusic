// Art effect state: panel visibility + the selected background preset.
// The choice persists to localStorage (pure-UI preference, mirrors the
// language store); nothing flows through the api seam because the effect
// is rendered entirely in the webview.

import { create } from 'zustand';
import {
  loadStoredArtEffect,
  persistArtEffect,
  type ArtEffectId,
} from '@/lib/artEffects';

interface ArtEffectStoreState {
  /** Whether the preset picker popover is shown (toggled from the player bar). */
  open: boolean;
  /** Currently selected background effect for the lyrics page. */
  effect: ArtEffectId;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Selects a preset and persists the choice. */
  setEffect: (effect: ArtEffectId) => void;
}

export const useArtEffectStore = create<ArtEffectStoreState>((set) => ({
  open: false,
  effect: loadStoredArtEffect(),

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),

  setEffect: (effect) => {
    set({ effect });
    persistArtEffect(effect);
  },
}));
