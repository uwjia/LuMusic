// Behavior tests for formatting helpers.
import { describe, expect, it } from 'vitest';
import { clamp, formatBytes, formatDuration } from './format';

describe('formatDuration', () => {
  it('renders minutes and zero-padded seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(599)).toBe('9:59');
  });

  it('switches to h:mm:ss once an hour is reached', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('clamps invalid input to zero instead of throwing', () => {
    expect(formatDuration(-10)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatBytes', () => {
  it('keeps small values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('uses binary units and trims decimals for large values', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MiB');
    expect(formatBytes(200 * 1024 ** 3)).toBe('200 GiB');
  });
});

describe('clamp', () => {
  it('bounds the value into the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
