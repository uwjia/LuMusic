// Snow behavior: deterministic field, dt-accumulated fall (energy scales
// the rate, never rewinds) and bottom-to-top wrap.
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { snowField, snowRenderer } from '@/features/lyrics/art/snow';

describe('snow', () => {
  it('field is deterministic and within bounds', () => {
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

  it('flakes only ever fall — energy scales the rate, never rewinds', () => {
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

  it('flakes wrap from below the bottom edge back above the top', () => {
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
});
