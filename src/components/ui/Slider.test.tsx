// Behavior tests for the generic slider: drag/keyboard commit semantics
// and the opt-in wheel nudge (used by the volume slider).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { Slider } from '@/components/ui/Slider';

describe('Slider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const volumeSlider = (onCommit: (v: number) => void) => (
    <Slider
      aria-label="volume"
      value={0.5}
      min={0}
      max={1}
      step={0.01}
      wheelStep={0.05}
      onCommit={onCommit}
    />
  );

  const input = () => screen.getByRole('slider') as HTMLInputElement;

  it('commits the dragged value on pointer release', () => {
    const onCommit = vi.fn();
    render(volumeSlider(onCommit));
    fireEvent.change(input(), { target: { value: '0.7' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(input());
    expect(onCommit).toHaveBeenCalledWith(0.7);
  });

  it('wheel up nudges the value by wheelStep and commits after the debounce', async () => {
    const onCommit = vi.fn();
    render(volumeSlider(onCommit));
    fireEvent.wheel(input(), { deltaY: -120 });
    // UI feedback is instant, the commit waits for the debounce.
    expect(input().value).toBe('0.55');
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(onCommit).toHaveBeenCalledWith(0.55);
  });

  it('wheel down decreases and rapid notches coalesce into one commit', async () => {
    const onCommit = vi.fn();
    render(volumeSlider(onCommit));
    fireEvent.wheel(input(), { deltaY: 120 });
    fireEvent.wheel(input(), { deltaY: 120 });
    expect(input().value).toBe('0.4');
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.4);
  });

  it('clamps at the bounds and stays on the step grid', async () => {
    const onCommit = vi.fn();
    render(
      <Slider
        aria-label="volume"
        value={0.02}
        min={0}
        max={1}
        step={0.01}
        wheelStep={0.05}
        onCommit={onCommit}
      />,
    );
    fireEvent.wheel(input(), { deltaY: 120 });
    fireEvent.wheel(input(), { deltaY: 120 });
    expect(input().value).toBe('0');
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('ignores the wheel when no wheelStep is opted in', async () => {
    const onCommit = vi.fn();
    render(
      <Slider aria-label="seek" value={10} min={0} max={100} step={0.5} onCommit={onCommit} />,
    );
    fireEvent.wheel(input(), { deltaY: -120 });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('10');
  });
});
