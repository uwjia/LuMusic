// Volume control: a level-aware speaker button that opens a vertical
// fader popover above the bar (same geometry as the EQ/spectrum/fx
// panels, mutually exclusive with them). Scrolling while hovering the
// button nudges the volume without opening anything, so quick
// adjustments stay zero-click.

import { useEffect, useRef, useState, type WheelEvent } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Slider } from '@/components/ui/Slider';
import { useTranslation } from '@/i18n';
import { usePlayerStore } from '@/stores/playerStore';
import { VolumeHighIcon, VolumeLowIcon, VolumeMuteIcon } from '@/features/player/VolumeIcons';

/** Wheel nudges commit at most this often (mirrors Slider's window). */
const WHEEL_COMMIT_MS = 120;
const WHEEL_STEP = 0.05;

interface VolumeControlProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function VolumeControl({ open, onToggle, onClose }: VolumeControlProps) {
  const { t } = useTranslation();
  const volume = usePlayerStore((s) => s.state?.volume ?? 0);
  const setVolume = usePlayerStore.getState().setVolume;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Pending wheel-nudge value; committed once (debounced) like the
  // slider's own wheel handling, so a trackpad burst is one api call.
  const [nudge, setNudge] = useState<number | null>(null);
  const wheelTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    },
    [],
  );

  const level = volume === 0 ? 'mute' : volume < 0.5 ? 'low' : 'high';

  // Close on Escape and outside presses; presses on the anchor stay the
  // toggle button's own job (capture-phase contract as in EqualizerPanel).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const shown = nudge ?? volume;

  const handleWheel = (e: WheelEvent<HTMLButtonElement>) => {
    const direction = e.deltaY < 0 ? 1 : -1;
    const target = Math.min(1, Math.max(0, shown + direction * WHEEL_STEP));
    const snapped = Number(target.toFixed(4));
    setNudge(snapped);
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = null;
      setNudge(null);
      void setVolume(snapped);
    }, WHEEL_COMMIT_MS);
  };

  return (
    <>
      <IconButton
        ref={anchorRef}
        label={t('player.volume')}
        active={open}
        aria-pressed={open}
        onClick={onToggle}
        onWheel={handleWheel}
        data-testid="volume-toggle"
        data-volume-level={level}
      >
        {level === 'mute' ? (
          <VolumeMuteIcon />
        ) : level === 'low' ? (
          <VolumeLowIcon />
        ) : (
          <VolumeHighIcon />
        )}
      </IconButton>
      {open ? (
        <div
          ref={panelRef}
          className="volume-popover"
          role="dialog"
          aria-label={t('player.volume')}
          data-testid="volume-popover"
        >
          <Slider
            className="volume-slider"
            aria-label={t('player.volume')}
            data-testid="volume-slider"
            min={0}
            max={1}
            step={0.01}
            wheelStep={0.05}
            value={volume}
            onCommit={(value) => void setVolume(value)}
          />
          {/* Decorative mirror of the slider value (a11y lives on the input). */}
          <span className="volume-value" aria-hidden="true">
            {Math.round(volume * 100)}%
          </span>
        </div>
      ) : null}
    </>
  );
}
