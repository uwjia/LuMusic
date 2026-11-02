// Wave: expanding concentric ripples plus two mirrored waveform lines
// whose amplitude reads the spectrum bar under each x — the most
// directly music-reactive preset.

import { mulberry32, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface Ripple {
  radius: number;
  /** Expansion speed in px/s. */
  speed: number;
}

interface WaveState {
  ripples: Ripple[];
  /** Seconds until the next ripple spawns. */
  spawnIn: number;
  rand: () => number;
}

export const waveRenderer: FxRenderer<WaveState> = {
  create: (_width, _height) => ({
    ripples: [],
    spawnIn: 0,
    rand: mulberry32(0x3a7e),
  }),
  draw: (state, f) => {
    const { ctx, width: w, height: h, dt, time, energy, bars, colors } = f;
    const cx = w / 2;
    const cy = h * 0.45;
    const maxRadius = Math.hypot(w, h) / 2;

    // Ripples spawn faster the louder the track; silence still breathes.
    state.spawnIn -= dt;
    if (state.spawnIn <= 0) {
      state.ripples.push({ radius: 10, speed: 40 + state.rand() * 40 + energy * 120 });
      state.spawnIn = 0.9 - energy * 0.5;
    }
    ctx.lineWidth = 1.5;
    for (let i = state.ripples.length - 1; i >= 0; i--) {
      const ripple = state.ripples[i];
      ripple.radius += ripple.speed * dt;
      if (ripple.radius > maxRadius) {
        state.ripples.splice(i, 1);
        continue;
      }
      const fade = 1 - ripple.radius / maxRadius;
      ctx.globalAlpha = 0.05 + fade * 0.12;
      ctx.strokeStyle = colors.accent2;
      ctx.beginPath();
      ctx.arc(cx, cy, ripple.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Two mirrored waveform lines: amplitude reads the bar under each x.
    const bands = Math.max(bars.length, 1);
    for (const mirror of [-1, 1]) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const step = Math.max(6, w / 120);
      for (let x = 0; x <= w; x += step) {
        const bar = bars[Math.min(bars.length - 1, Math.floor((x / w) * bands))] ?? 0;
        const amp = 8 + bar * 90 + energy * 30;
        const y =
          cy +
          mirror * (18 + Math.sin((x / w) * Math.PI * 3 + time * 1.6) * amp * 0.35 + bar * amp * 0.5);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};
