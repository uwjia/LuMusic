// Bottom transport bar: play controls, seek, volume, now-playing title.

import { useRef } from 'react';
import { formatDuration } from '@/lib/format';
import { Slider } from '@/components/ui/Slider';
import { IconButton } from '@/components/ui/IconButton';
import { useTranslation } from '@/i18n';
import { playModeOf, usePlayerStore, type PlayMode } from '@/stores/playerStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { useEqualizerStore } from '@/stores/equalizerStore';
import { MODE_ICON } from '@/features/player/ModeIcons';
import { LyricsIcon } from '@/features/lyrics/LyricsIcons';
import { EqualizerIcon } from '@/features/player/EqualizerIcons';
import { EqualizerPanel } from '@/features/player/EqualizerPanel';
const MODE_LABEL_KEY: Record<
  PlayMode,
  'player.modeSequential' | 'player.repeatAll' | 'player.repeatOne' | 'player.shuffle'
> = {
  sequential: 'player.modeSequential',
  repeatAll: 'player.repeatAll',
  repeatOne: 'player.repeatOne',
  shuffle: 'player.shuffle',
};

export function PlayerBar() {
  const state = usePlayerStore((s) => s.state);
  const error = usePlayerStore((s) => s.error);
  const lyricsOpen = useLyricsStore((s) => s.open);
  const eqOpen = useEqualizerStore((s) => s.open);
  const { toggle, next, prev, seek, setVolume, cyclePlayMode } = usePlayerStore.getState();
  const toggleLyrics = useLyricsStore.getState().toggle;
  const toggleEq = useEqualizerStore.getState().toggle;
  // Anchor for the popover's outside-press exclusion (the toggle button
  // itself must toggle, not close-then-reopen).
  const eqToggleRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();

  if (!state) {
    return <footer className="player-bar player-bar-empty">{t('player.loading')}</footer>;
  }

  const playing = state.status === 'playing';
  const duration = state.durationSecs ?? 0;
  const mode = playModeOf(state);

  return (
    <footer className="player-bar" data-status={state.status}>
      <div className="now-playing" data-testid="now-playing">
        {state.currentTrack ? (
          <>
            <div className="now-playing-title">{state.currentTrack.title}</div>
            <div className="now-playing-artist">
              {state.currentTrack.artist ?? t('player.unknownArtist')}
            </div>
          </>
        ) : (
          <div className="now-playing-title muted">{t('player.nothingPlaying')}</div>
        )}
      </div>

      {eqOpen ? <EqualizerPanel anchorRef={eqToggleRef} /> : null}

      <div className="transport">
        <div className="transport-buttons">
          <IconButton
            label={lyricsOpen ? t('player.hideLyrics') : t('player.showLyrics')}
            active={lyricsOpen}
            aria-pressed={lyricsOpen}
            onClick={toggleLyrics}
            data-testid="lyrics-toggle"
          >
            <LyricsIcon />
          </IconButton>
          <IconButton
            ref={eqToggleRef}
            label={eqOpen ? t('player.hideEqualizer') : t('player.showEqualizer')}
            active={eqOpen}
            aria-pressed={eqOpen}
            onClick={toggleEq}
            data-testid="eq-toggle"
          >
            <EqualizerIcon />
          </IconButton>
          <IconButton
            label={t(MODE_LABEL_KEY[mode])}
            active={mode !== 'sequential'}
            onClick={() => void cyclePlayMode()}
            data-testid="play-mode-btn"
          >
            {MODE_ICON[mode]}
          </IconButton>
          <IconButton label={t('player.prev')} onClick={() => void prev()}>
            ⏮
          </IconButton>
          <IconButton
            label={playing ? t('player.pause') : t('player.play')}
            className="play-btn"
            onClick={() => void toggle()}
            data-testid="play-toggle"
          >
            {playing ? '⏸' : '▶'}
          </IconButton>
          <IconButton label={t('player.next')} onClick={() => void next()}>
            ⏭
          </IconButton>
        </div>
        <div className="progress">
          <span className="time">{formatDuration(state.positionSecs)}</span>
          <Slider
            aria-label={t('player.seek')}
            data-testid="seek-slider"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.5}
            value={Math.min(state.positionSecs, duration)}
            disabled={!state.currentTrack}
            onCommit={(value) => void seek(value)}
          />
          <span className="time">{duration > 0 ? formatDuration(duration) : '--:--'}</span>
        </div>
      </div>

      <div className="volume">
        <span aria-hidden>🔊</span>
        <Slider
          aria-label={t('player.volume')}
          data-testid="volume-slider"
          className="volume-slider"
          min={0}
          max={1}
          step={0.01}
          wheelStep={0.05}
          value={state.volume}
          onCommit={(value) => void setVolume(value)}
        />
      </div>

      {error ? (
        <div className="player-error" role="alert" data-testid="player-error">
          {error}
        </div>
      ) : null}
    </footer>
  );
}
