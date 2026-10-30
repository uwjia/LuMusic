//! DTOs crossing the backend/frontend boundary.
//!
//! The frontend mirrors these shapes in `src/types/track.ts`; keep both in
//! sync (serde uses camelCase).

use serde::Serialize;

use crate::domain::lyrics::Lyrics;
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

/// One synced lyric line (from `domain::lyrics`, ready for the UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLineDto {
    pub time_ms: u64,
    /// Empty string marks an interlude (rendered as a spacer).
    pub text: String,
}

/// Lyrics associated with a track (`lyrics_get` command).
/// `None` (JSON null) means the track has no lyric file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsDto {
    /// Path of the matched `.lrc` file, shown to prove the association.
    pub source_path: Option<String>,
    pub lines: Vec<LyricLineDto>,
}

impl From<(Option<String>, Lyrics)> for LyricsDto {
    fn from((source_path, lyrics): (Option<String>, Lyrics)) -> Self {
        Self {
            source_path,
            lines: lyrics
                .lines
                .into_iter()
                .map(|line| LyricLineDto {
                    time_ms: line.time_ms,
                    text: line.text,
                })
                .collect(),
        }
    }
}
