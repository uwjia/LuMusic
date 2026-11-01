// Art effect registry for the lyrics-page background: preset ids, the
// i18n label mapping and localStorage persistence. Pure logic — the
// drawing itself lives in features/lyrics/artRenderers.
//
// The choice is a pure-UI visual preference, so it persists next to the
// language key in localStorage instead of the backend settings file
// (nothing here needs to survive into Rust).

import type { MessageKey } from '@/i18n';

export type ArtEffectId =
  | 'off'
  | 'aurora'
  | 'starfield'
  | 'bubbles'
  | 'particles'
  | 'wave'
  | 'moonsea';

/** Presets in display order; `off` first is the default/no-effect state. */
export const ART_EFFECTS: readonly ArtEffectId[] = [
  'off',
  'aurora',
  'starfield',
  'bubbles',
  'particles',
  'wave',
  'moonsea',
];

export const DEFAULT_ART_EFFECT: ArtEffectId = 'off';

/** Catalogue key per preset (drives both the panel buttons and a11y). */
export const ART_EFFECT_LABEL_KEY: Record<ArtEffectId, MessageKey> = {
  off: 'fx.off',
  aurora: 'fx.aurora',
  starfield: 'fx.starfield',
  bubbles: 'fx.bubbles',
  particles: 'fx.particles',
  wave: 'fx.wave',
  moonsea: 'fx.moonsea',
};

export const ART_EFFECT_STORAGE_KEY = 'lumusic.artEffect';

export function isArtEffectId(value: unknown): value is ArtEffectId {
  return typeof value === 'string' && (ART_EFFECTS as readonly string[]).includes(value);
}

/** Falls back to `off` for anything unknown — a corrupt/legacy stored
 * value must never reach the renderer switch. */
export function sanitizeArtEffect(value: unknown): ArtEffectId {
  return isArtEffectId(value) ? value : DEFAULT_ART_EFFECT;
}

export function loadStoredArtEffect(): ArtEffectId {
  try {
    return sanitizeArtEffect(localStorage.getItem(ART_EFFECT_STORAGE_KEY));
  } catch {
    // Storage can be unavailable (privacy mode / disabled webview storage).
    return DEFAULT_ART_EFFECT;
  }
}

export function persistArtEffect(effect: ArtEffectId): void {
  try {
    localStorage.setItem(ART_EFFECT_STORAGE_KEY, effect);
  } catch {
    // Persistence is best-effort; the in-memory selection still applies.
  }
}
