// Wave behavior: ripple spawn/expire lifecycle.
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { waveRenderer } from '@/features/lyrics/art/wave';

describe('wave', () => {
  it('spawns ripples over time and drops them past the max radius', () => {
    const state = waveRenderer.create(800, 600);
    state.spawnIn = 0; // due now
    waveRenderer.draw(state, frame({ dt: 0.016 }));
    expect(state.ripples.length).toBeGreaterThan(0);

    const ripple = state.ripples[0];
    ripple.radius = 10_000; // beyond hypot(w,h)/2
    waveRenderer.draw(state, frame({ dt: 0.016 }));
    expect(state.ripples).not.toContain(ripple);
  });
});
