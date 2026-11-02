// Shared contracts and seed helpers for the lyrics-page art renderers.
// Every preset lives in its own module under art/ and registers itself
// in registry.ts — adding an effect means one new file plus one line
// there (the preset id itself lives in @/lib/artEffects, which drives
// the panel and persistence).

export interface FxColors {
  accent: string;
  accent2: string;
  dim: string;
}

export interface FxFrame {
  ctx: CanvasRenderingContext2D;
  /** CSS-pixel size (the context transform already accounts for DPR). */
  width: number;
  height: number;
  /** Seconds since the effect started. */
  time: number;
  /** Seconds since the previous frame, clamped for stability. */
  dt: number;
  /** Smoothed 0..1 music energy; small idle floor when nothing plays. */
  energy: number;
  /** Smoothed spectrum bars (0..1), decaying to zero while idle. */
  bars: readonly number[];
  colors: FxColors;
}

export interface FxRenderer<S> {
  create(width: number, height: number): S;
  draw(state: S, frame: FxFrame): void;
}

/** Deterministic RNG (mulberry32) — fixed seeds keep layouts reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Particle count scales with the canvas area, clamped for low-end GPUs. */
export function countFor(area: number, perArea: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, area / perArea)));
}

/** Deterministic per-index noise (twinkle/streaks stay synced per index). */
export function seededNoise(seed: number): number {
  const x = Math.sin(seed * 91.317 + 47.13) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Seeded mountain/ridge silhouette as y-fractions: a random walk clamped
 * to ±amp01 around base01. Shared by the village and sunset scenes.
 */
export function seededRidge(
  seed: number,
  samples: number,
  base01: number,
  amp01: number,
): number[] {
  const out: number[] = [];
  let y = base01;
  for (let i = 0; i < samples; i++) {
    y += (seededNoise(seed * 7.3 + i * 1.7) - 0.5) * amp01;
    y = Math.min(base01 + amp01, Math.max(base01 - amp01, y));
    out.push(y);
  }
  return out;
}
