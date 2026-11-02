// Aurora behavior: the pure band centerline reacts to energy and stays
// within its band (verified against a no-op context).
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { auroraRenderer, auroraY } from '@/features/lyrics/art/aurora';

describe('aurora', () => {
  it('energy pumps the wave amplitude within band bounds', () => {
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

  it('draws without throwing at any energy level', () => {
    const state = auroraRenderer.create(800, 600);
    expect(() => auroraRenderer.draw(state, frame())).not.toThrow();
    expect(() => auroraRenderer.draw(state, frame({ energy: 1 }))).not.toThrow();
  });
});
