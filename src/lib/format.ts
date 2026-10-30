// Pure formatting helpers shared across features.

/**
 * Formats a duration in seconds as `m:ss` or `h:mm:ss`.
 * Negative or non-finite inputs are clamped to 0.
 */
export function formatDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Formats a byte count with binary units (KiB, MiB, ...).
 */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = value;
  let unit = -1;
  do {
    v /= 1024;
    unit += 1;
  } while (v >= 1024 && unit < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Clamps a number into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
