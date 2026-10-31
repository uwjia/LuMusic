// Behavior tests for the equalizer popover: preset selection, band slider
// commits, the enable switch and error surfacing — all through the api seam.
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api';
import type { Settings } from '@/types/track';
import { DEFAULT_EQ, useEqualizerStore } from '@/stores/equalizerStore';
import { EqualizerPanel } from '@/features/player/EqualizerPanel';

vi.mock('@/api', () => ({
  api: {
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
  },
}));

const settingsWith = (eq: Settings['eq']): Settings => ({
  volume: 0.8,
  lastFolder: null,
  closeToTray: true,
  eq,
});

const ROCK_GAINS = [5, 4, 3, 1, -1, -1, 1, 3, 4, 5];
const rock = { enabled: true, preampDb: 0, gainsDb: ROCK_GAINS };

beforeEach(() => {
  vi.clearAllMocks();
  useEqualizerStore.setState({
    open: true,
    eq: DEFAULT_EQ,
    loaded: false,
    error: null,
  });
  vi.mocked(api.settingsGet).mockResolvedValue(settingsWith(DEFAULT_EQ));
  vi.mocked(api.settingsSet).mockImplementation(async (patch) =>
    settingsWith(patch.eq ?? DEFAULT_EQ),
  );
});

// The panel only needs a placeholder anchor ref (outside-press exclusion).
const anchor = { current: null };

describe('EqualizerPanel', () => {
  it('shows ten band sliders plus preamp with flat defaults', async () => {
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    for (let band = 0; band < 10; band++) {
      expect(screen.getByTestId(`eq-band-${band}`)).toBeDisabled(); // eq off
    }
    expect(screen.getByTestId('eq-preamp')).toBeDisabled();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.getByText('16k')).toBeInTheDocument();
  });

  it('selecting a preset applies its full gain curve', async () => {
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    fireEvent.change(screen.getByTestId('eq-preset'), { target: { value: 'rock' } });
    await vi.waitFor(() =>
      expect(api.settingsSet).toHaveBeenCalledWith({
        eq: expect.objectContaining({ gainsDb: ROCK_GAINS }),
      }),
    );
  });

  it('enabling the eq unlocks the sliders and persists the switch', async () => {
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    fireEvent.click(screen.getByTestId('eq-enable'));
    await vi.waitFor(() =>
      expect(api.settingsSet).toHaveBeenCalledWith({
        eq: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(screen.getByTestId('eq-band-0')).toBeEnabled();
  });

  it('dragging a band slider commits once on release', async () => {
    useEqualizerStore.setState({ eq: { ...DEFAULT_EQ, enabled: true } });
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    const slider = screen.getByTestId('eq-band-0') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '8' } });
    // No backend call before release (drag-safe commit semantics).
    expect(api.settingsSet).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    await vi.waitFor(() => {
      const sent = vi.mocked(api.settingsSet).mock.calls[0][0].eq;
      expect(sent?.gainsDb[0]).toBe(8);
      expect(sent?.gainsDb).toHaveLength(10);
    });
  });

  it('clamps out-of-range slider values like the backend', async () => {
    useEqualizerStore.setState({ eq: { ...DEFAULT_EQ, enabled: true } });
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    const slider = screen.getByTestId('eq-band-2') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '99' } });
    fireEvent.pointerUp(slider);
    await vi.waitFor(() =>
      expect(vi.mocked(api.settingsSet).mock.calls[0][0].eq?.gainsDb[2]).toBe(12),
    );
  });

  it('preamp slider commits its value', async () => {
    useEqualizerStore.setState({ eq: { ...DEFAULT_EQ, enabled: true } });
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    const preamp = screen.getByTestId('eq-preamp') as HTMLInputElement;
    fireEvent.change(preamp, { target: { value: '-4' } });
    fireEvent.pointerUp(preamp);
    await vi.waitFor(() =>
      expect(api.settingsSet).toHaveBeenCalledWith({
        eq: expect.objectContaining({ preampDb: -4 }),
      }),
    );
  });

  it('reset restores a flat curve (keeping the switch as-is)', async () => {
    // Panel load() must agree with the seeded curve (backend is the source
    // of truth and would otherwise overwrite the store on mount).
    vi.mocked(api.settingsGet).mockResolvedValue(settingsWith(rock));
    useEqualizerStore.setState({ eq: rock });
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() =>
      expect(api.settingsSet).toHaveBeenCalledWith({
        eq: expect.objectContaining({
          enabled: true,
          preampDb: 0,
          gainsDb: Array(10).fill(0),
        }),
      }),
    );
  });

  it('shows Custom when the curve matches no preset', async () => {
    const custom = { enabled: true, preampDb: 0, gainsDb: [0, 0, 0, 3, 0, 0, 0, 0, 0, 0] };
    vi.mocked(api.settingsGet).mockResolvedValue(settingsWith(custom));
    useEqualizerStore.setState({ eq: custom });
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    expect(screen.getByTestId('eq-preset')).toHaveValue('custom');
    expect(screen.getByRole('option', { name: 'Custom' })).toBeInTheDocument();
  });

  it('loads persisted settings on mount', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue(settingsWith(rock));
    render(<EqualizerPanel anchorRef={anchor} />);
    await vi.waitFor(() =>
      expect(useEqualizerStore.getState().eq.gainsDb).toEqual(rock.gainsDb),
    );
  });

  it('surfaces backend errors as an alert and reverts the curve', async () => {
    vi.mocked(api.settingsSet).mockRejectedValue(new Error('boom'));
    render(<EqualizerPanel anchorRef={anchor} />);
    await screen.findByTestId('eq-panel');
    fireEvent.click(screen.getByTestId('eq-enable'));
    expect(await screen.findByTestId('eq-error')).toHaveTextContent('boom');
    expect(useEqualizerStore.getState().eq.enabled).toBe(false);
  });
});
