// Aurora: layered sine bands drifting horizontally. Colors come from the
// design tokens (unlike the painted scenes); energy only lifts amplitude.

import { mulberry32, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface AuroraBand {
  /** Vertical center of the band as a fraction of height (0..1). */
  yRatio: number;
  phase: number;
  speed: number;
  /** Amplitude and thickness as fractions of height. */
  ampRatio: number;
  thickRatio: number;
  alpha: number;
  /** Horizontal wave frequency multiplier. */
  waves: number;
}

interface AuroraState {
  bands: AuroraBand[];
}

/** Pure band centerline math — exported for unit tests. */
export function auroraY(
  band: AuroraBand,
  x: number,
  width: number,
  time: number,
  energy: number,
): number {
  return (
    band.yRatio +
    Math.sin((x / width) * Math.PI * 2 * band.waves + time * band.speed + band.phase) *
      band.ampRatio *
      (0.6 + energy)
  );
}

export const auroraRenderer: FxRenderer<AuroraState> = {
  create: (_width, _height) => {
    // Amplitudes/thicknesses are height ratios so a mid-session resize
    // keeps the composition instead of clamping to stale pixels.
    const rand = mulberry32(0x4155);
    return {
      bands: Array.from({ length: 4 }, (_, i) => ({
        yRatio: Math.min(0.85, 0.25 + i * 0.18 + (rand() - 0.5) * 0.06),
        phase: rand() * Math.PI * 2,
        speed: 0.25 + rand() * 0.35,
        ampRatio: 0.04 + rand() * 0.05,
        thickRatio: 0.1 + rand() * 0.08,
        alpha: 0.05 + rand() * 0.05,
        waves: 1 + Math.floor(rand() * 2),
      })),
    };
  },
  draw: (state, f) => {
    const { ctx, width: w, height: h, time, energy, colors } = f;
    const step = Math.max(8, w / 90);
    for (const band of state.bands) {
      ctx.globalAlpha = Math.min(0.22, band.alpha + energy * 0.08);
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, colors.accent);
      gradient.addColorStop(1, colors.accent2);
      ctx.fillStyle = gradient;

      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        const y = auroraY(band, x, w, time, energy) * h;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const thick = band.thickRatio * h;
      for (let x = w; x >= 0; x -= step) {
        ctx.lineTo(x, auroraY(band, x, w, time, energy) * h + thick);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};
