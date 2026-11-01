// Renderer unit tests: layouts are deterministic and area-scaled, and the
// per-frame state transitions (movement, recycling, spawn/remove) behave
// as specified — verified against a chainable no-op context so no real
// canvas is needed.
import { describe, expect, it } from 'vitest';
import type { FxFrame } from '@/features/lyrics/artRenderers';
import {
  auroraRenderer,
  auroraY,
  bubblesRenderer,
  moonseaRenderer,
  moonStars,
  particlesRenderer,
  starfieldRenderer,
  waveRenderer,
} from '@/features/lyrics/artRenderers';

const gradientStub = { addColorStop: () => {} };
const ctxStub = new Proxy({} as CanvasRenderingContext2D, {
  get: (_target, prop) => {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
      return () => gradientStub;
    }
    return () => undefined;
  },
  set: () => true,
});

const frame = (over: Partial<FxFrame> = {}): FxFrame => ({
  ctx: ctxStub,
  width: 800,
  height: 600,
  time: 1,
  dt: 0.1,
  energy: 0.5,
  bars: Array<number>(24).fill(0.5),
  colors: { accent: '#6366f1', accent2: '#a855f7', dim: '#2a2f3f' },
  ...over,
});

describe('renderers', () => {
  it('seed layouts deterministically and scale counts with the area', () => {
    const small = starfieldRenderer.create(100, 100);
    const smallAgain = starfieldRenderer.create(100, 100);
    expect(small.stars.length).toBe(40); // area floor
    expect(small.stars).toEqual(smallAgain.stars);
    expect(starfieldRenderer.create(4_000, 1_000).stars.length).toBe(160); // cap

    const bubbles = bubblesRenderer.create(800, 600);
    expect(bubbles.bubbles.length).toBeGreaterThan(14);
    expect(bubbles.bubbles.every((b) => b.x >= 0 && b.x <= 800 && b.y >= 0 && b.y <= 600)).toBe(
      true,
    );
  });

  it('starfield: stars approach the viewer and recycle at the far plane', () => {
    const state = starfieldRenderer.create(800, 600);
    const star = state.stars[0];
    const zBefore = star.z;
    // Small dt keeps the star inside the depth range: it must only move.
    starfieldRenderer.draw(state, frame({ dt: 0.05 }));
    expect(star.z).toBeLessThan(zBefore);

    // A star past the near plane resets to the far plane within bounds.
    star.z = 0.01;
    starfieldRenderer.draw(state, frame({ dt: 0.01 }));
    expect(star.z).toBe(1);
    expect(star.x).toBeGreaterThanOrEqual(0);
    expect(star.x).toBeLessThanOrEqual(800);
  });

  it('bubbles: rise with speed and recycle at the bottom edge', () => {
    const state = bubblesRenderer.create(800, 600);
    const bubble = state.bubbles[0];
    bubble.radius = 5;
    bubble.y = -10; // fully above the top edge
    bubblesRenderer.draw(state, frame({ energy: 0, dt: 0.016 }));
    expect(bubble.y).toBeGreaterThan(590); // respawned below the fold
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.x).toBeLessThanOrEqual(800);

    const other = state.bubbles[1];
    const yBefore = other.y;
    bubblesRenderer.draw(state, frame({ energy: 0, dt: 0.5 }));
    expect(other.y).toBeLessThan(yBefore); // ascending
  });

  it('particles: drift rightward and wrap to the left edge', () => {
    const state = particlesRenderer.create(800, 600);
    const particle = state.particles[0];
    particle.x = 799;
    particlesRenderer.draw(state, frame({ dt: 0.5 }));
    expect(particle.x).toBeLessThanOrEqual(4); // wrapped past the right edge
    expect(particle.px).toBe(particle.x); // trail anchor resets with it
  });

  it('wave: spawns ripples over time and drops them past the max radius', () => {
    const state = waveRenderer.create(800, 600);
    state.spawnIn = 0; // due now
    waveRenderer.draw(state, frame({ dt: 0.016 }));
    expect(state.ripples.length).toBeGreaterThan(0);

    const ripple = state.ripples[0];
    ripple.radius = 10_000; // beyond hypot(w,h)/2
    waveRenderer.draw(state, frame({ dt: 0.016 }));
    expect(state.ripples).not.toContain(ripple);
  });

  it('aurora: energy pumps the wave amplitude within band bounds', () => {
    const band = auroraRenderer.create(800, 600).bands[0];
    const calm = auroraY(band, 400, 800, 1, 0);
    const loud = auroraY(band, 400, 800, 1, 1);
    expect(Math.abs(loud - band.yRatio)).toBeGreaterThanOrEqual(Math.abs(calm - band.yRatio));
    for (let x = 0; x <= 800; x += 50) {
      const y = auroraY(band, x, 800, 5, 1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1.2);
    }
  });

  it('moonsea: deterministic star field within bounds, carried by create', () => {
    const stars = moonStars();
    expect(stars).toHaveLength(70);
    expect(moonStars(12)).toHaveLength(12);
    // Same seed -> same sky on every mount.
    expect(stars).toEqual(moonStars());
    expect(stars.every((s) => s.x01 >= 0 && s.x01 < 1)).toBe(true);
    expect(stars.every((s) => s.y01 >= 0 && s.y01 <= 0.85)).toBe(true);
    // Distinct per-star phases keep the twinkle from syncing up.
    expect(new Set(stars.map((s) => s.phase)).size).toBe(70);

    const state = moonseaRenderer.create(800, 600);
    expect(state.stars).toEqual(stars);
    // Sky + stars + moon: stateless per frame, drawing must not throw.
    expect(() => moonseaRenderer.draw(state, frame())).not.toThrow();
  });
});
