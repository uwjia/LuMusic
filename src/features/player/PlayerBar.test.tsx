// Behavior tests for the transport bar (store + api mocked at the seam).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api';
import type { PlayerState, Track } from '@/types/track';
import { usePlayerStore } from '@/stores/playerStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { DEFAULT_EQ, useEqualizerStore } from '@/stores/equalizerStore';
import { SILENT_FRAME, useSpectrumStore } from '@/stores/spectrumStore';
import { useArtEffectStore } from '@/stores/artEffectStore';
import { PlayerBar } from '@/features/player/PlayerBar';

vi.mock('@/api', () => ({
  api: {
    playerState: vi.fn(),
    playerToggle: vi.fn(),
    playerPause: vi.fn(),
    playerResume: vi.fn(),
    playerStop: vi.fn(),
    playerNext: vi.fn(),
    playerPrev: vi.fn(),
    playerSeek: vi.fn(),
    playerSetVolume: vi.fn(),
    playerSetMode: vi.fn(),
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    onSpectrum: vi.fn(() => () => {}),
  },
}));

const track: Track = {
  id: 't1',
  title: 'Blue Horizon',
  artist: 'Nova Fields',
  album: 'Aurora',
  albumArtist: null,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  durationSecs: 205,
  filePath: 'C:/m/t1.mp3',
  sizeBytes: 1,
};

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  status: 'playing',
  currentTrack: track,
  queuePosition: 0,
  queueLen: 1,
  positionSecs: 42,
  durationSecs: 205,
  volume: 0.5,
  shuffle: false,
  repeat: 'off',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ state: null, error: null });
  useLyricsStore.setState({ open: false });
  useEqualizerStore.setState({ open: false, eq: DEFAULT_EQ, loaded: false, error: null });
  useSpectrumStore.setState({ open: false, frame: [...SILENT_FRAME] });
  useArtEffectStore.setState({ open: false, effect: 'off' });
  vi.mocked(api.settingsGet).mockResolvedValue({
    volume: 0.5,
    lastFolder: null,
    closeToTray: true,
    eq: DEFAULT_EQ,
  });
});

describe('PlayerBar', () => {
  it('shows a placeholder while no state is loaded', () => {
    render(<PlayerBar />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('displays now-playing metadata and formatted times', () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    expect(screen.getByTestId('now-playing')).toHaveTextContent('Blue Horizon');
    expect(screen.getByTestId('now-playing')).toHaveTextContent('Nova Fields');
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(screen.getByText('3:25')).toBeInTheDocument();
  });

  it('play button toggles playback through the api', async () => {
    vi.mocked(api.playerToggle).mockResolvedValue(state({ status: 'paused' }));
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    fireEvent.click(screen.getByTestId('play-toggle'));
    await vi.waitFor(() => expect(api.playerToggle).toHaveBeenCalledTimes(1));
  });

  it('next button calls playerNext', async () => {
    vi.mocked(api.playerNext).mockResolvedValue(state());
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    await vi.waitFor(() => expect(api.playerNext).toHaveBeenCalled());
  });

  it('play mode button shows the current mode and advances it through the api', async () => {
    vi.mocked(api.playerSetMode).mockResolvedValue(state({ shuffle: false, repeat: 'all' }));
    usePlayerStore.setState({ state: state({ shuffle: false, repeat: 'off' }) });
    render(<PlayerBar />);
    const modeBtn = screen.getByTestId('play-mode-btn');
    expect(modeBtn).toHaveAttribute('aria-label', 'Sequential play');
    expect(modeBtn).not.toHaveClass('is-active');
    // Sequential mode is drawn as the list-play SVG icon, not a text glyph.
    expect(modeBtn.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(modeBtn);
    await vi.waitFor(() =>
      expect(api.playerSetMode).toHaveBeenCalledWith(false, 'all'),
    );
  });

  it('shuffle mode lights the button up and clicking returns to sequential', async () => {
    vi.mocked(api.playerSetMode).mockResolvedValue(state({ shuffle: false, repeat: 'off' }));
    usePlayerStore.setState({ state: state({ shuffle: true, repeat: 'all' }) });
    render(<PlayerBar />);
    const modeBtn = screen.getByTestId('play-mode-btn');
    expect(modeBtn).toHaveClass('is-active');
    expect(modeBtn).toHaveAttribute('aria-label', 'Shuffle');
    // All modes render the unified SVG family, never a text/emoji glyph.
    expect(modeBtn.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(modeBtn);
    await vi.waitFor(() => expect(api.playerSetMode).toHaveBeenCalledWith(false, 'off'));
  });

  it('lyrics toggle mirrors the play mode button around the cluster and flips the page flag', () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const lyricsBtn = screen.getByTestId('lyrics-toggle');
    const modeBtn = screen.getByTestId('play-mode-btn');
    // 2+2 symmetry pin: the mode button is the left flank, the lyrics
    // button the right flank of the transport cluster.
    expect(modeBtn.compareDocumentPosition(lyricsBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lyricsBtn).toHaveAttribute('aria-label', 'Show lyrics');
    expect(lyricsBtn).toHaveAttribute('aria-pressed', 'false');
    expect(lyricsBtn.querySelector('svg')).toBeInTheDocument();

    fireEvent.click(lyricsBtn);
    expect(useLyricsStore.getState().open).toBe(true);
    expect(screen.getByTestId('lyrics-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lyrics-toggle')).toHaveAttribute('aria-label', 'Hide lyrics');
    expect(screen.getByTestId('lyrics-toggle')).toHaveClass('is-active');

    fireEvent.click(screen.getByTestId('lyrics-toggle'));
    expect(useLyricsStore.getState().open).toBe(false);
  });

  it('centers a 2+2 symmetric cluster; audio panels dock right of it', () => {
    // Layout pin: the play button sits exactly at the cluster center with
    // two buttons on each side (mode/prev left, next/lyrics right), while
    // the EQ/spectrum/fx toggles live in the right-hand dock between
    // transport and volume — not mixed into the transport row.
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);

    const cluster = screen.getByTestId('play-toggle').closest('.transport-buttons')!;
    const clusterLabels = [...cluster.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(clusterLabels).toEqual([
      'Sequential play',
      'Previous track',
      'Pause',
      'Next track',
      'Show lyrics',
    ]);

    const dock = screen.getByTestId('eq-toggle').closest('.bar-tools')!;
    expect([...dock.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'eq-toggle',
      'spectrum-toggle',
      'fx-toggle',
      'volume-toggle',
    ]);

    const transport = screen.getByTestId('play-toggle').closest('.transport')!;
    expect(
      transport.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('volume toggle opens the vertical fader popover and commits on release', async () => {
    vi.mocked(api.playerSetVolume).mockResolvedValue(state({ volume: 0.9 }));
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);

    fireEvent.click(screen.getByTestId('volume-toggle'));
    expect(screen.getByTestId('volume-toggle')).toHaveAttribute('aria-pressed', 'true');
    const slider = screen.getByTestId('volume-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.9' } });
    fireEvent.pointerUp(slider);
    await vi.waitFor(() => expect(api.playerSetVolume).toHaveBeenCalledWith(0.9));
    // The percent mirror follows the committed value.
    await waitFor(() => expect(screen.getByText('90%')).toBeInTheDocument());

    // Clicking the toggle again closes the popover.
    fireEvent.click(screen.getByTestId('volume-toggle'));
    expect(screen.queryByTestId('volume-popover')).not.toBeInTheDocument();
  });

  it('mouse wheel over the speaker button nudges volume without opening the popover', async () => {
    // Zero-click path: hovering the icon and scrolling is enough; the
    // debounced wheel handler collapses a burst into one api call.
    vi.useFakeTimers();
    try {
      vi.mocked(api.playerSetVolume).mockResolvedValue(state({ volume: 0.55 }));
      usePlayerStore.setState({ state: state({ volume: 0.5 }) });
      render(<PlayerBar />);
      fireEvent.wheel(screen.getByTestId('volume-toggle'), { deltaY: -120 });
      await act(async () => {
        vi.advanceTimersByTime(120);
      });
      expect(api.playerSetVolume).toHaveBeenCalledWith(0.55);
      expect(screen.queryByTestId('volume-popover')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('speaker glyph reflects the volume level', () => {
    const { rerender } = render(<PlayerBar />);
    usePlayerStore.setState({ state: state({ volume: 0 }) });
    rerender(<PlayerBar />);
    expect(screen.getByTestId('volume-toggle')).toHaveAttribute('data-volume-level', 'mute');

    usePlayerStore.setState({ state: state({ volume: 0.3 }) });
    rerender(<PlayerBar />);
    expect(screen.getByTestId('volume-toggle')).toHaveAttribute('data-volume-level', 'low');

    usePlayerStore.setState({ state: state({ volume: 0.8 }) });
    rerender(<PlayerBar />);
    expect(screen.getByTestId('volume-toggle')).toHaveAttribute('data-volume-level', 'high');
  });

  it('volume popover is mutually exclusive with the audio panels and closes on Escape', () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);

    // Opening the spectrum takes over the popover slot (the overlay
    // itself mounts in App's content area, so assert the store flag).
    fireEvent.click(screen.getByTestId('volume-toggle'));
    expect(screen.getByTestId('volume-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('spectrum-toggle'));
    expect(screen.queryByTestId('volume-popover')).not.toBeInTheDocument();
    expect(useSpectrumStore.getState().open).toBe(true);

    // Reopening the volume then closes the spectrum; Escape dismisses.
    fireEvent.click(screen.getByTestId('volume-toggle'));
    expect(useSpectrumStore.getState().open).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('volume-popover')).not.toBeInTheDocument();
  });

  it('equalizer toggle opens a panel that loads settings, and closes again', async () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const eqBtn = screen.getByTestId('eq-toggle');
    expect(eqBtn).toHaveAttribute('aria-label', 'Show equalizer');
    expect(eqBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('eq-panel')).not.toBeInTheDocument();

    fireEvent.click(eqBtn);
    expect(useEqualizerStore.getState().open).toBe(true);
    expect(await screen.findByTestId('eq-panel')).toBeInTheDocument();
    expect(api.settingsGet).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('eq-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('eq-toggle')).toHaveAttribute('aria-label', 'Hide equalizer');
    expect(screen.getByTestId('eq-toggle')).toHaveClass('is-active');

    fireEvent.click(screen.getByTestId('eq-toggle'));
    expect(useEqualizerStore.getState().open).toBe(false);
    expect(screen.queryByTestId('eq-panel')).not.toBeInTheDocument();
  });

  it('spectrum toggle flips the overlay flag and is mutually exclusive with the EQ panel', () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const eqBtn = screen.getByTestId('eq-toggle');
    const spectrumBtn = screen.getByTestId('spectrum-toggle');
    expect(spectrumBtn).toHaveAttribute('aria-label', 'Show spectrum');
    expect(useSpectrumStore.getState().open).toBe(false);

    // Open the EQ first, then the spectrum: only the spectrum stays open.
    // (The overlay itself mounts in App's content area, so the store
    // flag is this bar's whole contract; mounting lives in App tests.)
    fireEvent.click(eqBtn);
    expect(screen.getByTestId('eq-panel')).toBeInTheDocument();
    fireEvent.click(spectrumBtn);
    expect(useSpectrumStore.getState().open).toBe(true);
    expect(screen.queryByTestId('eq-panel')).not.toBeInTheDocument();
    expect(useEqualizerStore.getState().open).toBe(false);

    // And back: reopening the EQ closes the spectrum.
    fireEvent.click(screen.getByTestId('eq-toggle'));
    expect(screen.getByTestId('eq-panel')).toBeInTheDocument();
    expect(useSpectrumStore.getState().open).toBe(false);

    fireEvent.click(screen.getByTestId('spectrum-toggle'));
    expect(screen.getByTestId('spectrum-toggle')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('spectrum-toggle'));
    expect(useSpectrumStore.getState().open).toBe(false);
  });

  it('art effects toggle opens the picker and is mutually exclusive with EQ and spectrum', async () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const fxBtn = screen.getByTestId('fx-toggle');
    expect(fxBtn).toHaveAttribute('aria-label', 'Show art effects');
    expect(fxBtn).toHaveAttribute('aria-pressed', 'false');
    expect(fxBtn.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByTestId('fx-panel')).not.toBeInTheDocument();

    // Opening the spectrum first, then fx: only fx stays open.
    fireEvent.click(screen.getByTestId('spectrum-toggle'));
    expect(useSpectrumStore.getState().open).toBe(true);
    fireEvent.click(fxBtn);
    expect(await screen.findByTestId('fx-panel')).toBeInTheDocument();
    expect(useSpectrumStore.getState().open).toBe(false);
    expect(screen.getByTestId('fx-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('fx-toggle')).toHaveAttribute('aria-label', 'Hide art effects');
    expect(screen.getByTestId('fx-toggle')).toHaveClass('is-active');

    // The EQ takes over in the same way, and the button toggles back off.
    fireEvent.click(screen.getByTestId('eq-toggle'));
    expect(screen.getByTestId('eq-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('fx-panel')).not.toBeInTheDocument();
    expect(useArtEffectStore.getState().open).toBe(false);

    fireEvent.click(screen.getByTestId('fx-toggle'));
    expect(await screen.findByTestId('fx-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fx-toggle'));
    expect(useArtEffectStore.getState().open).toBe(false);
    expect(screen.queryByTestId('fx-panel')).not.toBeInTheDocument();
  });

  it('seek slider commits the dragged position', async () => {
    vi.mocked(api.playerSeek).mockResolvedValue(state({ positionSecs: 100 }));
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const slider = screen.getByTestId('seek-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '100' } });
    fireEvent.pointerUp(slider);
    await vi.waitFor(() => expect(api.playerSeek).toHaveBeenCalledWith(100));
  });

  it('renders store errors as an alert', () => {
    usePlayerStore.setState({ state: state(), error: 'boom' });
    render(<PlayerBar />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
