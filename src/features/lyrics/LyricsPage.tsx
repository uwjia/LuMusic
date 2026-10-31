// Lyrics page: synced, auto-scrolling lines for the current track.
// Mounts while the lyrics store reports `open` (toggled from the player
// bar); reloading follows track changes. Clicking a line seeks to it.

import { useEffect, useRef } from 'react';
import { ArtBackground } from '@/features/lyrics/ArtBackground';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { LyricsIcon, SourceFileIcon } from '@/features/lyrics/LyricsIcons';
import { formatDuration } from '@/lib/format';
import { activeLyricIndex } from '@/lib/lyrics';
import { useTranslation } from '@/i18n';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';

export function LyricsPage() {
  const { t } = useTranslation();
  const track = usePlayerStore((s) => s.state?.currentTrack ?? null);
  const positionSecs = usePlayerStore((s) => s.state?.positionSecs ?? 0);
  const status = useLyricsStore((s) => s.status);
  const lines = useLyricsStore((s) => s.lines);
  const sourcePath = useLyricsStore((s) => s.sourcePath);
  const error = useLyricsStore((s) => s.error);
  const load = useLyricsStore((s) => s.load);
  const setOpen = useLyricsStore((s) => s.setOpen);
  const seek = usePlayerStore.getState().seek;

  // (Re)load whenever the current track changes while the page is mounted;
  // `null` (playback stopped) resets the store to idle.
  const trackId = track?.id ?? null;
  useEffect(() => {
    void load(trackId);
  }, [load, trackId]);

  const active = activeLyricIndex(lines, positionSecs);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    const line = activeRef.current;
    // Keep the sung line vertically centered — but only by scrolling the
    // lyrics container itself. `Element.scrollIntoView` additionally
    // scrolls every scrollable ANCESTOR (the overflow:hidden page shell
    // answers to script scrolling too), which pushed the page header —
    // the top area — out of view and made it look clipped. Manual math
    // keeps the scroll contained. jsdom has no element scrolling, hence
    // the feature check.
    if (!body || !line || typeof body.scrollTo !== 'function') return;
    const bodyTop = body.getBoundingClientRect().top;
    const lineRect = line.getBoundingClientRect();
    const delta = lineRect.top - bodyTop - (body.clientHeight - lineRect.height) / 2;
    body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
  }, [active]);

  return (
    <section className="page lyrics-page" data-testid="lyrics-page">
      <ArtBackground />
      <header className="page-header">
        <div className="lyrics-meta">
          <h2 className="lyrics-track">{track ? track.title : t('lyrics.title')}</h2>
          <div className="lyrics-artist">
            {track ? (track.artist ?? t('player.unknownArtist')) : ''}
          </div>
          {sourcePath ? (
            <div className="lyrics-source" title={sourcePath}>
              <SourceFileIcon />
              <span className="lyrics-source-path">{sourcePath}</span>
            </div>
          ) : null}
        </div>
        <IconButton
          label={t('lyrics.close')}
          data-testid="lyrics-close"
          onClick={() => setOpen(false)}
        >
          {/* Same glyph as the player-bar toggle: one icon = one feature. */}
          <LyricsIcon />
        </IconButton>
      </header>

      {!track ? (
        <EmptyState title={t('lyrics.nothingPlaying')} hint={t('lyrics.nothingPlayingHint')} />
      ) : status === 'loading' ? (
        <EmptyState title={t('lyrics.loading')} />
      ) : status === 'missing' ? (
        <EmptyState title={t('lyrics.noLyrics')} hint={t('lyrics.noLyricsHint')} />
      ) : status === 'error' ? (
        <div className="page-error" role="alert" data-testid="lyrics-error">
          {error}
        </div>
      ) : (
        <div ref={bodyRef} className="lyrics-body" data-testid="lyrics-body">
          {lines.map((line, index) =>
            line.text.trim() === '' ? (
              // Interlude marker from an empty LRC line: a quiet gap.
              <div key={index} className="lyrics-spacer" aria-hidden />
            ) : (
              <button
                key={index}
                type="button"
                ref={
                  index === active
                    ? (el) => {
                        activeRef.current = el;
                      }
                    : undefined
                }
                className={`lyrics-line${index === active ? ' is-active' : ''}`}
                data-testid="lyrics-line"
                title={t('lyrics.seekTo', { time: formatDuration(line.timeMs / 1000) })}
                onClick={() => void seek(line.timeMs / 1000)}
              >
                {line.text}
              </button>
            ),
          )}
        </div>
      )}
    </section>
  );
}
