// Moon & stars behavior: the star field is deterministic, bounded and
// twinkles at a gentle pace (regressions: 0.5-1.5 rad/s read as static,
// 1.5-5 rad/s strobed).
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { moonseaRenderer, moonStars } from '@/features/lyrics/art/moonsea';

describe('moonsea', () => {
  it('deterministic star field within bounds, carried by create', () => {
    const stars = moonStars();
    expect(stars).toHaveLength(70);
    expect(moonStars(12)).toHaveLength(12);
    // Same seed -> same sky on every mount.
    expect(stars).toEqual(moonStars());
    expect(stars.every((s) => s.x01 >= 0 && s.x01 < 1)).toBe(true);
    expect(stars.every((s) => s.y01 >= 0 && s.y01 <= 0.85)).toBe(true);
    // Distinct per-star phases keep the twinkle from syncing up, and the
    // pace stays in the gentle twinkling band.
    expect(new Set(stars.map((s) => s.phase)).size).toBe(70);
    expect(stars.every((s) => s.speed >= 1.2 && s.speed < 2.8)).toBe(true);

    const state = moonseaRenderer.create(800, 600);
    expect(state.stars).toEqual(stars);
    // Sky + stars + moon: stateless per frame, drawing must not throw.
    expect(() => moonseaRenderer.draw(state, frame())).not.toThrow();
    expect(() => moonseaRenderer.draw(state, frame({ energy: 1 }))).not.toThrow();
  });
});
