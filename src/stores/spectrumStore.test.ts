import { beforeEach, describe, expect, it } from 'vitest';
import { SILENT_FRAME, useSpectrumStore } from '@/stores/spectrumStore';
import { SPECTRUM_BARS } from '@/types/track';

beforeEach(() => {
  useSpectrumStore.setState({ open: false, frame: [...SILENT_FRAME] });
});

describe('spectrumStore', () => {
  it('starts silent with the full bar count', () => {
    const state = useSpectrumStore.getState();
    expect(state.open).toBe(false);
    expect(state.frame).toHaveLength(SPECTRUM_BARS);
    expect(state.frame.every((bar) => bar === 0)).toBe(true);
  });

  it('applyFrame stores the latest (truncated) frame', () => {
    const frame = Array.from({ length: SPECTRUM_BARS + 5 }, (_, i) => (i % 10) / 10);
    useSpectrumStore.getState().applyFrame(frame);
    const stored = useSpectrumStore.getState().frame;
    expect(stored).toHaveLength(SPECTRUM_BARS);
    expect(stored[0]).toBe(0);
    expect(stored).toEqual(frame.slice(0, SPECTRUM_BARS));
  });

  it('toggle flips panel visibility', () => {
    useSpectrumStore.getState().toggle();
    expect(useSpectrumStore.getState().open).toBe(true);
    useSpectrumStore.getState().setOpen(false);
    expect(useSpectrumStore.getState().open).toBe(false);
  });
});
