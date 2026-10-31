// Behavior tests for the spectrum popover: subscription lifecycle, canvas
// presence, the live/idle status text and the pinned "stays open" rule
// (painting itself is untestable in jsdom; the data flow through the store
// is what matters).
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api';
import type { SpectrumFrame } from '@/types/track';
import { SPECTRUM_BARS } from '@/types/track';
import type { PlayerState } from '@/types/track';
import { usePlayerStore } from '@/stores/playerStore';
import { SILENT_FRAME, useSpectrumStore } from '@/stores/spectrumStore';
import { SpectrumPanel } from '@/features/player/SpectrumPanel';

let spectrumUnsubscribed = false;
const pushFrame = vi.fn();

vi.mock('@/api', () => ({
  api: {
    onSpectrum: vi.fn((cb: (frame: SpectrumFrame) => void) => {
      pushFrame.mockImplementation(() => cb(Array(SPECTRUM_BARS).fill(0.7)));
      return () => {
        spectrumUnsubscribed = true;
      };
    }),
  },
}));

const state = (status: PlayerState['status']): PlayerState => ({
  status,
  currentTrack: null,
  queuePosition: null,
  queueLen: 0,
  positionSecs: 0,
  durationSecs: null,
  volume: 0.5,
  shuffle: false,
  repeat: 'off',
});

beforeEach(() => {
  vi.clearAllMocks();
  spectrumUnsubscribed = false;
  useSpectrumStore.setState({ open: true, frame: [...SILENT_FRAME] });
  usePlayerStore.setState({ state: null, error: null });
});

describe('SpectrumPanel', () => {
  it('renders a canvas and subscribes on mount, unsubscribes on unmount', async () => {
    const { unmount } = render(<SpectrumPanel />);
    expect(await screen.findByTestId('spectrum-canvas')).toBeInTheDocument();
    expect(api.onSpectrum).toHaveBeenCalledTimes(1);
    unmount();
    expect(spectrumUnsubscribed).toBe(true);
  });

  it('pushed frames land in the store', async () => {
    render(<SpectrumPanel />);
    await screen.findByTestId('spectrum-canvas');
    pushFrame();
    expect(useSpectrumStore.getState().frame.every((bar) => bar === 0.7)).toBe(true);
  });

  it('shows the idle label when nothing plays and live while playing', async () => {
    usePlayerStore.setState({ state: state('paused') });
    const { rerender } = render(<SpectrumPanel />);
    expect(await screen.findByTestId('spectrum-status')).toHaveTextContent('Idle');

    usePlayerStore.setState({ state: state('playing') });
    rerender(<SpectrumPanel />);
    expect(screen.getByTestId('spectrum-status')).toHaveTextContent('Live');
  });

  it('stays open on outside presses and Escape (only the player-bar button closes it)', async () => {
    render(<SpectrumPanel />);
    await screen.findByTestId('spectrum-panel');

    // Outside pointer presses must not dismiss the persistent panel.
    fireEvent.pointerDown(document.body);
    expect(useSpectrumStore.getState().open).toBe(true);
    expect(screen.getByTestId('spectrum-panel')).toBeInTheDocument();

    // Neither does the Escape key: closing is the toggle button's job.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useSpectrumStore.getState().open).toBe(true);
    expect(screen.getByTestId('spectrum-panel')).toBeInTheDocument();
  });
});
