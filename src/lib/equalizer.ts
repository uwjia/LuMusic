// Equalizer frontend logic: band layout, built-in presets and gain
// helpers. Mirrors the backend constants (domain/equalizer.rs) — presets
// are a pure UI concern, the backend only stores sanitized gain vectors.

export const EQ_BAND_COUNT = 10;

export const EQ_MIN_GAIN_DB = -12;
export const EQ_MAX_GAIN_DB = 12;

/** Band corner/center frequencies displayed under the sliders (Hz). */
export const EQ_BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'] as const;

export interface EqPreset {
  id: string;
  /** Exactly `EQ_BAND_COUNT` gains in dB. */
  gains: number[];
}

export function flatGains(): number[] {
  return Array<number>(EQ_BAND_COUNT).fill(0);
}

/** Built-in curves shown as preset chips (order = display order). */
export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'rock', gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  { id: 'pop', gains: [-1, 1, 3, 4, 3, 1, -1, -1, -1, -1] },
  { id: 'jazz', gains: [3, 2, 1, 2, -2, -2, 0, 1, 2, 3] },
  { id: 'classical', gains: [3, 2, 1, 0, 0, 0, 0, 1, 2, 3] },
  { id: 'electronic', gains: [5, 4, 2, 0, -2, 1, 1, 2, 4, 5] },
  { id: 'bassBoost', gains: [10, 8, 6, 3, 1, 0, 0, 0, 0, 0] },
  { id: 'trebleBoost', gains: [0, 0, 0, 0, 0, 1, 3, 6, 8, 10] },
];

/** Clamps an arbitrary gain into the valid range (NaN collapses to 0). */
export function clampGain(db: number): number {
  if (Number.isNaN(db)) return 0;
  return Math.min(EQ_MAX_GAIN_DB, Math.max(EQ_MIN_GAIN_DB, db));
}

/**
 * Id of the preset exactly matching `gains` (after clamping/padding), or
 * `null` when the curve was hand-edited ("custom").
 */
export function presetIdOf(gains: number[]): string | null {
  const normalized = normalizeGains(gains);
  const match = EQ_PRESETS.find((preset) =>
    preset.gains.every((g, i) => g === normalized[i]),
  );
  return match ? match.id : null;
}

/** Clamps and pads/truncates arbitrary gains into a valid band vector. */
export function normalizeGains(gains: number[]): number[] {
  const out = gains.slice(0, EQ_BAND_COUNT).map(clampGain);
  while (out.length < EQ_BAND_COUNT) out.push(0);
  return out;
}
