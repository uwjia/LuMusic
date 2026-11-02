// Bubbles behavior: seeded in-frame layout, ascent and bottom recycling.
import { describe, expect, it } from 'vitest';
import { frame } from '@/features/lyrics/art/testFrame';
import { bubblesRenderer } from '@/features/lyrics/art/bubbles';

describe('bubbles', () => {
  it('seeds deterministically and keeps bubbles in frame', () => {
    const bubbles = bubblesRenderer.create(800, 600);
    // Compare the layout only — the state also holds a closure `rand`
    // whose instances never deep-equal each other.
    expect(bubbles.bubbles).toEqual(bubblesRenderer.create(800, 600).bubbles);
    expect(bubbles.bubbles.length).toBeGreaterThan(14);
    expect(
      bubbles.bubbles.every((b) => b.x >= 0 && b.x <= 800 && b.y >= 0 && b.y <= 600),
    ).toBe(true);
  });

  it('rises with speed and recycles at the bottom edge', () => {
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
});
