// Bubbles: translucent circles rising with a sine sway and a highlight
// dot that sells the glass look. Token colors; energy sets the ascent.

import { countFor, mulberry32, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface Bubble {
  x: number;
  y: number;
  radius: number;
  /** Ascent speed in px/s at energy 1. */
  speed: number;
  phase: number;
  alpha: number;
}

interface BubblesState {
  bubbles: Bubble[];
  rand: () => number;
}

export const bubblesRenderer: FxRenderer<BubblesState> = {
  create: (width, height) => {
    const rand = mulberry32(0xb0b5);
    return {
      rand,
      bubbles: Array.from({ length: countFor(width * height, 22_000, 14, 48) }, () => ({
        x: rand() * width,
        y: rand() * height,
        radius: 4 + rand() * 18,
        speed: 14 + rand() * 26,
        phase: rand() * Math.PI * 2,
        alpha: 0.04 + rand() * 0.08,
      })),
    };
  },
  draw: (state, f) => {
    const { ctx, width: w, height: h, dt, time, energy, colors } = f;
    for (const bubble of state.bubbles) {
      bubble.y -= bubble.speed * (0.4 + energy) * dt;
      const sway = Math.sin(time * 0.8 + bubble.phase) * 18;
      if (bubble.y < -bubble.radius) {
        bubble.y = h + bubble.radius;
        bubble.x = state.rand() * w;
      }
      const x = bubble.x + sway;
      ctx.globalAlpha = bubble.alpha + energy * 0.05;
      ctx.strokeStyle = colors.accent2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, bubble.y, bubble.radius, 0, Math.PI * 2);
      ctx.stroke();
      // Highlight arc sells the "glass sphere" look cheaply.
      ctx.globalAlpha = (bubble.alpha + energy * 0.05) * 1.4;
      ctx.beginPath();
      ctx.arc(
        x - bubble.radius * 0.3,
        bubble.y - bubble.radius * 0.3,
        bubble.radius * 0.35,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = colors.accent;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};
