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
  fireflyPos,
  moonseaRenderer,
  moonStars,
  particlesRenderer,
  snowField,
  snowRenderer,
  starfieldRenderer,
  villageRenderer,
  villageRidge,
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
    // Distinct per-star phases keep the twinkle from syncing up, and the
    // pace stays in the gentle twinkling band (regressions: the original
    // port breathed over 3-8s and looked static; 1.5-5 rad/s strobed).
    expect(new Set(stars.map((s) => s.phase)).size).toBe(70);
    expect(stars.every((s) => s.speed >= 1.2 && s.speed < 2.8)).toBe(true);

    const state = moonseaRenderer.create(800, 600);
    expect(state.stars).toEqual(stars);
    // Sky + stars + moon: stateless per frame, drawing must not throw.
    expect(() => moonseaRenderer.draw(state, frame())).not.toThrow();
  });

  it('snow: field is deterministic and within bounds', () => {
    const snow = snowField();
    expect(snow).toHaveLength(64);
    expect(snowField(12)).toHaveLength(12);
    // Same seed -> the same sky on every mount.
    expect(snow).toEqual(snowField());
    expect(snow.every((f) => f.x01 >= 0 && f.x01 < 1)).toBe(true);
    expect(snow.every((f) => f.y01 >= 0 && f.y01 < 1)).toBe(true);
    expect(snow.every((f) => f.speed01 >= 14 / 600 && f.speed01 <= 48 / 600)).toBe(true);
    expect(snow.every((f) => f.alpha > 0 && f.alpha < 1)).toBe(true);

    // Night sky + snow: drawing must not throw at any energy level.
    const state = snowRenderer.create(800, 600);
    expect(state.snow).toEqual(snow);
    expect(() => snowRenderer.draw(state, frame())).not.toThrow();
    expect(() => snowRenderer.draw(state, frame({ energy: 1 }))).not.toThrow();
  });

  it('snow: flakes only ever fall — energy scales the rate, never rewinds', () => {
    const state = snowRenderer.create(800, 600);
    const flake = state.snow[0];
    const start = flake.y01;
    snowRenderer.draw(state, frame({ dt: 0.1, energy: 1 }));
    const fast = flake.y01 - start;
    expect(fast).toBeGreaterThan(0);

    // Quieter music slows the fall but must never drag flakes upward.
    snowRenderer.draw(state, frame({ dt: 0.1, energy: 0 }));
    const slow = flake.y01 - (start + fast);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast);

    // dt 0 (frozen frame): position stays put even at full energy.
    const frozen = flake.y01;
    snowRenderer.draw(state, frame({ dt: 0, energy: 1 }));
    expect(flake.y01).toBe(frozen);
  });

  it('snow: flakes wrap from below the bottom edge back above the top', () => {
    const state = snowRenderer.create(800, 600);
    const flake = state.snow[0];
    const span = 1 + 8 / 600;
    flake.y01 = span - 0.0005; // a hair below the wrap threshold
    snowRenderer.draw(state, frame({ dt: 0.016 }));
    expect(flake.y01).toBeGreaterThanOrEqual(0);
    expect(flake.y01).toBeLessThan(span);
    // Drawn y always stays within the [−4, h+4) fall lane.
    expect(flake.y01 * 600 - 4).toBeGreaterThanOrEqual(-4.0001);
  });

  it('village: ridges are seeded silhouettes inside their band', () => {
    const far = villageRidge(11, 33, 0.46, 0.06);
    expect(far).toHaveLength(33);
    expect(far).toEqual(villageRidge(11, 33, 0.46, 0.06)); // deterministic
    expect(far.every((y) => y >= 0.4 && y <= 0.52)).toBe(true);
    // A different seed yields a different mountain line.
    expect(villageRidge(23, 33, 0.54, 0.08)).not.toEqual(far);
  });

  it('village: scene seeds deterministically and stays in frame', () => {
    const state = villageRenderer.create(800, 600);
    expect(state).toEqual(villageRenderer.create(800, 600));
    expect(state.ridges).toHaveLength(2);
    expect(state.houses.length).toBeGreaterThanOrEqual(3);
    // Cottages sit on the right bank and never spill past the frame.
    expect(state.houses.every((hs) => hs.x01 > 0.6 && hs.x01 + hs.w01 * 1.12 < 1)).toBe(true);
    expect(state.houses.every((hs) => hs.windows.length >= 1)).toBe(true);
    expect(state.flies).toHaveLength(26);

    // Dusk scene: drawing must not throw at any energy level.
    expect(() => villageRenderer.draw(state, frame())).not.toThrow();
    expect(() => villageRenderer.draw(state, frame({ energy: 1 }))).not.toThrow();
  });

  it('village: fireflies rise, wrap inside the band and stay pure per time', () => {
    const fly = villageRenderer.create(800, 600).flies[0];
    const bandTop = 100;
    const bandHeight = 300;
    const p0 = fireflyPos(fly, 0, 800, bandTop, bandHeight);
    // Stateless: the same time always maps to the same position.
    expect(p0).toEqual(fireflyPos(fly, 0, 800, bandTop, bandHeight));
    expect(p0.y).toBeGreaterThanOrEqual(bandTop);
    expect(p0.y).toBeLessThan(bandTop + bandHeight);

    // Rising: later time moves the firefly unless it wrapped.
    const p1 = fireflyPos(fly, 5, 800, bandTop, bandHeight);
    expect(p1.y).not.toBe(p0.y);

    // However far time advances, the wrap keeps it inside the band
    // (snow-style modulo — no particle ever escapes the glow region).
    const pBig = fireflyPos(fly, 10_000, 800, bandTop, bandHeight);
    expect(pBig.y).toBeGreaterThanOrEqual(bandTop);
    expect(pBig.y).toBeLessThan(bandTop + bandHeight);
  });
});
