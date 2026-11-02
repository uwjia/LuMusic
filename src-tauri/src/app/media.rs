//! OS media session: SMTC on Windows, MPRIS on Linux (souvlaki adapter).
//!
//! Mirrors the tray's split: the backend owns the OS surface, the
//! *projection* of player state onto it (`MediaSnapshot`, `seek_target`)
//! is pure and unit-tested; the souvlaki calls themselves are a thin
//! untestable wrapper, exactly like `TrayController::build`.
//!
//! Buttons (hardware media keys, lock screen, Bluetooth headphones) route
//! back through the same `PlayerService` methods as the UI and the tray,
//! so every surface applies identical playback rules.

use std::ffi::c_void;
use std::sync::Mutex;
use std::time::Duration;

use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
    PlatformConfig, SeekDirection,
};
use tauri::{AppHandle, Manager, Wry};

use super::commands::emit_state;
use super::dto::{PlaybackStatus, PlayerStateDto};
use super::service::{PlayerError, PlayerService};
use super::state::SharedService;
use crate::domain::track::TrackId;

/// Player state projected onto the OS media surface. Track titles come
/// from the library (user data) and are never localized here.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MediaSnapshot {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<Duration>,
    pub position: Duration,
    pub playing: bool,
    /// False when no track is loaded (the session then reports Stopped).
    pub active: bool,
}

/// Projection of a player snapshot for the media session.
pub fn snapshot_of(state: &PlayerStateDto) -> MediaSnapshot {
    let position = Duration::from_secs_f64(state.position_secs.max(0.0));
    let Some(track) = state.current_track.as_ref() else {
        return MediaSnapshot {
            position,
            playing: false,
            active: false,
            ..MediaSnapshot::default()
        };
    };
    MediaSnapshot {
        title: track.title.clone(),
        artist: track.artist.clone().filter(|a| !a.is_empty()),
        album: track.album.clone().filter(|a| !a.is_empty()),
        duration: track.duration_secs.map(Duration::from_secs_f64),
        position,
        playing: state.status == PlaybackStatus::Playing,
        active: true,
    }
}

/// Target for a relative OS seek (media key / flyout skip button), clamped
/// into the track. Pure so the clamping behavior is testable.
pub fn seek_target(
    position: f64,
    duration: Option<f64>,
    direction: SeekDirection,
    delta: Duration,
) -> f64 {
    let delta = delta.as_secs_f64();
    let base = match direction {
        SeekDirection::Forward => position + delta,
        SeekDirection::Backward => position - delta,
    };
    match duration {
        Some(duration) => base.clamp(0.0, duration),
        None => base.max(0.0),
    }
}

/// Owns the souvlaki session. `None` when the OS surface could not be
/// created (e.g. missing window handle) — the app keeps running, only the
/// OS integration is absent.
pub struct MediaController {
    controls: Option<MediaControls>,
    /// Track id of the last pushed metadata: metadata is only resent on
    /// track changes, so position updates never reset the OS timeline.
    last_track: Option<TrackId>,
}

impl MediaController {
    /// Attaches the OS media session to `app`'s main window. `hwnd` is the
    /// native window handle on Windows (`None` elsewhere; souvlaki only
    /// needs it there).
    pub fn build(app: &AppHandle<Wry>, hwnd: Option<*mut c_void>, state: &PlayerStateDto) -> Self {
        let config = PlatformConfig {
            dbus_name: "lumusic",
            display_name: "LuMusic",
            hwnd,
        };
        let mut controller = Self {
            controls: None,
            last_track: None,
        };
        match MediaControls::new(config) {
            Ok(mut controls) => {
                let handle = app.clone();
                match controls.attach(move |event| handle_media_event(&handle, event)) {
                    Ok(()) => tracing::info!("OS media session attached"),
                    Err(err) => tracing::warn!("media controls attach failed: {err}"),
                }
                controller.controls = Some(controls);
                controller.update_player_state(state);
            }
            Err(err) => tracing::warn!("OS media session unavailable: {err}"),
        }
        controller
    }

    /// Called from `emit_state` on every transition and from the poller's
    /// progress ticks (the OS flyout timeline follows the position).
    pub fn update_player_state(&mut self, state: &PlayerStateDto) {
        let Some(controls) = self.controls.as_mut() else {
            return;
        };
        let snapshot = snapshot_of(state);
        let track_id = state.current_track.as_ref().map(|t| t.id.clone());
        if track_id != self.last_track {
            self.last_track = track_id;
            if let Err(err) = controls.set_metadata(MediaMetadata {
                title: Some(snapshot.title.as_str()),
                artist: snapshot.artist.as_deref(),
                album: snapshot.album.as_deref(),
                duration: snapshot.duration,
                cover_url: None,
            }) {
                tracing::debug!("failed to update media metadata: {err}");
            }
        }
        let playback = if snapshot.active {
            let progress = Some(MediaPosition(snapshot.position));
            if snapshot.playing {
                MediaPlayback::Playing { progress }
            } else {
                MediaPlayback::Paused { progress }
            }
        } else {
            MediaPlayback::Stopped
        };
        if let Err(err) = controls.set_playback(playback) {
            tracing::debug!("failed to update media playback state: {err}");
        }
    }
}

/// Pushes a snapshot to the media session if one is attached (no-op
/// otherwise). Shared by `emit_state` and the poller.
pub fn publish(app: &AppHandle<Wry>, state: &PlayerStateDto) {
    if let Some(controller) = app.try_state::<Mutex<MediaController>>() {
        if let Ok(mut guard) = controller.lock() {
            guard.update_player_state(state);
        }
    }
}

/// Runs the playback action behind an OS media event. Same tolerance as
/// the tray: e.g. Play with an empty queue stays quiet instead of erroring
/// into the user's face.
fn apply_media_event(
    service: &mut PlayerService,
    event: &MediaControlEvent,
) -> Result<(), PlayerError> {
    match event {
        MediaControlEvent::Play => match service.status() {
            // Explicit Play while already playing must not pause.
            PlaybackStatus::Playing => Ok(()),
            PlaybackStatus::Paused => {
                service.resume();
                Ok(())
            }
            PlaybackStatus::Stopped => service.toggle(),
        },
        MediaControlEvent::Pause => {
            service.pause();
            Ok(())
        }
        MediaControlEvent::Toggle => service.toggle(),
        MediaControlEvent::Next => service.next(),
        MediaControlEvent::Previous => service.previous(),
        MediaControlEvent::Stop => {
            service.stop();
            Ok(())
        }
        MediaControlEvent::SeekBy(direction, delta) => {
            let state = service.state();
            service.seek(seek_target(state.position_secs, state.duration_secs, *direction, *delta))
        }
        // SMTC's bare skip buttons carry no amount; ±10s is the OS default.
        MediaControlEvent::Seek(direction) => {
            let state = service.state();
            service.seek(seek_target(
                state.position_secs,
                state.duration_secs,
                *direction,
                Duration::from_secs(10),
            ))
        }
        MediaControlEvent::SetPosition(position) => service.seek(position.0.as_secs_f64()),
        MediaControlEvent::SetVolume(volume) => service.set_volume(*volume as f32),
        // Raise/Quit/OpenUri/SetShuffle are surface-specific and unused.
        _ => Ok(()),
    }
}

/// Entry point for souvlaki callbacks (OS threads): applies the action
/// through the service, then re-broadcasts the resulting state so the UI,
/// tray and media session stay consistent.
pub fn handle_media_event(app: &AppHandle<Wry>, event: MediaControlEvent) {
    let Some(service) = app.try_state::<SharedService>() else {
        return;
    };
    let Ok(mut guard) = service.lock() else {
        return;
    };
    if let Err(err) = apply_media_event(&mut guard, &event) {
        tracing::debug!("media event skipped: {err}");
    }
    emit_state(app, &guard);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::dto::PlaybackStatus;
    use crate::domain::queue::RepeatMode;
    use crate::domain::track::Track;

    fn state(status: PlaybackStatus, track: Option<Track>, position: f64) -> PlayerStateDto {
        PlayerStateDto {
            status,
            current_track: track,
            queue_position: None,
            queue_len: 0,
            position_secs: position,
            duration_secs: None,
            volume: 0.8,
            shuffle: false,
            repeat: RepeatMode::Off,
            queue_source_id: None,
        }
    }

    fn track(artist: Option<&str>, album: Option<&str>, duration: Option<f64>) -> Track {
        let mut track = Track::from_stem(std::path::Path::new("C:/lib/a.mp3"), 1);
        track.title = "Alpha".into();
        track.artist = artist.map(Into::into);
        track.album = album.map(Into::into);
        track.duration_secs = duration;
        track
    }

    #[test]
    fn snapshot_maps_metadata_and_drops_empty_strings() {
        let snapshot = snapshot_of(&state(
            PlaybackStatus::Playing,
            Some(track(Some("Nova"), Some("Aurora"), Some(184.5))),
            12.25,
        ));
        assert_eq!(snapshot.title, "Alpha");
        assert_eq!(snapshot.artist.as_deref(), Some("Nova"));
        assert_eq!(snapshot.album.as_deref(), Some("Aurora"));
        assert_eq!(snapshot.duration, Some(Duration::from_secs_f64(184.5)));
        assert_eq!(snapshot.position, Duration::from_secs_f64(12.25));
        assert!(snapshot.playing);
        assert!(snapshot.active);

        // Empty tags are omitted, not shown as blank lines.
        let sparse = snapshot_of(&state(
            PlaybackStatus::Paused,
            Some(track(Some(""), None, None)),
            0.0,
        ));
        assert_eq!(sparse.artist, None);
        assert_eq!(sparse.album, None);
        assert_eq!(sparse.duration, None);
        assert!(!sparse.playing);
        assert!(sparse.active);
    }

    #[test]
    fn snapshot_without_a_track_reports_an_idle_session() {
        let snapshot = snapshot_of(&state(PlaybackStatus::Stopped, None, 0.0));
        assert!(!snapshot.active);
        assert!(!snapshot.playing);
        assert_eq!(snapshot.title, "");
        assert_eq!(snapshot.duration, None);
    }

    #[test]
    fn negative_positions_never_reach_the_os_as_negative_durations() {
        // A hand-edited or crashed session could restore a negative
        // position; Duration::from_secs_f64 would panic on it.
        let snapshot = snapshot_of(&state(
            PlaybackStatus::Playing,
            Some(track(None, None, Some(10.0))),
            -3.0,
        ));
        assert_eq!(snapshot.position, Duration::ZERO);
    }

    #[test]
    fn seek_target_clamps_relative_skips_into_the_track() {
        let forward = seek_target(95.0, Some(100.0), SeekDirection::Forward, Duration::from_secs(30));
        assert_eq!(forward, 100.0);
        let backward = seek_target(5.0, Some(100.0), SeekDirection::Backward, Duration::from_secs(30));
        assert_eq!(backward, 0.0);
        // Unknown duration only clamps the floor.
        let unbounded = seek_target(5.0, None, SeekDirection::Backward, Duration::from_secs(30));
        assert_eq!(unbounded, 0.0);
        let mid = seek_target(50.0, Some(100.0), SeekDirection::Backward, Duration::from_secs(10));
        assert_eq!(mid, 40.0);
    }
}
