// Village behavior: seeded ridges/scene and the stateless firefly math.
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { fireflyPos, villageRenderer, villageRidge } from '@/features/lyrics/art/village';

describe('village', () => {
  it('ridges are seeded silhouettes inside their band', () => {
    const far = villageRidge(11, 33, 0.46, 0.06);
    expect(far).toHaveLength(33);
    expect(far).toEqual(villageRidge(11, 33, 0.46, 0.06)); // deterministic
    expect(far.every((y) => y >= 0.4 && y <= 0.52)).toBe(true);
    // A different seed yields a different mountain line.
    expect(villageRidge(23, 33, 0.54, 0.08)).not.toEqual(far);
  });

  it('scene seeds deterministically and stays in frame', () => {
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

  it('fireflies rise, wrap inside the band and stay pure per time', () => {
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
