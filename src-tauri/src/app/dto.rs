//! DTOs crossing the backend/frontend boundary.
//!
//! The frontend mirrors these shapes in `src/types/track.ts`; keep both in
//! sync (serde uses camelCase).

use serde::Serialize;

use crate::domain::queue::RepeatMode;
use crate::domain::track::Track;

/// Playback status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Stopped,
    Playing,
    Paused,
}

/// Full player snapshot (event `player://state` + `player_state` command).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStateDto {
    pub status: PlaybackStatus,
    pub current_track: Option<Track>,
    /// Index into the visible queue order.
    pub queue_position: Option<usize>,
    pub queue_len: usize,
    pub position_secs: f64,
    pub duration_secs: Option<f64>,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

/// Throttled progress tick (event `player://progress`).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDto {
    pub position_secs: f64,
    pub duration_secs: Option<f64>,
}

/// Scan progress tick (event `library://scan-progress`).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressDto {
    pub scanned: usize,
    pub total: usize,
}
