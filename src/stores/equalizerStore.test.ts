import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { Settings } from '@/types/track';
import { DEFAULT_EQ, useEqualizerStore } from '@/stores/equalizerStore';

vi.mock('@/api', () => ({
  api: {
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
  },
}));

const settings = (eq: Settings['eq']): Settings => ({
  volume: 0.8,
  lastFolder: null,
  closeToTray: true,
  eq,
});

beforeEach(() => {
  vi.clearAllMocks();
  useEqualizerStore.setState({
    open: false,
    eq: DEFAULT_EQ,
    loaded: false,
    error: null,
  });
});

describe('equalizerStore', () => {
  it('loads persisted EQ settings through the api', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue(
      settings({ enabled: true, preampDb: -3, gainsDb: [4, 2, 0, 0, 0, 0, 0, 0, 2, 4] }),
    );
    await useEqualizerStore.getState().load();
    const state = useEqualizerStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.eq.enabled).toBe(true);
    expect(state.eq.preampDb).toBe(-3);
    expect(state.eq.gainsDb).toHaveLength(10);
  });

  it('applies patches optimistically and keeps the backend answer', async () => {
    vi.mocked(api.settingsSet).mockImplementation(async (patch) =>
      settings(patch.eq ?? DEFAULT_EQ),
    );
    await useEqualizerStore.getState().apply({ enabled: true, preampDb: 5 });
    // The full sanitized curve is sent, not just the patch.
    expect(api.settingsSet).toHaveBeenCalledWith({
      eq: {
        enabled: true,
        preampDb: 5,
        gainsDb: DEFAULT_EQ.gainsDb,
      },
    });
    expect(useEqualizerStore.getState().eq.enabled).toBe(true);
  });

  it('normalizes out-of-shape gains before sending them', async () => {
    vi.mocked(api.settingsSet).mockImplementation(async (patch) =>
      settings(patch.eq ?? DEFAULT_EQ),
    );
    await useEqualizerStore.getState().apply({ gainsDb: [99, Number.NaN, -99] });
    expect(vi.mocked(api.settingsSet).mock.calls[0][0].eq?.gainsDb).toEqual([
      12, 0, -12, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('reverts and surfaces an error when the backend rejects the update', async () => {
    const before = useEqualizerStore.getState().eq;
    vi.mocked(api.settingsSet).mockRejectedValue(new Error('boom'));
    await useEqualizerStore.getState().apply({ enabled: true });
    const state = useEqualizerStore.getState();
    expect(state.eq).toEqual(before);
    expect(state.error).toBe('boom');
  });

  it('toggle flips panel visibility', () => {
    expect(useEqualizerStore.getState().open).toBe(false);
    useEqualizerStore.getState().toggle();
    expect(useEqualizerStore.getState().open).toBe(true);
    useEqualizerStore.getState().setOpen(false);
    expect(useEqualizerStore.getState().open).toBe(false);
  });
});
