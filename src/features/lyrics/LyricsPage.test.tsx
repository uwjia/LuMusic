// Lyrics page behavior (api mocked at the seam; stores seeded via setState).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api';
import type { Lyrics, PlayerState, Track } from '@/types/track';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { LyricsPage } from '@/features/lyrics/LyricsPage';

vi.mock('@/api', () => ({
  api: {
    lyricsGet: vi.fn(),
    playerSeek: vi.fn(),
  },
}));

const track: Track = {
  id: 't1',
  title: 'I Will Do',
  artist: 'Pierre',
  album: 'Booom 2003 The First',
  albumArtist: null,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  durationSecs: 205,
  filePath: 'C:/Data/Music/吸血鬼日记/will_do.mp3',
  sizeBytes: 1,
};

// Mirrors the real will_do.lrc (multi-tag chorus stripped down for brevity):
// sorted times, an empty-text interlude, English text.
const lyrics: Lyrics = {
  sourcePath: 'C:/Data/Music/吸血鬼日记/will_do.lrc',
  lines: [
    { timeMs: 760, text: 'I will do do do do do' },
    { timeMs: 3_100, text: "I'll do anything for you" },
    { timeMs: 11_160, text: '' },
    { timeMs: 11_980, text: 'I can feel my heart' },
  ],
};

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  status: 'playing',
  currentTrack: track,
  queuePosition: 0,
  queueLen: 1,
  positionSecs: 1,
  durationSecs: 205,
  volume: 0.5,
  shuffle: false,
  repeat: 'off',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ state: null, error: null });
  useLyricsStore.setState({
    open: true,
    trackId: null,
    lines: [],
    sourcePath: null,
    status: 'idle',
    error: null,
  });
});

describe('LyricsPage', () => {
  it('shows a placeholder while nothing is playing', () => {
    render(<LyricsPage />);
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.getByText('Start a track to see its lyrics.')).toBeInTheDocument();
    expect(api.lyricsGet).not.toHaveBeenCalled();
  });

  it('loads lyrics for the current track and shows the source file', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
    usePlayerStore.setState({ state: state() });
    render(<LyricsPage />);
    expect(await screen.findByText("I'll do anything for you")).toBeInTheDocument();
    expect(api.lyricsGet).toHaveBeenCalledWith('t1');
    expect(screen.getByText('I Will Do')).toBeInTheDocument();
    expect(screen.getByText('Pierre')).toBeInTheDocument();
    expect(screen.getByText(lyrics.sourcePath!)).toBeInTheDocument();
  });

  it('highlights the line sung at the current position', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
    usePlayerStore.setState({ state: state({ positionSecs: 4 }) });
    render(<LyricsPage />);
    await screen.findByText('I can feel my heart'); // lyrics arrived
    const lineButtons = screen.getAllByTestId('lyrics-line');
    expect(lineButtons).toHaveLength(3); // interlude is not a button
    expect(lineButtons[0]).not.toHaveClass('is-active');
    expect(lineButtons[1]).toHaveClass('is-active');
    expect(lineButtons[2]).not.toHaveClass('is-active');
  });

  it('renders interludes as non-interactive spacers', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
    usePlayerStore.setState({ state: state() });
    render(<LyricsPage />);
    await screen.findByText('I can feel my heart');
    const body = screen.getByTestId('lyrics-body');
    expect(body.querySelector('.lyrics-spacer')).toBeInTheDocument();
  });

  it('auto-scroll centers the active line by scrolling only the lyrics container', async () => {
    // Regression guard for the clipped top area: scrollIntoView also
    // scrolls overflow:hidden ancestors, which pushed the page header
    // (title / artist / source / close) out of view. Both APIs are absent
    // in jsdom, so stub them on the prototype BEFORE render — the body
    // only mounts in the ready branch, per-instance patching is too late.
    const scrollTo = vi.fn();
    const scrollIntoView = vi.fn();
    const proto = Element.prototype as unknown as {
      scrollTo?: (opts?: ScrollToOptions) => void;
      scrollIntoView?: (opts?: ScrollIntoViewOptions) => void;
    };
    proto.scrollTo = scrollTo;
    proto.scrollIntoView = scrollIntoView;

    try {
      vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
      usePlayerStore.setState({ state: state({ positionSecs: 12 }) });
      render(<LyricsPage />);

      await screen.findByText('I can feel my heart');
      await waitFor(() => expect(scrollTo).toHaveBeenCalled());
      const [options] = scrollTo.mock.calls[0] as [{ top: number; behavior: string }];
      expect(typeof options.top).toBe('number');
      expect(options.behavior).toBe('smooth');
      // The ancestor-scrolling API must never be used here.
      expect(scrollIntoView).not.toHaveBeenCalled();
      // Header stays mounted above the scroller (not scrolled away).
      expect(screen.getByTestId('lyrics-close')).toBeInTheDocument();
    } finally {
      delete proto.scrollTo;
      delete proto.scrollIntoView;
    }
  });

  it('clicking a line seeks the player to its timestamp', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
    vi.mocked(api.playerSeek).mockResolvedValue(state({ positionSecs: 3.1 }));
    usePlayerStore.setState({ state: state() });
    render(<LyricsPage />);
    fireEvent.click(await screen.findByText("I'll do anything for you"));
    await waitFor(() => expect(api.playerSeek).toHaveBeenCalledWith(3.1));
  });

  it('missing lyrics show actionable guidance', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(null);
    usePlayerStore.setState({ state: state() });
    render(<LyricsPage />);
    expect(await screen.findByText('No lyrics found')).toBeInTheDocument();
    expect(screen.getByText(/\.lrc file with the same name/)).toBeInTheDocument();
  });

  it('api failures render as an alert', async () => {
    vi.mocked(api.lyricsGet).mockRejectedValue(new Error('disk melted'));
    usePlayerStore.setState({ state: state() });
    render(<LyricsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('disk melted');
  });

  it('the close button hides the page', async () => {
    vi.mocked(api.lyricsGet).mockResolvedValue(lyrics);
    usePlayerStore.setState({ state: state() });
    render(<LyricsPage />);
    const closeBtn = screen.getByTestId('lyrics-close');
    // Same glyph family as the player-bar toggle (SVG icon, not a text ✕).
    expect(closeBtn.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(useLyricsStore.getState().open).toBe(false);
  });
});
