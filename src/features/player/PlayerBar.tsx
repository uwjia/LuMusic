// Bottom transport bar: now-playing title, centered prev/play/next + seek,
// and a right-hand tool dock (view toggles, play mode) beside the volume.

import { useRef, useState } from 'react';
import { formatDuration } from '@/lib/format';
import { Slider } from '@/components/ui/Slider';
import { IconButton } from '@/components/ui/IconButton';
import { useTranslation } from '@/i18n';
import { playModeOf, usePlayerStore, type PlayMode } from '@/stores/playerStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { useEqualizerStore } from '@/stores/equalizerStore';
import { useSpectrumStore } from '@/stores/spectrumStore';
import { useArtEffectStore } from '@/stores/artEffectStore';
import { MODE_ICON } from '@/features/player/ModeIcons';
import { LyricsIcon } from '@/features/lyrics/LyricsIcons';
import { EqualizerIcon } from '@/features/player/EqualizerIcons';
import { EqualizerPanel } from '@/features/player/EqualizerPanel';
import { SpectrumIcon } from '@/features/player/SpectrumIcons';
import { SpectrumPanel } from '@/features/player/SpectrumPanel';
import { ArtEffectIcon } from '@/features/player/ArtEffectIcons';
import { ArtEffectsPanel } from '@/features/player/ArtEffectsPanel';
import { VolumeControl } from '@/features/player/VolumeControl';
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
  const spectrumOpen = useSpectrumStore((s) => s.open);
  const fxOpen = useArtEffectStore((s) => s.open);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const { toggle, next, prev, seek, cyclePlayMode } = usePlayerStore.getState();
  const toggleLyrics = useLyricsStore.getState().toggle;
  // All four popovers anchor to the bar's right edge: only one may be
  // open, so each toggle closes the other three.
  const toggleEq = () => openPopover('eq', !useEqualizerStore.getState().open);
  const toggleSpectrum = () =>
    openPopover('spectrum', !useSpectrumStore.getState().open);
  const toggleFx = () => openPopover('fx', !useArtEffectStore.getState().open);
  const toggleVolume = () => openPopover('volume', !volumeOpen);
  const openPopover = (which: 'eq' | 'spectrum' | 'fx' | 'volume', open: boolean) => {
    useEqualizerStore.getState().setOpen(which === 'eq' ? open : false);
    useSpectrumStore.getState().setOpen(which === 'spectrum' ? open : false);
    useArtEffectStore.getState().setOpen(which === 'fx' ? open : false);
    setVolumeOpen(which === 'volume' ? open : false);
  };
  // Anchors for the popovers' outside-press exclusion (the toggle buttons
  // themselves must toggle, not close-then-reopen).
  const eqToggleRef = useRef<HTMLButtonElement>(null);
  const fxToggleRef = useRef<HTMLButtonElement>(null);
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
      {spectrumOpen ? <SpectrumPanel /> : null}
      {fxOpen ? <ArtEffectsPanel anchorRef={fxToggleRef} /> : null}

      <div className="transport">
        {/* 2+2 symmetric cluster around the play button: play mode flanks
            left with prev, the lyrics toggle mirrors it right with next.
            The audio panels (EQ/spectrum/fx) live in the right-hand dock. */}
        <div className="transport-buttons">
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
          <IconButton
            label={lyricsOpen ? t('player.hideLyrics') : t('player.showLyrics')}
            active={lyricsOpen}
            aria-pressed={lyricsOpen}
            onClick={toggleLyrics}
            data-testid="lyrics-toggle"
          >
            <LyricsIcon />
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

      <div className="bar-tools">
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
          label={spectrumOpen ? t('player.hideSpectrum') : t('player.showSpectrum')}
          active={spectrumOpen}
          aria-pressed={spectrumOpen}
          onClick={toggleSpectrum}
          data-testid="spectrum-toggle"
        >
          <SpectrumIcon />
        </IconButton>
        <IconButton
          ref={fxToggleRef}
          label={fxOpen ? t('player.hideArtEffects') : t('player.showArtEffects')}
          active={fxOpen}
          aria-pressed={fxOpen}
          onClick={toggleFx}
          data-testid="fx-toggle"
        >
          <ArtEffectIcon />
        </IconButton>
        <VolumeControl
          open={volumeOpen}
          onToggle={toggleVolume}
          onClose={() => openPopover('volume', false)}
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
