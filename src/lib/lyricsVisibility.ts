// Lyrics-page visibility persistence. The shown/hidden flag is a pure-UI
// preference, so it persists next to the language and art-effect keys in
// localStorage instead of the backend settings file (nothing here needs to
// survive into Rust — the page itself re-derives its content from the
// player state on mount).

export const LYRICS_OPEN_STORAGE_KEY = 'lumusic.lyricsOpen';

/** Reads the persisted visibility; anything but an explicit `true` (corrupt
 * value, first start, unavailable storage) degrades to hidden — a broken
 * stored value must never resurrect the page uninvited. */
export function loadStoredLyricsOpen(): boolean {
  try {
    return localStorage.getItem(LYRICS_OPEN_STORAGE_KEY) === 'true';
  } catch {
    // Storage can be unavailable (privacy mode / disabled webview storage).
    return false;
  }
}

export function persistLyricsOpen(open: boolean): void {
  try {
    localStorage.setItem(LYRICS_OPEN_STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    // Persistence is best-effort; the in-memory flag still applies.
  }
}
