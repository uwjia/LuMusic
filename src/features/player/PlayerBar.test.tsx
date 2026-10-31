// Behavior tests for the transport bar (store + api mocked at the seam).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api';
import type { PlayerState, Track } from '@/types/track';
import { usePlayerStore } from '@/stores/playerStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { DEFAULT_EQ, useEqualizerStore } from '@/stores/equalizerStore';
import { SILENT_FRAME, useSpectrumStore } from '@/stores/spectrumStore';
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

  it('lyrics toggle sits left of the play mode button and flips the page flag', () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const lyricsBtn = screen.getByTestId('lyrics-toggle');
    const modeBtn = screen.getByTestId('play-mode-btn');
    // Entry requirement: the lyrics button is placed before the mode button.
    expect(lyricsBtn.compareDocumentPosition(modeBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('spectrum toggle opens the panel and is mutually exclusive with the EQ panel', async () => {
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const eqBtn = screen.getByTestId('eq-toggle');
    const spectrumBtn = screen.getByTestId('spectrum-toggle');
    expect(spectrumBtn).toHaveAttribute('aria-label', 'Show spectrum');
    expect(screen.queryByTestId('spectrum-panel')).not.toBeInTheDocument();

    // Open the EQ first, then the spectrum: only the spectrum stays open.
    fireEvent.click(eqBtn);
    expect(screen.getByTestId('eq-panel')).toBeInTheDocument();
    fireEvent.click(spectrumBtn);
    expect(await screen.findByTestId('spectrum-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('eq-panel')).not.toBeInTheDocument();
    expect(useSpectrumStore.getState().open).toBe(true);
    expect(useEqualizerStore.getState().open).toBe(false);
    expect(api.onSpectrum).toHaveBeenCalledTimes(1); // panel subscribes on mount

    // And back: reopening the EQ closes the spectrum.
    fireEvent.click(screen.getByTestId('eq-toggle'));
    expect(screen.getByTestId('eq-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('spectrum-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('spectrum-toggle'));
    expect(screen.getByTestId('spectrum-toggle')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('spectrum-toggle'));
    expect(useSpectrumStore.getState().open).toBe(false);
    expect(screen.queryByTestId('spectrum-panel')).not.toBeInTheDocument();
  });

  it('volume slider commits on release', async () => {
    vi.mocked(api.playerSetVolume).mockResolvedValue(state({ volume: 0.9 }));
    usePlayerStore.setState({ state: state() });
    render(<PlayerBar />);
    const slider = screen.getByTestId('volume-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.9' } });
    fireEvent.pointerUp(slider);
    await vi.waitFor(() => expect(api.playerSetVolume).toHaveBeenCalledWith(0.9));
  });

  it('mouse wheel over the volume slider adjusts volume through the api', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.playerSetVolume).mockResolvedValue(state({ volume: 0.55 }));
      usePlayerStore.setState({ state: state({ volume: 0.5 }) });
      render(<PlayerBar />);
      fireEvent.wheel(screen.getByTestId('volume-slider'), { deltaY: -120 });
      await act(async () => {
        vi.advanceTimersByTime(120);
      });
      expect(api.playerSetVolume).toHaveBeenCalledWith(0.55);
    } finally {
      vi.useRealTimers();
    }
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
