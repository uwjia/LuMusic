//! DTOs crossing the backend/frontend boundary.
//!
//! The frontend mirrors these shapes in `src/types/track.ts`; keep both in
//! sync (serde uses camelCase).

use serde::Serialize;

use crate::domain::lyrics::Lyrics;
use crate::domain::queue::RepeatMode;
use crate::domain::track::{Track, TrackId};

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
///
/// `track_id` identifies the track the numbers belong to: a tick serialized
/// right before a track switch can be delivered to the webview *after* the
/// switch's fresh state (events and invoke responses take different
/// channels), and applying it would rewind the seek bar into the previous
/// track's position. The frontend drops ticks whose track no longer plays.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDto {
    pub track_id: Option<TrackId>,
    pub position_secs: f64,
    pub duration_secs: Option<f64>,
}

impl ProgressDto {
    /// Progress projection of a full player snapshot.
    pub fn of(state: &PlayerStateDto) -> Self {
        Self {
            track_id: state.current_track.as_ref().map(|t| t.id.clone()),
            position_secs: state.position_secs,
            duration_secs: state.duration_secs,
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::queue::RepeatMode;

    fn state(track: Option<Track>) -> PlayerStateDto {
        PlayerStateDto {
            status: crate::app::dto::PlaybackStatus::Playing,
            current_track: track,
            queue_position: Some(0),
            queue_len: 1,
            position_secs: 12.5,
            duration_secs: Some(200.0),
            volume: 0.5,
            shuffle: false,
            repeat: RepeatMode::Off,
        }
    }

    /// Pins the camelCase shape of the progress tick and, crucially, the
    /// track identity it carries: without it the frontend cannot tell a
    /// stale pre-switch tick from a live one.
    #[test]
    fn progress_dto_carries_the_tracks_identity() {
        let dto = ProgressDto::of(&state(Some(Track::from_stem(
            std::path::Path::new("C:/lib/a.mp3"),
            1,
        ))));
        assert_eq!(dto.track_id.as_deref(), Some("C:/lib/a.mp3"));
        assert_eq!(dto.position_secs, 12.5);
        assert_eq!(dto.duration_secs, Some(200.0));
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["trackId"], "C:/lib/a.mp3");
        assert_eq!(json["positionSecs"], 12.5);

        // Idle player: identity is null, not a stale id.
        assert_eq!(ProgressDto::of(&state(None)).track_id, None);
    }
}
