// Starfield: perspective stars flying toward the viewer, with speed
// streaks on the near pass. Token colors; energy sets the fly speed.

import { countFor, mulberry32, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface Star {
  x: number;
  y: number;
  /** Depth 1 (far) -> 0 (at the viewer). */
  z: number;
}

interface StarfieldState {
  stars: Star[];
  rand: () => number;
}

const STAR_NEAR_Z = 0.04;

export const starfieldRenderer: FxRenderer<StarfieldState> = {
  create: (width, height) => {
    const rand = mulberry32(0x57a25);
    return {
      rand,
      stars: Array.from(
        { length: countFor(width * height, 9_000, 40, 160) },
        () => ({ x: rand() * width, y: rand() * height, z: 0.15 + rand() * 0.85 }),
      ),
    };
  },
  draw: (state, f) => {
    const { ctx, width: w, height: h, dt, time, energy, colors } = f;
    const cx = w / 2;
    const cy = h * 0.42; // slightly above center reads better behind lyrics
    const speed = 0.1 + energy * 0.45;
    ctx.lineCap = 'round';
    for (const star of state.stars) {
      const before = star.z;
      star.z -= dt * speed;
      if (star.z <= STAR_NEAR_Z) {
        // Recycle at the far plane with a fresh position (seeded rng keeps
        // the sequence reproducible across tests).
        star.z = 1;
        star.x = state.rand() * w;
        star.y = state.rand() * h;
      }
      const px = cx + ((star.x - cx) / star.z) * 0.5;
      const py = cy + ((star.y - cy) / star.z) * 0.5;
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
      const depth = 1 - star.z;
      const size = 0.4 + depth * 2.2;
      const twinkle = 0.55 + 0.45 * Math.sin(time * 2 + star.x);
      ctx.globalAlpha = Math.min(1, (0.2 + depth * 0.8) * twinkle);
      ctx.fillStyle = depth > 0.5 ? colors.accent2 : colors.accent;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
      // Speed streak: longer the closer the star sweeps past.
      if (before - star.z > 0 && depth > 0.55) {
        const qx = cx + ((star.x - cx) / (star.z + (before - star.z) * 6)) * 0.5;
        const qy = cy + ((star.y - cy) / (star.z + (before - star.z) * 6)) * 0.5;
        ctx.strokeStyle = ctx.fillStyle as string;
        ctx.lineWidth = size * 0.8;
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  },
};
