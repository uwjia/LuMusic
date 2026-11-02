// Sunset behavior: the ragged multi-lobe cloud band and the stateless
// returning birds.
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { sunsetBirdPos, sunsetClouds, sunsetRenderer } from '@/features/lyrics/art/sunset';

describe('sunset', () => {
  it('cloud band is deterministic, in-band, slow-drifting and multi-lobe', () => {
    const clouds = sunsetClouds();
    expect(clouds).toHaveLength(9);
    expect(sunsetClouds(6)).toHaveLength(6);
    // Same seed -> the same dusk sky on every mount.
    expect(clouds).toEqual(sunsetClouds());
    // Clouds bunch toward the horizon and never cross the ridge line.
    expect(clouds.every((c) => c.y01 >= 0.15 && c.y01 <= 0.7)).toBe(true);
    expect(clouds.every((c) => c.len01 > 0 && c.len01 < 0.3)).toBe(true);
    expect(clouds.every((c) => c.speed01 >= 0.006 && c.speed01 < 0.018)).toBe(true);
    expect(clouds.every((c) => c.alpha > 0 && c.alpha < 1)).toBe(true);
    // Clouds are ragged multi-lobe unions, not single-ellipse blobs: a
    // centered main body plus offset side puffs and horizon tails.
    expect(clouds.every((c) => c.lobes.length >= 4)).toBe(true);
    expect(clouds.every((c) => c.lobes.every((l) => l.rx > 0 && l.ry > 0))).toBe(true);
    const [main, , , tail] = clouds[0].lobes;
    expect(main.dx).toBe(0); // main body centered
    expect(main.ry).toBeGreaterThanOrEqual(tail.ry); // tails thinner than body
    expect(Math.abs(tail.dx)).toBeGreaterThan(0.9); // tails reach past the body
    // Side puffs sit asymmetric heights so the silhouette never reads round.
    expect(clouds[0].lobes.some((l) => l.dy !== 0)).toBe(true);

    const state = sunsetRenderer.create(800, 600);
    expect(state.clouds).toEqual(clouds);
    expect(state.ridges).toHaveLength(3);
    // Ridges stack far-to-near downhill, so the near silhouette sits lowest.
    const [far, , near] = state.ridges;
    expect(near[0]).toBeGreaterThan(far[0]);
    // Sky + sun + clouds + ridges + haze + birds: no throw at any energy.
    expect(() => sunsetRenderer.draw(state, frame())).not.toThrow();
    expect(() => sunsetRenderer.draw(state, frame({ energy: 1 }))).not.toThrow();
  });

  it('birds drift stateless, leftward and inside the sky band', () => {
    const bandTop = 60;
    const bandHeight = 180;
    // Stateless: the same time always maps to the same position.
    expect(sunsetBirdPos(2, 0, 800, bandTop, bandHeight)).toEqual(
      sunsetBirdPos(2, 0, 800, bandTop, bandHeight),
    );
    // However far time advances, the wrap keeps the bird inside the span
    // and the sine bob inside the band (±10px).
    const p = sunsetBirdPos(2, 10_000, 800, bandTop, bandHeight);
    expect(p.x).toBeGreaterThanOrEqual(-0.001);
    expect(p.x).toBeLessThanOrEqual(800);
    expect(p.y).toBeGreaterThanOrEqual(bandTop - 10.001);
    expect(p.y).toBeLessThanOrEqual(bandTop + bandHeight + 10.001);
    // Leftward glide: same lane, later time moves west (unless wrapped).
    const p0 = sunsetBirdPos(1, 1, 800, bandTop, bandHeight).x;
    const p1 = sunsetBirdPos(1, 1.1, 800, bandTop, bandHeight).x;
    const p2 = sunsetBirdPos(1, 1.2, 800, bandTop, bandHeight).x;
    expect(p1).not.toBe(p0);
    expect(p2).not.toBe(p1);
  });
});
