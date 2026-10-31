// Range input wrapper with drag-safe commit semantics:
// `onChange` updates local state instantly, `onCommit` fires on release so
// expensive operations (seek, volume) happen once per gesture.
// Opt-in `wheelStep` lets the mouse wheel nudge the value (volume slider).

import { useEffect, useRef, useState, type InputHTMLAttributes, type WheelEvent } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** Current committed value (position/volume). */
  value: number;
  onCommit: (value: number) => void;
  /**
   * When set, wheel notches over the slider move the value by this amount
   * (scroll up = increase). Commits are debounced so trackpad momentum
   * bursts produce one backend call instead of dozens.
   */
  wheelStep?: number;
}

/** Debounce window for wheel commits. */
const WHEEL_COMMIT_MS = 120;

export function Slider({ value, onCommit, wheelStep, className = '', ...rest }: SliderProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? value;
  const wheelTimer = useRef<number | null>(null);

  // Drop the local override when the committed value catches up. "Catches
  // up" must be a rounding bucket, not exact equality: the backend seek
  // lands a frame short of its target and volume crosses an f32 boundary,
  // so an exact match never fires — the thumb then stays pinned at the
  // dragged value and ignores later updates (seek bar refusing to return
  // to 0 on next/previous, frozen while playing). Half a step = same
  // setting on the slider's own grid.
  const tolerance = Math.abs(Number(rest.step ?? 1)) / 2 || Number.EPSILON;
  useEffect(() => {
    if (dragValue != null && Math.abs(dragValue - value) <= tolerance) {
      setDragValue(null);
    }
  }, [value, dragValue, tolerance]);

  useEffect(
    () => () => {
      if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    },
    [],
  );

  // Native range inputs ignore the wheel; players conventionally let the
  // wheel nudge the volume, so replicate that when `wheelStep` is opted in.
  // Deliberately NOT enabled for the seek slider: an accidental scroll
  // jumping the playback position is destructive, a volume blip is not.
  const handleWheel = (e: WheelEvent<HTMLInputElement>) => {
    if (wheelStep == null) return;
    const lo = Number(rest.min ?? 0);
    const hi = Number(rest.max ?? 100);
    const quantum = Number(rest.step ?? 1) || 1;
    const direction = e.deltaY < 0 ? 1 : -1;
    const target = Math.min(hi, Math.max(lo, shown + direction * wheelStep));
    // Snap onto the slider's own step grid; toFixed clears FP dust (0.1+0.05).
    const snapped = Number((lo + Math.round((target - lo) / quantum) * quantum).toFixed(4));
    setDragValue(snapped);
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = null;
      onCommit(snapped);
    }, WHEEL_COMMIT_MS);
  };

  return (
    <input
      type="range"
      className={`slider ${className}`}
      value={shown}
      onChange={(e) => setDragValue(Number(e.target.value))}
      onPointerUp={() => dragValue != null && onCommit(dragValue)}
      onKeyUp={() => dragValue != null && onCommit(dragValue)}
      onWheel={handleWheel}
      {...rest}
    />
  );
}
