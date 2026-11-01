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
    speed: 0.5 + seededNoise(i),
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

    // Twinkle paces up a little once the music kicks in.
    for (const star of state.stars) {
      const tw =
        0.25 + 0.75 * Math.abs(Math.sin(time * star.speed * (0.75 + energy * 0.5) + star.phase));
      ctx.globalAlpha = tw * 0.85;
      ctx.fillStyle = '#dceaff';
      ctx.fillRect(star.x01 * w, star.y01 * h, 1.4, 1.4);
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
};
