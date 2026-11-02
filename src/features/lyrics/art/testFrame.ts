// Shared canvas-context stub and frame factory for the per-effect tests
// (jsdom has no 2D context, so painting is a no-op and only the data
// flow through the state is assertable — same convention as the
// SpectrumPanel tests). Not a test file itself; imported by the *.test
// modules under art/.

import type { FxFrame } from '@/features/lyrics/art/fxTypes';

const gradientStub = { addColorStop: () => {} };

export const ctxStub = new Proxy({} as CanvasRenderingContext2D, {
  get: (_target, prop) => {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
      return () => gradientStub;
    }
    return () => undefined;
  },
  set: () => true,
});

export const frame = (over: Partial<FxFrame> = {}): FxFrame => ({
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
