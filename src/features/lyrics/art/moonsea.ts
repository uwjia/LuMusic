// The moon-and-stars half of the reference demo's night scene (MyNo01
// FractalWave): a full-height night-sky gradient, 70 twinkling stars and
// a crescent moon with halo. Its sea/waves half is intentionally not
// ported. The palette is the artwork itself — a night scene cannot be
// derived from the UI design tokens — so the scene colors stay verbatim;
// only the twinkle pace additionally follows the music energy.

import { seededNoise, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface MoonStar {
  /** Position as a fraction of width/height (0..1). */
  x01: number;
  y01: number;
  /** Individual twinkle pace multiplier. */
  speed: number;
  /** Per-star phase offset so twinkles never sync up. */
  phase: number;
}

interface MoonseaState {
  stars: MoonStar[];
}

/** The star field as normalized positions — pure for unit tests. */
export function moonStars(count = 70): MoonStar[] {
  return Array.from({ length: count }, (_, i) => ({
    x01: seededNoise(i * 3.1 + 1),
    // Capped below 1 so stars never hug the very bottom edge.
    y01: seededNoise(i * 7.7 + 2) * 0.85,
    // 1.2..2.8 rad/s gives a gentle ~1.5-3.5s pulse: visible twinkling
    // without the frantic strobing of the first fix (1.5..5 rad/s).
    speed: 1.2 + seededNoise(i) * 1.6,
    phase: i,
  }));
}

export const moonseaRenderer: FxRenderer<MoonseaState> = {
  create: () => ({ stars: moonStars() }),
  draw: (state, f) => {
    const { ctx, width: w, height: h, time, energy } = f;

    /* ---------- night sky (no horizon: gradient spans the page) ---------- */
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a1430');
    sky.addColorStop(0.7, '#123253');
    sky.addColorStop(1, '#1c4a63');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Twinkle paces up a little once the music kicks in; brighter phases
    // also swell the dot so the pulse reads at pixel sizes.
    for (const star of state.stars) {
      const tw =
        0.25 + 0.75 * Math.abs(Math.sin(time * star.speed * (0.75 + energy * 0.5) + star.phase));
      const size = 0.9 + tw * 1.3;
      ctx.globalAlpha = tw * 0.85;
      ctx.fillStyle = '#dceaff';
      ctx.fillRect(star.x01 * w, star.y01 * h, size, size);
    }
    ctx.globalAlpha = 1;

    /* ---------- crescent moon + halo ---------- */
    const mx = w * 0.76;
    const my = h * 0.14; // same upper-right placement as the reference
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 95);
    glow.addColorStop(0, 'rgba(255, 244, 214, 0.85)');
    glow.addColorStop(0.22, 'rgba(255, 244, 214, 0.22)');
    glow.addColorStop(1, 'rgba(255, 244, 214, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 95, my - 95, 190, 190);
    ctx.fillStyle = '#fdf3d7';
    ctx.beginPath();
    ctx.arc(mx, my, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10264a';
    ctx.beginPath();
    ctx.arc(mx + 10, my - 7, 21, 0, Math.PI * 2);
    ctx.fill();
  },
};
