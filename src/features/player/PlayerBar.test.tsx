// Behavior tests for the transport bar (store + api mocked at the seam).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../api';
import type { PlayerState, Track } from '../../types/track';
import { usePlayerStore } from '../../stores/playerStore';
import { PlayerBar } from './PlayerBar';

vi.mock('../../api', () => ({
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

  it('cycle repeat goes off -> all and marks the button active', async () => {
    vi.mocked(api.playerSetMode).mockResolvedValue(state({ repeat: 'all' }));
    usePlayerStore.setState({ state: state({ repeat: 'off' }) });
    render(<PlayerBar />);
    const repeatBtn = screen.getByTestId('repeat-btn');
    expect(repeatBtn).not.toHaveClass('is-active');
    fireEvent.click(repeatBtn);
    await vi.waitFor(() =>
      expect(api.playerSetMode).toHaveBeenCalledWith(false, 'all'),
    );
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
