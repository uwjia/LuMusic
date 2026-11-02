// 流水人家: a dusk riverside village — layered ridged mountains, a low
// sun, cottages with warm windows, a shimmering stream, a swaying willow,
// chimney smoke and drifting fireflies (the bridge was dropped on
// request; the scene is stream and households alone). Every moving
// particle is STATELESS exactly like the reference demo's snow (飘雪):
// position derives purely from time and a seeded index (modulo wrap +
// sine sway), so nothing mutates between frames. Scene palette is
// artwork, not design tokens (same policy as moonsea); music energy only
// warms the lights and speeds the water.

import { seededNoise, seededRidge, type FxRenderer } from '@/features/lyrics/art/fxTypes';

/** The shared ridge generator under its original scene-local name. */
export const villageRidge = seededRidge;

interface VillageFly {
  /** Base position as fractions of width / glow band. */
  x01: number;
  y01: number;
  /** Rise speed in px/s. */
  speed: number;
  /** Sway amplitude in px and phase. */
  sway: number;
  phase: number;
  /** Base alpha and pulse pace (rad/s). */
  alpha: number;
  twinkle: number;
}

interface VillageHouse {
  x01: number;
  w01: number;
  /** Height as a fraction of the canvas height. */
  h01: number;
  /** Roof peak height relative to the house height. */
  roof01: number;
  /** Window positions relative to the house box (0..1). */
  windows: { x01: number; y01: number }[];
}

interface VillageState {
  /** Mountain silhouette y-fractions, far to near. */
  ridges: number[][];
  houses: VillageHouse[];
  flies: VillageFly[];
}

/** Stateless firefly position (the snow technique): rise + wrap + sway. */
export function fireflyPos(
  fly: VillageFly,
  time: number,
  width: number,
  bandTop: number,
  bandHeight: number,
): { x: number; y: number } {
  const y = bandTop + bandHeight - ((fly.y01 * bandHeight + time * fly.speed) % bandHeight);
  const x = fly.x01 * width + Math.sin(time * 0.6 + fly.phase) * fly.sway;
  return { x, y };
}

function villageHouses(): VillageHouse[] {
  return [0, 1, 2, 3].map((i) => ({
    x01: 0.62 + i * 0.09 + seededNoise(40 + i) * 0.02,
    w01: 0.05 + seededNoise(50 + i) * 0.02,
    h01: 0.07 + seededNoise(60 + i) * 0.03,
    roof01: 0.5 + seededNoise(70 + i) * 0.2,
    windows:
      seededNoise(80 + i) > 0.5
        ? [
            { x01: 0.3, y01: 0.45 },
            { x01: 0.7, y01: 0.45 },
          ]
        : [{ x01: 0.3, y01: 0.45 }],
  }));
}

function villageFlies(count: number): VillageFly[] {
  return Array.from({ length: count }, (_, i) => ({
    x01: seededNoise(i * 4.1 + 3),
    y01: seededNoise(i * 6.3 + 5),
    speed: 6 + seededNoise(i * 2.2 + 7) * 12,
    sway: 8 + seededNoise(i * 8.8 + 9) * 16,
    phase: seededNoise(i * 5.5 + 11) * Math.PI * 2,
    alpha: 0.35 + seededNoise(i * 3.7 + 13) * 0.45,
    twinkle: 1.5 + seededNoise(i * 9.1 + 15) * 3.5,
  }));
}

export const villageRenderer: FxRenderer<VillageState> = {
  create: () => ({
    ridges: [villageRidge(11, 33, 0.46, 0.06), villageRidge(23, 33, 0.54, 0.08)],
    houses: villageHouses(),
    flies: villageFlies(26),
  }),
  draw: (state, f) => {
    const { ctx, width: w, height: h, time, energy } = f;
    const yW = h * 0.66; // waterline

    /* ---------- dusk sky ---------- */
    const sky = ctx.createLinearGradient(0, 0, 0, yW);
    sky.addColorStop(0, '#151b33');
    sky.addColorStop(0.6, '#3d2b49');
    sky.addColorStop(1, '#8a4a2f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, yW);

    // Low sun halo behind the ridges.
    const sx = w * 0.34;
    const sy = yW * 0.88;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.3);
    sun.addColorStop(0, `rgba(255, 196, 120, ${0.5 + energy * 0.2})`);
    sun.addColorStop(1, 'rgba(255, 196, 120, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, yW);

    /* ---------- mountains ---------- */
    for (let r = 0; r < state.ridges.length; r++) {
      const ridge = state.ridges[r];
      ctx.beginPath();
      // Filled below the waterline: the wavy water top must always cover
      // the mountains' base, or their straight cut would show through.
      ctx.moveTo(0, yW + 8);
      for (let i = 0; i < ridge.length; i++) {
        ctx.lineTo((i / (ridge.length - 1)) * w, ridge[i] * h);
      }
      ctx.lineTo(w, yW + 8);
      ctx.closePath();
      ctx.fillStyle = r === 0 ? '#2a2440' : '#1d1a30';
      ctx.fill();
    }

    /* ---------- water ---------- */
    const water = ctx.createLinearGradient(0, yW, 0, h);
    // The top stop leans warm so the stream carries the dusk sky instead
    // of cutting a cold blue band under it.
    water.addColorStop(0, '#2e3348');
    water.addColorStop(0.25, '#1a2438');
    water.addColorStop(1, '#101828');
    // Wavy top edge: a fillRect waterline would print one dead-straight
    // horizon across the whole scene.
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, yW + seededNoise(400) * 4);
    const waterSeg = 18;
    for (let i = 1; i <= waterSeg; i++) {
      const t = i / waterSeg;
      const py = yW + Math.sin(t * 9 + 0.4) * 3 + (seededNoise(400 + i) - 0.5) * 6;
      ctx.lineTo(t * w, py);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Sun reflection: wobbling warm dashes fading downstream.
    for (let i = 0; i < 12; i++) {
      const yy = yW + (i / 12) * (h - yW) * 0.9;
      const wob = Math.sin(time * 1.8 + i * 1.3) * (4 + i * 1.5);
      const half = Math.max(3, 14 - i * 0.8);
      ctx.globalAlpha = Math.max(0, 0.28 - i * 0.02) + energy * 0.06;
      ctx.fillStyle = '#ffcf8f';
      ctx.fillRect(sx - half + wob, yy, half * 2, 2);
    }

    // Drifting shimmer streaks — stateless, exactly like the snow field.
    for (let i = 0; i < 46; i++) {
      const yy = yW + seededNoise(i * 1.9 + 17) * (h - yW);
      const speed = 10 + seededNoise(i * 3.3 + 19) * 30 + energy * 24;
      const len = 14 + seededNoise(i * 5.1 + 21) * 40;
      const x = (seededNoise(i * 7.7 + 23) * (w + len) + time * speed) % (w + len) - len;
      ctx.globalAlpha = 0.05 + seededNoise(i * 2.6 + 25) * 0.1;
      ctx.strokeStyle = '#9fd8e8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + len, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* ---------- 水岸雾带 ---------- */
    // A wavy mist band rides the waterline and swallows whatever is left
    // of the sky/water boundary — no straight horizon survives anywhere
    // across the scene (国画水汽留白手法).
    const mistTop = yW - h * 0.05;
    const mistBottom = yW + h * 0.05;
    const mist = ctx.createLinearGradient(0, mistTop, 0, mistBottom);
    mist.addColorStop(0, 'rgba(216, 196, 205, 0)');
    mist.addColorStop(0.45, `rgba(220, 199, 206, ${0.15 + energy * 0.05})`);
    mist.addColorStop(1, 'rgba(216, 196, 205, 0)');
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.moveTo(0, mistBottom);
    const mistSeg = 14;
    for (let i = 0; i <= mistSeg; i++) {
      const t = i / mistSeg;
      const py = mistTop + Math.sin(t * 7 + 1.3) * 4 + seededNoise(300 + i) * 10;
      ctx.lineTo(t * w, py);
    }
    ctx.lineTo(w, mistBottom);
    ctx.closePath();
    ctx.fill();

    /* ---------- 人家: cottages on the right bank ---------- */
    for (let hi = 0; hi < state.houses.length; hi++) {
      const hs = state.houses[hi];
      const hx = hs.x01 * w;
      const hw = hs.w01 * w;
      const hh = hs.h01 * h;
      const hy = yW - hh;
      ctx.fillStyle = '#1b1f2e';
      ctx.fillRect(hx, hy, hw, hh); // walls
      ctx.beginPath(); // pitched roof
      ctx.moveTo(hx - hw * 0.12, hy);
      ctx.lineTo(hx + hw * 0.5, hy - hh * hs.roof01);
      ctx.lineTo(hx + hw * 1.12, hy);
      ctx.closePath();
      ctx.fillStyle = '#141826';
      ctx.fill();
      ctx.fillRect(hx + hw * 0.72, hy - hh * hs.roof01 * 0.55, hw * 0.1, hh * 0.3); // chimney

      // Warm windows flicker with the music.
      for (let wi = 0; wi < hs.windows.length; wi++) {
        const win = hs.windows[wi];
        const flicker = 0.7 + 0.3 * Math.sin(time * 2.2 + hi * 2 + wi);
        ctx.globalAlpha = Math.min(1, 0.55 + energy * 0.35) * flicker;
        ctx.fillStyle = '#ffca7a';
        ctx.fillRect(hx + win.x01 * hw - hw * 0.09, hy + win.y01 * hh, hw * 0.18, hh * 0.18);
      }
      ctx.globalAlpha = 1;
    }

    // Chimney smoke: puffs rise deterministically from time alone.
    for (let c = 0; c < 2 && c < state.houses.length; c++) {
      const hs = state.houses[c];
      const cx = (hs.x01 + hs.w01 * 0.77) * w;
      const cy = yW - hs.h01 * h - hs.h01 * h * hs.roof01 * 0.55;
      for (let k = 0; k < 6; k++) {
        const t01 = (((time * 0.1 + k / 6) % 1) + 1) % 1;
        const py = cy - t01 * h * 0.16;
        const px = cx + Math.sin(t01 * 5 + time * 0.4 + c) * 9 * (0.3 + t01);
        ctx.globalAlpha = (1 - t01) * 0.16;
        ctx.fillStyle = '#cfd6e4';
        ctx.beginPath();
        ctx.arc(px, py, 2.5 + t01 * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    /* ---------- 岸: organic bank over the cottage bases ---------- */
    // The crest waves ±16px and overlaps the house bases, so the cottages
    // grow out of the soil instead of floating on a strip; the gradient
    // then melts into the water below.
    const bankTop = yW - 6;
    const bankBottom = yW + h * 0.12;
    ctx.beginPath();
    ctx.moveTo(w * 0.55, bankTop + 10);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const px = w * 0.55 + t * w * 0.45;
      const py = bankTop + Math.sin(t * 6.5 + 0.7) * 7 + (seededNoise(90 + i) - 0.35) * 14;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(w, bankBottom);
    ctx.lineTo(w * 0.55, bankBottom);
    ctx.closePath();
    const bank = ctx.createLinearGradient(0, bankTop, 0, bankBottom);
    bank.addColorStop(0, '#1a2030');
    bank.addColorStop(0.55, '#161b29');
    bank.addColorStop(1, 'rgba(21, 26, 38, 0)');
    ctx.fillStyle = bank;
    ctx.fill();

    // Window lights pour into the stream from under the bank's edge.
    for (let hi = 0; hi < state.houses.length; hi++) {
      const hs = state.houses[hi];
      const hx = hs.x01 * w;
      const hw = hs.w01 * w;
      ctx.fillStyle = '#ffca7a';
      for (let k = 0; k < 5; k++) {
        const wob = Math.sin(time * 2 + k * 1.7 + hi) * 3;
        ctx.globalAlpha = Math.max(0, 0.2 - k * 0.035);
        ctx.fillRect(hx + hw * 0.3 + wob, yW + 4 + k * 7, hw * 0.4, 1.6);
      }
    }
    ctx.globalAlpha = 1;

    /* ---------- 流水人家点缀: willow on the left bank ---------- */
    const tx = w * 0.11;
    const tTop = yW - h * 0.2;
    ctx.strokeStyle = '#141a26';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tx, yW + 2);
    ctx.quadraticCurveTo(tx + 10, (yW + tTop) / 2, tx + 4, tTop);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    for (let s = 0; s < 7; s++) {
      const sway = Math.sin(time * 0.9 + s * 0.8) * 6 * (0.6 + energy * 0.6);
      const bx = tx + 4 + (s - 3) * 7;
      ctx.beginPath();
      ctx.moveTo(bx, tTop + 6);
      ctx.quadraticCurveTo(bx + sway * 0.5, tTop + h * 0.09, bx + sway, tTop + h * 0.15);
      ctx.stroke();
    }

    /* ---------- 萤火: snow-style stateless fireflies ---------- */
    const bandTop = yW - h * 0.5;
    for (const fly of state.flies) {
      const { x, y } = fireflyPos(fly, time, w, bandTop, h * 0.5);
      const glow = 0.4 + 0.6 * Math.abs(Math.sin(time * fly.twinkle + fly.phase));
      ctx.globalAlpha = fly.alpha * glow * (0.7 + energy * 0.5);
      ctx.fillStyle = '#ffe9a3';
      ctx.shadowColor = 'rgba(255, 224, 130, 0.9)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  },
};
