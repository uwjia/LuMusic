// Drawing routines for the lyrics-page art background. Each preset is a
// renderer with a pure, deterministically seeded `create` (same size ->
// same layout, so the shapes are unit-testable without a canvas) and a
// `draw` that only touches the context passed in. All colors arrive via
// design tokens; `energy` (0..1 music loudness, floor while idle) and
// `bars` (smoothed spectrum) let effects react to the track without
// depending on it — with no input they keep drifting gently.

import type { ArtEffectId } from '@/lib/artEffects';

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
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Particle count scales with the canvas area, clamped for low-end GPUs. */
function countFor(area: number, perArea: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, area / perArea)));
}

/** Deterministic per-index noise (twinkle stays in sync across frames). */
function seededNoise(seed: number): number {
  const x = Math.sin(seed * 91.317 + 47.13) * 43758.5453;
  return x - Math.floor(x);
}

/* ------------------------------ aurora ------------------------------ */

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
export function auroraY(band: AuroraBand, x: number, width: number, time: number, energy: number): number {
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

/* ----------------------------- starfield ----------------------------- */

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

/* ------------------------------ bubbles ------------------------------ */

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
      ctx.arc(x - bubble.radius * 0.3, bubble.y - bubble.radius * 0.3, bubble.radius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = colors.accent;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};

/* ----------------------------- particles ----------------------------- */

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  /** Flow speed in px/s at energy 1. */
  speed: number;
  phase: number;
  size: number;
  tint2: boolean;
}

interface ParticlesState {
  particles: Particle[];
}

export const particlesRenderer: FxRenderer<ParticlesState> = {
  create: (width, height) => {
    const rand = mulberry32(0x9d11);
    return {
      particles: Array.from({ length: countFor(width * height, 14_000, 24, 90) }, () => {
        const x = rand() * width;
        const y = rand() * height;
        return {
          x,
          y,
          px: x,
          py: y,
          speed: 20 + rand() * 50,
          phase: rand() * Math.PI * 2,
          size: 0.8 + rand() * 1.6,
          tint2: rand() > 0.5,
        };
      }),
    };
  },
  draw: (state, f) => {
    const { ctx, width: w, height: h, dt, time, energy, colors } = f;
    // Trails come free from drawing the previous-position segment.
    ctx.lineCap = 'round';
    for (const p of state.particles) {
      p.px = p.x;
      p.py = p.y;
      p.x += p.speed * (0.35 + energy) * dt;
      // Vertical drift follows a slow traveling sine field: the swarm
      // weaves instead of marching in lockstep.
      p.y += Math.sin(time * 0.6 + p.phase + p.x / w * 4) * 14 * dt;

      if (p.x > w + 4) {
        p.x = -4;
        p.y = Math.random() * h;
        p.px = p.x;
        p.py = p.y;
      }
      ctx.globalAlpha = 0.25 + energy * 0.4;
      ctx.strokeStyle = p.tint2 ? colors.accent2 : colors.accent;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};

/* ------------------------------- wave ------------------------------- */

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
        const y = cy + mirror * (18 + Math.sin((x / w) * Math.PI * 3 + time * 1.6) * amp * 0.35 + bar * amp * 0.5);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};

/* ------------------------------ moonsea ------------------------------ */

// The moon-and-stars half of the reference demo's night scene (MyNo01
// FractalWave): a full-height night-sky gradient, 70 twinkling stars and
// a crescent moon with halo. Its sea/waves half is intentionally not
// ported. The palette is the artwork itself — a night scene cannot be
// derived from the UI design tokens — so the scene colors stay verbatim;
// only the twinkle pace additionally follows the music energy.

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

/* ------------------------------- snow ------------------------------- */

// The winter-night backdrop of the reference demo's Koch stage (MyNo01
// KochSnowflake): a deep-navy radial night and 64 deterministic snow
// flakes. The central growing Koch snowflake is intentionally not ported —
// as an ambient background the page reads calmer with sky and snow alone.
// Like moonsea, the scene colors are the artwork itself and stay verbatim;
// the fall speed additionally follows the music energy.

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
    const bg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.72);
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

/* ------------------------------ village ------------------------------ */

// 流水人家: a dusk riverside village — layered ridged mountains, a low
// sun, cottages with warm windows, a shimmering stream, a swaying willow,
// chimney smoke and drifting fireflies (the bridge was dropped on
// request; the scene is stream and households alone). Every moving
// particle is STATELESS exactly like the reference demo's snow (飘雪):
// position derives purely from time and a seeded index (modulo wrap +
// sine sway), so nothing mutates between frames. Scene palette is
// artwork, not design tokens (same policy as moonsea); music energy only
// warms the lights and speeds the water.

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

/** Seeded mountain silhouette as y-fractions — pure for unit tests. */
export function villageRidge(
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
      const x = ((seededNoise(i * 7.7 + 23) * (w + len)) + time * speed) % (w + len) - len;
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

/* ----------------------------- registry ----------------------------- */

export type ActiveArtEffectId = Exclude<ArtEffectId, 'off'>;

/** Renderers per non-off preset; keyed by the same ids as @/lib/artEffects. */
export const ART_RENDERERS: Record<ActiveArtEffectId, FxRenderer<unknown>> = {
  aurora: auroraRenderer,
  starfield: starfieldRenderer,
  bubbles: bubblesRenderer,
  particles: particlesRenderer,
  wave: waveRenderer,
  moonsea: moonseaRenderer,
  snow: snowRenderer,
  village: villageRenderer,
};
