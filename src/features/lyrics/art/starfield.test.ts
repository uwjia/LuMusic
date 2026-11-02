// Starfield behavior: seeded, area-scaled layout and depth recycling.
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { starfieldRenderer } from '@/features/lyrics/art/starfield';

describe('starfield', () => {
  it('seeds deterministically and scales the count with the area', () => {
    const small = starfieldRenderer.create(100, 100);
    const smallAgain = starfieldRenderer.create(100, 100);
    expect(small.stars.length).toBe(40); // area floor
    expect(small.stars).toEqual(smallAgain.stars);
    expect(starfieldRenderer.create(4_000, 1_000).stars.length).toBe(160); // cap
  });

  it('stars approach the viewer and recycle at the far plane', () => {
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
});
