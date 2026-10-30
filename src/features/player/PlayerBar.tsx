// Bottom transport bar: play controls, seek, volume, now-playing title.

import { formatDuration } from '../../lib/format';
import { Slider } from '../../components/ui/Slider';
import { IconButton } from '../../components/ui/IconButton';
import { usePlayerStore } from '../../stores/playerStore';
import { nextRepeatMode } from '../../stores/playerStore';

const REPEAT_LABEL: Record<string, string> = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
const REPEAT_SHORT: Record<string, string> = { off: '↻', all: '↻', one: '↻¹' };

export function PlayerBar() {
  const state = usePlayerStore((s) => s.state);
  const error = usePlayerStore((s) => s.error);
  const { toggle, next, prev, seek, setVolume, setShuffle, cycleRepeat } = usePlayerStore.getState();

  if (!state) {
    return <footer className="player-bar player-bar-empty">Loading player…</footer>;
  }

  const playing = state.status === 'playing';
  const duration = state.durationSecs ?? 0;

  return (
    <footer className="player-bar" data-status={state.status}>
      <div className="now-playing" data-testid="now-playing">
        {state.currentTrack ? (
          <>
            <div className="now-playing-title">{state.currentTrack.title}</div>
            <div className="now-playing-artist">{state.currentTrack.artist ?? 'Unknown artist'}</div>
          </>
        ) : (
          <div className="now-playing-title muted">Nothing playing</div>
        )}
      </div>

      <div className="transport">
        <div className="transport-buttons">
          <IconButton label="Shuffle" active={state.shuffle} onClick={() => void setShuffle(!state.shuffle)}>
            🔀
          </IconButton>
          <IconButton label="Previous track" onClick={() => void prev()}>
            ⏮
          </IconButton>
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            className="play-btn"
            onClick={() => void toggle()}
            data-testid="play-toggle"
          >
            {playing ? '⏸' : '▶'}
          </IconButton>
          <IconButton label="Next track" onClick={() => void next()}>
            ⏭
          </IconButton>
          <IconButton
            label={REPEAT_LABEL[state.repeat] ?? 'Repeat'}
            active={state.repeat !== 'off'}
            onClick={() => void cycleRepeat()}
            data-testid="repeat-btn"
          >
            {REPEAT_SHORT[state.repeat] ?? '↻'}
          </IconButton>
        </div>
        <div className="progress">
          <span className="time">{formatDuration(state.positionSecs)}</span>
          <Slider
            aria-label="Seek"
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
          aria-label="Volume"
          data-testid="volume-slider"
          className="volume-slider"
          min={0}
          max={1}
          step={0.01}
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

// Re-export for tests that want to compute the expected next mode.
export { nextRepeatMode };
