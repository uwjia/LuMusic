// The winter-night backdrop of the reference demo's Koch stage (MyNo01
// KochSnowflake): a deep-navy radial night and 64 deterministic snow
// flakes. The central growing Koch snowflake is intentionally not ported —
// as an ambient background the page reads calmer with sky and snow alone.
// Like moonsea, the scene colors are the artwork itself and stay verbatim;
// the fall speed additionally follows the music energy.

import { seededNoise, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface SnowFlake {
  /** Horizontal base position as a fraction of width (0..1). */
  x01: number;
  /** Current fall offset as a fraction of height (0..1+8/h); mutated. */
  y01: number;
  /** Fall speed as a fraction of height per second. */
  speed01: number;
  radius: number;
  alpha: number;
}

interface SnowState {
  snow: SnowFlake[];
}

/** Snow field parameters — pure for unit tests. */
export function snowField(count = 64): SnowFlake[] {
  return Array.from({ length: count }, (_, i) => ({
    x01: seededNoise(i * 7.1 + 11),
    y01: seededNoise(i * 5.7 + 23),
    // Reference: 14–48 px/s on a 600px-tall stage.
    speed01: (14 + seededNoise(i * 3.3 + 5) * 34) / 600,
    radius: 0.8 + seededNoise(i * 9.4 + 7) * 1.5,
    alpha: 0.25 + 0.55 * seededNoise(i * 2.6 + 3),
  }));
}

export const snowRenderer: FxRenderer<SnowState> = {
  create: () => ({ snow: snowField() }),
  draw: (state, f) => {
    const { ctx, width: w, height: h, dt, time, energy } = f;

    /* ---------- winter night ---------- */
    const bg = ctx.createRadialGradient(
      w / 2,
      h * 0.42,
      0,
      w / 2,
      h * 0.42,
      Math.max(w, h) * 0.72,
    );
    bg.addColorStop(0, '#12233d');
    bg.addColorStop(1, '#070d18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* ---------- falling snow ---------- */
    // Position accumulates by dt instead of being derived from absolute
    // time: energy varies frame to frame, and with a `time * speed * boost`
    // formula every change would rewrite the whole fall history and
    // visibly drag flakes back up the page. Accumulating keeps the fall
    // strictly downward — energy only scales the rate. (dt 0 = frozen.)
    const fallBoost = 0.6 + energy * 0.8;
    // Reference wrap span: h + 8px, with flakes entering at y = -4.
    const span01 = 1 + 8 / h;
    ctx.fillStyle = '#e8f4ff';
    for (let i = 0; i < state.snow.length; i++) {
      const flake = state.snow[i];
      flake.y01 += flake.speed01 * fallBoost * dt;
      if (flake.y01 >= span01) flake.y01 -= span01;
      const x = flake.x01 * w + Math.sin(time * 0.7 + i) * w * 0.018;
      const y = flake.y01 * h - 4;
      ctx.globalAlpha = flake.alpha;
      ctx.beginPath();
      ctx.arc(x, y, flake.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};
