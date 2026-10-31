// Behavior tests for the art background: mount semantics per effect,
// spectrum subscription lifecycle and single-canvas stability across
// preset switches (painting itself is untestable in jsdom — see the
// SpectrumPanel convention — so the canvas context is stubbed and only
// the data flow is asserted).
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { api } from '@/api';
import { useArtEffectStore } from '@/stores/artEffectStore';
import { ArtBackground } from '@/features/lyrics/ArtBackground';

let unsubscribed = false;

vi.mock('@/api', () => ({
  api: {
    onSpectrum: vi.fn(() => () => {
      unsubscribed = true;
    }),
  },
}));

// Chainable no-op context: every method call is swallowed, gradient
// factories return an addColorStop stub.
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

beforeEach(() => {
  vi.clearAllMocks();
  unsubscribed = false;
  useArtEffectStore.setState({ open: false, effect: 'off' });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub);
});

describe('ArtBackground', () => {
  it('renders nothing while the effect is off', () => {
    render(<ArtBackground />);
    expect(screen.queryByTestId('art-bg')).not.toBeInTheDocument();
    expect(api.onSpectrum).not.toHaveBeenCalled();
  });

  it('mounts a labeled canvas and subscribes while an effect is selected', () => {
    useArtEffectStore.setState({ effect: 'aurora' });
    render(<ArtBackground />);
    expect(screen.getByTestId('art-bg')).toBeInTheDocument();
    expect(screen.getByTestId('art-bg-canvas')).toHaveAttribute(
      'aria-label',
      'Artistic background effect',
    );
    expect(api.onSpectrum).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly one canvas when switching presets', () => {
    useArtEffectStore.setState({ effect: 'aurora' });
    const { rerender } = render(<ArtBackground />);
    useArtEffectStore.setState({ effect: 'starfield' });
    rerender(<ArtBackground />);
    expect(screen.getAllByTestId('art-bg-canvas')).toHaveLength(1);
    useArtEffectStore.setState({ effect: 'off' });
    rerender(<ArtBackground />);
    expect(screen.queryByTestId('art-bg')).not.toBeInTheDocument();
  });

  it('unsubscribes and stops painting on unmount', () => {
    useArtEffectStore.setState({ effect: 'wave' });
    const { unmount } = render(<ArtBackground />);
    expect(api.onSpectrum).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribed).toBe(true);
  });
});
