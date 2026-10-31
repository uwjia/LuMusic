//! Event names and payload types shared between backend and frontend.
//!
//! The frontend mirrors these constants in `src/api/types.ts`; keep both in
//! sync when changing payloads.

/// Emitted whenever the playback state changes (track, status, mode, ...).
pub const EVENT_PLAYER_STATE: &str = "player://state";
/// Emitted periodically (throttled ~4 Hz) with playback progress.
pub const EVENT_PLAYER_PROGRESS: &str = "player://progress";
/// Emitted ~20 Hz while playing: normalized per-bar spectrum magnitudes.
pub const EVENT_SPECTRUM: &str = "spectrum://frame";
/// Emitted after a library (re)scan finished.
pub const EVENT_LIBRARY_UPDATED: &str = "library://updated";
/// Emitted during scanning with progress counters.
pub const EVENT_LIBRARY_SCAN_PROGRESS: &str = "library://scan-progress";
