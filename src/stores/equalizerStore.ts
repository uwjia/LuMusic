// Equalizer state: panel visibility + the EQ settings, applied through the
// api seam (mockable). Updates are optimistic so sliders feel instant; a
// failed call reverts to the last accepted curve.

import { create } from 'zustand';
import { api } from '@/api';
import type { EqSettings } from '@/types/track';
import { normalizeGains } from '@/lib/equalizer';

export const DEFAULT_EQ: EqSettings = {
  enabled: false,
  preampDb: 0,
  gainsDb: normalizeGains([]),
};

interface EqualizerStoreState {
  /** Whether the panel is shown (toggled from the player bar). */
  open: boolean;
  eq: EqSettings;
  /** True once settingsGet resolved (panel waits for real values). */
  loaded: boolean;
  error: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** One-time read (component effect); panel is display-only until done. */
  load: () => Promise<void>;
  /** Optimistically applies a patch through the backend and reverts on error. */
  apply: (patch: Partial<EqSettings>) => Promise<void>;
}

export const useEqualizerStore = create<EqualizerStoreState>((set, get) => ({
  open: false,
  eq: DEFAULT_EQ,
  loaded: false,
  error: null,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),

  load: async () => {
    try {
      const settings = await api.settingsGet();
      set({ eq: settings.eq, loaded: true, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  apply: async (patch) => {
    const previous = get().eq;
    const next: EqSettings = {
      ...previous,
      ...patch,
      gainsDb: normalizeGains(patch.gainsDb ?? previous.gainsDb),
    };
    set({ eq: next, error: null });
    try {
      const settings = await api.settingsSet({ eq: next });
      set({ eq: settings.eq });
    } catch (err) {
      // Revert so the UI never shows a curve the backend rejected.
      set({ eq: previous, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
