// Renderer registry: every non-off preset's renderer in one place.
// Adding an effect = one module under art/ + one line here + one id in
// @/lib/artEffects (which also drives the panel and persistence).

import type { ArtEffectId } from '@/lib/artEffects';
import type { FxRenderer } from '@/features/lyrics/art/fxTypes';
import { auroraRenderer } from '@/features/lyrics/art/aurora';
import { starfieldRenderer } from '@/features/lyrics/art/starfield';
import { bubblesRenderer } from '@/features/lyrics/art/bubbles';
import { waveRenderer } from '@/features/lyrics/art/wave';
import { moonseaRenderer } from '@/features/lyrics/art/moonsea';
import { snowRenderer } from '@/features/lyrics/art/snow';
import { villageRenderer } from '@/features/lyrics/art/village';
import { sunsetRenderer } from '@/features/lyrics/art/sunset';

export type ActiveArtEffectId = Exclude<ArtEffectId, 'off'>;

/** Renderers per non-off preset; keyed by the same ids as @/lib/artEffects. */
export const ART_RENDERERS: Record<ActiveArtEffectId, FxRenderer<unknown>> = {
  aurora: auroraRenderer,
  starfield: starfieldRenderer,
  bubbles: bubblesRenderer,
  wave: waveRenderer,
  moonsea: moonseaRenderer,
  snow: snowRenderer,
  village: villageRenderer,
  sunset: sunsetRenderer,
};
