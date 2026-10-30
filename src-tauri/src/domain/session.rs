//! Persisted playback session: what to restore after an app restart.
//!
//! The session captures the queue (user-visible order), the current track
//! and its playback position, plus the queue modes. Restoring is always a
//! best-effort operation - a stale or hand-edited file must never break
//! startup, so all sanitation lives here as pure logic.

use serde::{Deserialize, Serialize};

use super::queue::RepeatMode;
use super::track::TrackId;

/// Snapshot of the active playback session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaybackSession {
    /// Queue in user-visible order.
    pub queue: Vec<TrackId>,
    /// Index into `queue` of the track that was current.
    pub current_index: usize,
    /// Position inside the current track when the session was saved.
    pub position_secs: f64,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

impl PlaybackSession {
    /// Sanitizes a loaded (possibly stale or hand-edited) session.
    /// Returns `None` when there is nothing usable to restore.
    pub fn sanitized(mut self) -> Option<Self> {
        if self.queue.is_empty() {
            return None;
        }
        self.current_index = self.current_index.min(self.queue.len() - 1);
        // NaN/infinite positions (hand-edited file) degrade to the track start.
        if !self.position_secs.is_finite() {
            self.position_secs = 0.0;
        }
        self.position_secs = self.position_secs.max(0.0);
        Some(self)
    }

    /// Position to restore inside a track of `duration_secs`: clamped into
    /// range, and restarted from the beginning when the saved position sat
    /// within the last second of the track (that track had effectively
    /// finished; resuming at the very end would play nothing before
    /// auto-advancing).
    pub fn restore_position(&self, duration_secs: Option<f64>) -> f64 {
        let Some(duration) = duration_secs else {
            return self.position_secs;
        };
        if self.position_secs >= duration - 1.0 {
            return 0.0;
        }
        self.position_secs.clamp(0.0, duration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(queue: Vec<&str>, current_index: usize, position_secs: f64) -> PlaybackSession {
        PlaybackSession {
            queue: queue.into_iter().map(Into::into).collect(),
            current_index,
            position_secs,
            shuffle: false,
            repeat: RepeatMode::Off,
        }
    }

    #[test]
    fn sanitized_drops_empty_sessions() {
        assert_eq!(PlaybackSession::default().sanitized(), None);
    }

    #[test]
    fn sanitized_clamps_index_into_range() {
        // Out-of-range index (queue shrank since the save) falls back to the
        // last remaining track instead of failing the restore.
        let s = session(vec!["a", "b"], 99, 5.0).sanitized().unwrap();
        assert_eq!(s.current_index, 1);
    }

    #[test]
    fn sanitized_repairs_broken_positions() {
        let s = session(vec!["a"], 0, f64::NAN).sanitized().unwrap();
        assert_eq!(s.position_secs, 0.0);
        let s = session(vec!["a"], 0, f64::INFINITY).sanitized().unwrap();
        assert_eq!(s.position_secs, 0.0);
        let s = session(vec!["a"], 0, -3.0).sanitized().unwrap();
        assert_eq!(s.position_secs, 0.0);
    }

    #[test]
    fn restore_position_clamps_into_the_track() {
        let s = session(vec!["a"], 0, 120.0);
        assert_eq!(s.restore_position(Some(180.0)), 120.0);
        // Saved past the end: the near-end rule below restarts the track.
        assert_eq!(s.restore_position(Some(60.0)), 0.0);
        // Unknown duration: trust the saved value.
        assert_eq!(s.restore_position(None), 120.0);
        let s = session(vec!["a"], 0, 50.0);
        assert_eq!(s.restore_position(Some(60.0)), 50.0);
    }

    #[test]
    fn restore_position_restarts_finished_tracks() {
        // Within the last second of the track: start over instead of
        // resuming at an effectively empty remainder.
        let s = session(vec!["a"], 0, 179.5);
        assert_eq!(s.restore_position(Some(180.0)), 0.0);
        let s = session(vec!["a"], 0, 300.0);
        assert_eq!(s.restore_position(Some(180.0)), 0.0);
    }

    #[test]
    fn session_round_trips_through_serde_camel_case() {
        let s = PlaybackSession {
            queue: vec!["a".into(), "b".into()],
            current_index: 1,
            position_secs: 12.5,
            shuffle: true,
            repeat: RepeatMode::All,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"currentIndex\""));
        assert!(json.contains("\"positionSecs\""));
        assert_eq!(serde_json::from_str::<PlaybackSession>(&json).unwrap(), s);
    }
}
