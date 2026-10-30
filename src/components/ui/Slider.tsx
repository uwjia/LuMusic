// Range input wrapper with drag-safe commit semantics:
// `onChange` updates local state instantly, `onCommit` fires on release so
// expensive operations (seek, volume) happen once per gesture.

import { useEffect, useState, type InputHTMLAttributes } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** Current committed value (position/volume). */
  value: number;
  onCommit: (value: number) => void;
}

export function Slider({ value, onCommit, className = '', ...rest }: SliderProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? value;

  // Drop the local override when the committed value catches up.
  useEffect(() => {
    if (dragValue != null && Math.abs(dragValue - value) < Number.EPSILON) {
      setDragValue(null);
    }
  }, [value, dragValue]);

  return (
    <input
      type="range"
      className={`slider ${className}`}
      value={shown}
      onChange={(e) => setDragValue(Number(e.target.value))}
      onPointerUp={() => dragValue != null && onCommit(dragValue)}
      onKeyUp={() => dragValue != null && onCommit(dragValue)}
      {...rest}
    />
  );
}
