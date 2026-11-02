// 晚霞落山: a setting sun sinking behind layered ridge silhouettes under
// drifting dusk clouds. Mountains reuse the shared ridge generator;
// clouds and returning birds are stateless snow-style movers (position
// derives from time + seed alone, nothing mutates between frames). The
// palette is the artwork itself (same policy as moonsea/village); the
// music energy only swells the sun glow and warms the clouds.

import { seededNoise, seededRidge, type FxRenderer } from '@/features/lyrics/art/fxTypes';

interface SunsetCloudLobe {
  /** Horizontal offset from the cloud center, in half-lengths (-1..1). */
  dx: number;
  /** Half-width as a fraction of the cloud half-length. */
  rx: number;
  /** Half-height as a fraction of the cloud thickness. */
  ry: number;
  /** Vertical offset in thickness units (positive = toward horizon). */
  dy: number;
}

interface SunsetCloud {
  /** Band position as a fraction of the sky height (0..1). */
  y01: number;
  /** Drift offset as a fraction of the wrap span. */
  x01: number;
  /** Length / thickness as fractions of width / height. */
  len01: number;
  thick01: number;
  /** Drift speed as a fraction of width per second. */
  speed01: number;
  alpha: number;
  /** Asymmetric lobe puffs — a single ellipse reads as a blob. */
  lobes: SunsetCloudLobe[];
}

interface SunsetState {
  clouds: SunsetCloud[];
  /** Three ridge silhouettes, far to near. */
  ridges: number[][];
}

/** Cloud band layout — pure for unit tests. */
export function sunsetClouds(count = 9): SunsetCloud[] {
  return Array.from({ length: count }, (_, i) => ({
    // Clouds bunch toward the horizon, where dusk clouds actually live.
    y01: 0.15 + seededNoise(i * 4.7 + 2) * 0.55,
    x01: seededNoise(i * 8.3 + 4),
    len01: 0.1 + seededNoise(i * 2.9 + 6) * 0.16,
    thick01: 0.012 + seededNoise(i * 6.1 + 8) * 0.02,
    speed01: 0.006 + seededNoise(i * 3.7 + 10) * 0.012,
    alpha: 0.1 + seededNoise(i * 5.3 + 12) * 0.22,
    // A main body plus offset side puffs and horizon-skimming tails:
    // real dusk clouds are ragged and bottom-heavy, never one ellipse.
    lobes: [
      { dx: 0, rx: 0.85 + seededNoise(i * 1.1 + 41) * 0.25, ry: 1, dy: 0 },
      { dx: -0.72, rx: 0.42 + seededNoise(i * 2.3 + 43) * 0.22, ry: 0.55, dy: 0.26 },
      { dx: 0.68, rx: 0.45 + seededNoise(i * 3.1 + 45) * 0.25, ry: 0.6, dy: -0.1 },
      { dx: -1.05, rx: 0.26 + seededNoise(i * 4.7 + 47) * 0.12, ry: 0.38, dy: 0.5 },
      { dx: 1.0, rx: 0.3 + seededNoise(i * 5.9 + 49) * 0.15, ry: 0.42, dy: 0.3 },
    ],
  }));
}

/** Stateless bird position: glide leftward and wrap, bobbing on a sine. */
export function sunsetBirdPos(
  i: number,
  time: number,
  width: number,
  bandTop: number,
  bandHeight: number,
): { x: number; y: number } {
  const lane = seededNoise(i * 9.9 + 31);
  const speed = 26 + seededNoise(i * 1.3 + 33) * 30;
  const x = width - ((seededNoise(i * 7.7 + 35) * (width + 80) + time * speed) % (width + 80));
  const y = bandTop + lane * bandHeight + Math.sin(time * 0.9 + i * 1.4) * 10;
  return { x, y };
}

export const sunsetRenderer: FxRenderer<SunsetState> = {
  create: () => ({
    clouds: sunsetClouds(),
    ridges: [
      seededRidge(31, 41, 0.5, 0.05),
      seededRidge(47, 41, 0.56, 0.06),
      seededRidge(59, 41, 0.63, 0.07),
    ],
  }),
  draw: (state, f) => {
    const { ctx, width: w, height: h, time, energy } = f;
    const yH = h * 0.72; // horizon: where the ridges stack into the haze

    /* ---------- dusk sky ---------- */
    // The gradient fills the whole page so the ridge gaps never leak the
    // old background; ridges and haze cover everything below the crest.
    const sky = ctx.createLinearGradient(0, 0, 0, yH);
    sky.addColorStop(0, '#1b1740');
    sky.addColorStop(0.35, '#4a2a55');
    sky.addColorStop(0.65, '#a04a3a');
    sky.addColorStop(0.88, '#e8874a');
    sky.addColorStop(1, '#ffc76e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /* ---------- setting sun (half-sunk behind the ridges) ---------- */
    const sunX = w * 0.5;
    const sunY = yH - h * 0.05;
    const sunR = h * 0.07;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.5);
    glow.addColorStop(0, `rgba(255, 214, 140, ${0.75 + energy * 0.2})`);
    glow.addColorStop(0.25, `rgba(255, 170, 100, ${0.3 + energy * 0.15})`);
    glow.addColorStop(1, 'rgba(255, 170, 100, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe3a3';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    /* ---------- drifting dusk clouds ---------- */
    for (const cloud of state.clouds) {
      const len = cloud.len01 * w;
      const thick = cloud.thick01 * h;
      const x = (cloud.x01 * (w + len) + time * cloud.speed01 * w) % (w + len) - len * 0.5;
      const y = cloud.y01 * yH;
      const cx = x + len * 0.5;
      // Clouds near the horizon catch the sun: low bands glow amber,
      // high bands stay violet — height decides the tint.
      const warm = Math.min(1, Math.max(0, (0.7 - cloud.y01) / 0.55));
      const r = Math.round(120 + (255 - 120) * warm);
      const g = Math.round(80 + (165 - 80) * warm);
      const b = Math.round(140 + (105 - 140) * warm);
      // Lit from below by the setting sun: the underside leans amber,
      // the top keeps a violet shade (a vertical gradient inside the union).
      const lit = 0.32;
      const br = Math.round(r + (255 - r) * lit);
      const bg = Math.round(g + (200 - g) * lit);
      const bb = Math.round(b + (140 - b) * lit);
      const tr = Math.round(r * 0.7);
      const tg = Math.round(g * 0.62);
      const tb = Math.min(255, Math.round(b * 0.8 + 25));
      const fill = ctx.createLinearGradient(0, y - thick, 0, y + thick);
      fill.addColorStop(0, `rgb(${tr}, ${tg}, ${tb})`);
      fill.addColorStop(1, `rgb(${br}, ${bg}, ${bb})`);
      ctx.globalAlpha = cloud.alpha * (0.85 + energy * 0.15);
      ctx.fillStyle = fill;
      // All lobes go into ONE path so the union fills with a single
      // alpha — separate fills would double-darken at the overlaps.
      ctx.beginPath();
      for (const lobe of cloud.lobes) {
        const lcx = cx + lobe.dx * len * 0.5;
        const lcy = y + lobe.dy * thick;
        const lrx = Math.max(2, lobe.rx * len * 0.5);
        const lry = Math.max(1.2, lobe.ry * thick);
        // Zero-length hop to the ellipse start: no connecting line.
        ctx.moveTo(lcx + lrx, lcy);
        ctx.ellipse(lcx, lcy, lrx, lry, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* ---------- layered ridges, far to near ---------- */
    // Far ridges sit in light haze (warmer purple), near ones sink into
    // the dark foreground — the classic dusk depth cue.
    const RIDGE_FILL = ['#5c3a55', '#3a2742', '#241a33'];
    for (let r = 0; r < state.ridges.length; r++) {
      const ridge = state.ridges[r];
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < ridge.length; i++) {
        ctx.lineTo((i / (ridge.length - 1)) * w, ridge[i] * h);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = RIDGE_FILL[r];
      ctx.fill();
    }

    /* ---------- warm haze where the ridges stack ---------- */
    const haze = ctx.createLinearGradient(0, yH - h * 0.12, 0, h);
    haze.addColorStop(0, 'rgba(255, 190, 120, 0)');
    haze.addColorStop(0.4, `rgba(255, 190, 120, ${0.1 + energy * 0.06})`);
    haze.addColorStop(1, 'rgba(255, 190, 120, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, yH - h * 0.12, w, h * 0.4);

    /* ---------- returning birds (stateless) ---------- */
    ctx.strokeStyle = '#2a1f3a';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    const bandTop = h * 0.1;
    const bandH = h * 0.3;
    for (let i = 0; i < 5; i++) {
      const { x, y } = sunsetBirdPos(i, time, w, bandTop, bandH);
      if (x < -30 || x > w + 30) continue;
      // Flap: wing tips swing around the body on a fast sine.
      const flap = Math.sin(time * 7 + i * 1.9) * 3;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 1 + flap);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 5, y - 1 + flap);
      ctx.stroke();
    }
  },
};
