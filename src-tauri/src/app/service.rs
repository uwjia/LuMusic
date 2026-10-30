//! Player service: orchestrates domain state + infrastructure adapters.
//!
//! All adapters are injected as traits, so orchestration behavior (playback
//! transitions, auto-advance, persistence side effects) is unit-tested with
//! mocks instead of a real audio device.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::dto::{PlaybackStatus, PlayerStateDto};
use crate::domain::library::{LibraryIndex, TrackQuery};
use crate::domain::playlist::{PlaylistCollection, PlaylistError, Playlist};
use crate::domain::queue::{AdvanceOutcome, Queue, RepeatMode};
use crate::domain::scan::ScanSummary;
use crate::domain::session::PlaybackSession;
use crate::domain::settings::Settings;
use crate::domain::track::{Track, TrackId};
use crate::infra::audio::engine::AudioEngine;
use crate::infra::fs_scan::LibraryScanner;
use crate::infra::metadata::MetadataReader;
use crate::infra::persistence::{Persistence, PersistenceError};

/// How often the live playback position is flushed to disk while playing.
/// Transitions (track change, seek, pause, quit) always persist immediately;
/// this interval only bounds the loss window after a crash/kill.
const SESSION_SAVE_INTERVAL: Duration = Duration::from_secs(5);

/// Service-level errors surfaced to commands.
#[derive(Debug, thiserror::Error)]
pub enum PlayerError {
    #[error("audio error: {0}")]
    Audio(#[from] crate::infra::audio::engine::AudioError),
    #[error("playlist error: {0}")]
    Playlist(#[from] PlaylistError),
    #[error("track '{0}' is not in the library")]
    TrackNotFound(TrackId),
    #[error("queue is empty")]
    EmptyQueue,
    #[error("storage error: {0}")]
    Storage(#[from] PersistenceError),
}

/// Result of one background poll tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollOutcome {
    /// Nothing changed.
    Unchanged,
    /// The current track ended and the next one started.
    Advanced,
    /// The current track ended and the queue is exhausted.
    Stopped,
    /// The next track failed to load; playback stopped.
    Failed(String),
}

/// Orchestrator owning all mutable player state behind one lock.
pub struct PlayerService {
    engine: Box<dyn AudioEngine>,
    scanner: Arc<dyn LibraryScanner>,
    metadata: Arc<dyn MetadataReader>,
    persistence: Arc<dyn Persistence>,

    library: LibraryIndex,
    playlists: PlaylistCollection,
    settings: Settings,
    queue: Queue,
    status: PlaybackStatus,
    /// Monotonic counter feeding the shuffle seed so each toggle differs.
    shuffle_seed: u64,
    /// Mutable twin of `SESSION_SAVE_INTERVAL` so tests can force periodic
    /// saves without sleeping.
    session_save_interval: Duration,
    last_session_save: Instant,
}

impl PlayerService {
    /// Builds the service, loads persisted state and restores the last
    /// playback session (paused at its last position).
    pub fn new(
        engine: Box<dyn AudioEngine>,
        scanner: Arc<dyn LibraryScanner>,
        metadata: Arc<dyn MetadataReader>,
        persistence: Arc<dyn Persistence>,
    ) -> Result<Self, PlayerError> {
        let library = persistence.load_library()?.unwrap_or_default();
        let playlists = persistence.load_playlists()?;
        let settings = persistence.load_settings()?;
        // A broken playback.json costs at most the resume convenience - it
        // must never keep the app from starting.
        let session = match persistence.load_playback() {
            Ok(session) => session.and_then(PlaybackSession::sanitized),
            Err(err) => {
                tracing::warn!("ignoring unreadable playback session: {err}");
                None
            }
        };
        let mut service = Self {
            engine,
            scanner,
            metadata,
            persistence,
            library,
            playlists,
            settings,
            queue: Queue::new(Vec::new(), None),
            status: PlaybackStatus::Stopped,
            shuffle_seed: 0,
            session_save_interval: SESSION_SAVE_INTERVAL,
            last_session_save: Instant::now(),
        };
        service.engine.set_volume(service.settings.volume);
        service.restore_session(session);
        Ok(service)
    }

    /// Rebuilds the saved session: queue + modes, current track loaded into
    /// the engine **paused** at its last position (launching must not blast
    /// audio; the user presses play to continue). Any inconsistency (track
    /// gone from the library, file deleted, decode failure) drops the
    /// session and leaves the player stopped.
    fn restore_session(&mut self, session: Option<PlaybackSession>) {
        let Some(session) = session else {
            return;
        };
        // The sanitizer guarantees an in-range index for a non-empty queue.
        let Some(id) = session.queue.get(session.current_index).cloned() else {
            return;
        };
        let Some(track) = self.library.get(&id).cloned() else {
            tracing::warn!("dropping persisted session: track '{id}' is not in the library");
            if let Err(err) = self.persistence.clear_playback() {
                tracing::warn!("failed to clear persisted playback: {err}");
            }
            return;
        };
        let position = session.restore_position(track.duration_secs);
        self.queue = Queue::new(session.queue, Some(session.current_index));
        self.queue.set_repeat(session.repeat);
        if session.shuffle {
            // Fresh seed: the remaining shuffle order may differ from the
            // last session, but the current track stays first.
            self.shuffle_seed += 1;
            self.queue.set_shuffle(true, self.shuffle_seed);
        }
        match self.engine.load_paused(&track.file_path, position) {
            Ok(()) => {
                self.status = PlaybackStatus::Paused;
                tracing::info!("restored session: '{}' at {position:.1}s", track.id);
            }
            Err(err) => {
                tracing::warn!("session restore failed for '{}': {err}", track.id);
                self.queue = Queue::new(Vec::new(), None);
                self.status = PlaybackStatus::Stopped;
            }
        }
    }

    /// Writes the current session (queue, modes, live position) to disk.
    /// Called on every meaningful transition, periodically while playing
    /// (see `poll`), and when the window closes. Failures are logged, never
    /// fatal - persistence here is a convenience, not a guarantee.
    pub fn save_playback_session(&mut self) {
        self.last_session_save = Instant::now();
        let Some(current_index) = self.queue.current_item_index() else {
            return;
        };
        let session = PlaybackSession {
            queue: self.queue.items().to_vec(),
            current_index,
            position_secs: self.engine.position_secs(),
            shuffle: self.queue.shuffle(),
            repeat: self.queue.repeat(),
        };
        if let Err(err) = self.persistence.save_playback(&session) {
            tracing::warn!("failed to persist playback session: {err}");
        }
    }

    // ----- library -----

    /// Clones the scan adapters so heavy IO can run outside the service lock
    /// (see the `scan_library` command).
    pub fn adapters(&self) -> (Arc<dyn LibraryScanner>, Arc<dyn MetadataReader>) {
        (self.scanner.clone(), self.metadata.clone())
    }

    pub fn query_tracks(&self, query: &TrackQuery) -> Vec<Track> {
        self.library.query(query).into_iter().cloned().collect()
    }

    pub fn get_track(&self, id: &str) -> Option<Track> {
        self.library.get(id).cloned()
    }

    pub fn library_len(&self) -> usize {
        self.library.len()
    }

    /// Scans `root` on the calling thread (used by tests and any caller that
    /// already owns the lock; the Tauri command runs the phases separately to
    /// avoid holding the lock during IO).
    pub fn scan_library(&mut self, root: &Path) -> Result<ScanSummary, PlayerError> {
        let scanned = self.scanner.scan(root);
        let files_seen = scanned.files.len();
        let mut tracks = Vec::with_capacity(files_seen);
        let mut warnings = scanned.warnings;
        for path in &scanned.files {
            match self.metadata.read_track(path) {
                Ok(track) => tracks.push(track),
                Err(err) => {
                    if warnings.len() < 100 {
                        warnings.push(format!(
                            "skipped '{}': {err}",
                            path.display()
                        ));
                    }
                }
            }
        }
        let summary = self.apply_scan(root, files_seen, tracks, warnings);
        Ok(summary)
    }

    /// Pure merge step (kept separate for tests): upserts tracks, prunes ids
    /// that disappeared, syncs the folder-based auto playlists, persists
    /// library + playlists + settings.
    pub fn apply_scan(
        &mut self,
        root: &Path,
        files_seen: usize,
        tracks: Vec<Track>,
        warnings: Vec<String>,
    ) -> ScanSummary {
        let mut added = 0;
        let mut updated = 0;
        let mut keep = std::collections::HashSet::new();
        let mut paths = Vec::with_capacity(tracks.len());
        for track in tracks {
            keep.insert(track.id.clone());
            paths.push(track.file_path.clone());
            if self.library.upsert(track) {
                updated += 1;
            } else {
                added += 1;
            }
        }
        let removed = self.library.retain_only(&keep);

        // Folder structure -> auto playlists (All Tracks / Default / per folder).
        let specs = crate::domain::scan::auto_playlist_plan(root, &paths);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.playlists.sync_auto(&specs, now);

        let summary = ScanSummary {
            root: root.display().to_string(),
            files_seen,
            added,
            updated,
            removed,
            skipped: warnings.len(),
            warnings,
        };
        self.settings.last_folder = Some(root.display().to_string());
        if let Err(err) = self.persistence.save_library(&self.library) {
            tracing::warn!("failed to persist library: {err}");
        }
        if let Err(err) = self.persist_playlists() {
            tracing::warn!("failed to persist playlists: {err}");
        }
        if let Err(err) = self.persistence.save_settings(&self.settings) {
            tracing::warn!("failed to persist settings: {err}");
        }
        summary
    }

    // ----- playback -----

    /// Loads the track by id into the engine and marks it playing.
    fn load_track(&mut self, id: &str) -> Result<(), PlayerError> {
        let track = self
            .library
            .get(id)
            .cloned()
            .ok_or_else(|| PlayerError::TrackNotFound(id.to_string()))?;
        self.engine.set_volume(self.settings.volume);
        self.engine.load_and_play(&track.file_path)?;
        self.status = PlaybackStatus::Playing;
        // New track: persist immediately so a crash still resumes here.
        self.save_playback_session();
        Ok(())
    }

    /// Replaces the queue with `ids` and starts playing at `start_index`.
    pub fn play_queue(&mut self, ids: Vec<TrackId>, start_index: Option<usize>) -> Result<(), PlayerError> {
        if ids.is_empty() {
            return Err(PlayerError::EmptyQueue);
        }
        self.queue.set_items(ids, start_index);
        let id = self.queue.current().ok_or(PlayerError::EmptyQueue)?;
        self.load_track(&id)
    }

    /// Play/pause toggle: pauses when playing, resumes when paused, and
    /// restarts the queue head when stopped.
    pub fn toggle(&mut self) -> Result<(), PlayerError> {
        match self.status {
            PlaybackStatus::Playing => {
                self.engine.pause();
                self.status = PlaybackStatus::Paused;
                Ok(())
            }
            PlaybackStatus::Paused => {
                self.engine.resume();
                self.status = PlaybackStatus::Playing;
                Ok(())
            }
            PlaybackStatus::Stopped => {
                if self.queue.is_empty() {
                    return Err(PlayerError::EmptyQueue);
                }
                let id = self.queue.current().ok_or(PlayerError::EmptyQueue)?;
                self.load_track(&id)
            }
        }
    }

    pub fn pause(&mut self) {
        self.engine.pause();
        if self.status == PlaybackStatus::Playing {
            self.status = PlaybackStatus::Paused;
            // Position is frozen now - the ideal moment to persist it.
            self.save_playback_session();
        }
    }

    pub fn resume(&mut self) {
        self.engine.resume();
        if self.status == PlaybackStatus::Paused {
            self.status = PlaybackStatus::Playing;
        }
    }

    pub fn stop(&mut self) {
        self.engine.stop();
        self.status = PlaybackStatus::Stopped;
        // Playback ended for good (user stop or exhausted queue): dropping
        // the session means the next launch starts fresh instead of
        // resurrecting a finished one.
        if let Err(err) = self.persistence.clear_playback() {
            tracing::warn!("failed to clear persisted playback: {err}");
        }
    }

    /// Manual skip (repeat One still advances).
    pub fn next(&mut self) -> Result<(), PlayerError> {
        match self.queue.advance(false) {
            AdvanceOutcome::Playing(id) => self.load_track(&id),
            AdvanceOutcome::Stopped => {
                self.stop();
                Ok(())
            }
        }
    }

    pub fn previous(&mut self) -> Result<(), PlayerError> {
        match self.queue.previous() {
            Some(id) => self.load_track(&id),
            None => Ok(()), // stay on the first track
        }
    }

    /// Seeks within the current track; clamped to the known duration.
    pub fn seek(&mut self, secs: f64) -> Result<(), PlayerError> {
        let clamped = self
            .state()
            .duration_secs
            .map(|d| secs.clamp(0.0, d))
            .unwrap_or(secs.max(0.0));
        self.engine.seek(clamped)?;
        self.save_playback_session();
        Ok(())
    }

    pub fn set_volume(&mut self, volume: f32) -> Result<(), PlayerError> {
        self.settings.volume = Settings::clamp_volume(volume);
        self.engine.set_volume(self.settings.volume);
        self.persistence.save_settings(&self.settings)?;
        Ok(())
    }

    pub fn set_shuffle(&mut self, on: bool) {
        self.shuffle_seed += 1;
        self.queue.set_shuffle(on, self.shuffle_seed);
        self.save_playback_session();
    }

    pub fn set_repeat(&mut self, mode: RepeatMode) {
        self.queue.set_repeat(mode);
        self.save_playback_session();
    }

    /// Background tick: detects the end of the current track and follows the
    /// queue rules (repeat One replays, repeat All wraps, otherwise next).
    pub fn poll(&mut self) -> PollOutcome {
        // Crash protection: flush the live position every few seconds.
        if self.status == PlaybackStatus::Playing
            && self.last_session_save.elapsed() >= self.session_save_interval
        {
            self.save_playback_session();
        }
        if self.status != PlaybackStatus::Playing {
            return PollOutcome::Unchanged;
        }
        if self.engine.is_active() {
            return PollOutcome::Unchanged;
        }
        match self.queue.advance(true) {
            AdvanceOutcome::Playing(id) => match self.load_track(&id) {
                Ok(()) => PollOutcome::Advanced,
                Err(err) => {
                    tracing::error!("auto-advance failed: {err}");
                    self.stop();
                    PollOutcome::Failed(err.to_string())
                }
            },
            AdvanceOutcome::Stopped => {
                self.stop();
                PollOutcome::Stopped
            }
        }
    }

    /// Snapshot for the UI.
    pub fn state(&self) -> PlayerStateDto {
        let current_track = self
            .queue
            .current()
            .and_then(|id| self.library.get(&id).cloned());
        PlayerStateDto {
            status: self.status,
            duration_secs: current_track.as_ref().and_then(|t| t.duration_secs),
            current_track,
            queue_position: self.queue.current_item_index(),
            queue_len: self.queue.len(),
            position_secs: self.engine.position_secs(),
            volume: self.settings.volume,
            shuffle: self.queue.shuffle(),
            repeat: self.queue.repeat(),
        }
    }

    // ----- playlists -----

    pub fn playlists(&self) -> Vec<Playlist> {
        self.playlists.list().into_iter().cloned().collect()
    }

    pub fn create_playlist(&mut self, name: &str) -> Result<Playlist, PlayerError> {
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let id = format!("pl-{created_at}-{}", self.playlists.len());
        let playlist = self.playlists.create(name, id, created_at)?;
        self.persist_playlists()?;
        Ok(playlist)
    }

    pub fn rename_playlist(&mut self, id: &str, new_name: &str) -> Result<(), PlayerError> {
        self.playlists.rename(id, new_name)?;
        self.persist_playlists()?;
        Ok(())
    }

    pub fn delete_playlist(&mut self, id: &str) -> Result<(), PlayerError> {
        self.playlists.delete(id)?;
        self.persist_playlists()?;
        Ok(())
    }

    pub fn add_track_to_playlist(&mut self, id: &str, track: TrackId) -> Result<bool, PlayerError> {
        let added = self.playlists.add_track(id, track)?;
        self.persist_playlists()?;
        Ok(added)
    }

    pub fn remove_track_from_playlist(&mut self, id: &str, track: &str) -> Result<(), PlayerError> {
        self.playlists.remove_track(id, track)?;
        self.persist_playlists()?;
        Ok(())
    }

    pub fn move_track_in_playlist(&mut self, id: &str, from: usize, to: usize) -> Result<(), PlayerError> {
        self.playlists.move_track(id, from, to)?;
        self.persist_playlists()?;
        Ok(())
    }

    /// Resolves playlist entries to tracks (missing files are skipped).
    pub fn playlist_tracks(&self, id: &str) -> Option<Vec<Track>> {
        self.playlists
            .get(id)
            .map(|p| p.items.iter().filter_map(|t| self.library.get(t).cloned()).collect())
    }

    fn persist_playlists(&mut self) -> Result<(), PlayerError> {
        self.persistence.save_playlists(&self.playlists)?;
        Ok(())
    }

    // ----- settings -----

    pub fn settings(&self) -> Settings {
        self.settings.clone()
    }

    /// Persists the close-to-tray behavior (flushed immediately: it changes
    /// what a window close means, so it must survive a crash).
    pub fn set_close_to_tray(&mut self, on: bool) {
        self.settings.close_to_tray = on;
        if let Err(err) = self.persistence.save_settings(&self.settings) {
            tracing::warn!("failed to persist settings: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::fs_scan::ScannedFiles;
    use crate::infra::metadata::MetadataError;
    use crate::infra::persistence::JsonPersistence;
    use std::path::PathBuf;
    use std::sync::Mutex;

    // ---------- mocks ----------

    struct MockScanner {
        files: Mutex<Vec<PathBuf>>,
    }

    impl LibraryScanner for MockScanner {
        fn scan(&self, root: &Path) -> ScannedFiles {
            // Only return the configured files when scanning our fake root.
            let _ = root;
            ScannedFiles {
                files: self.files.lock().unwrap().clone(),
                warnings: Vec::new(),
            }
        }
    }

    struct MockMetadata;

    impl MetadataReader for MockMetadata {
        fn read_track(&self, path: &Path) -> Result<Track, MetadataError> {
            // Deterministic: title from stem, 10s duration.
            let mut track = Track::from_stem(path, 1);
            track.duration_secs = Some(10.0);
            Ok(track)
        }
    }

    #[derive(Default, Clone)]
    struct MockEngineState {
        log: Vec<String>,
        active: bool,
        paused: bool,
        volume: f32,
        path: Option<PathBuf>,
        position: f64,
    }

    struct MockEngine {
        state: Arc<Mutex<MockEngineState>>,
        /// Simulates "track finished" after N is_active() calls while playing.
        finish_after_polls: u32,
    }

    impl MockEngine {
        // `state` is accessed directly by tests through the cloned Arc.
    }

    impl AudioEngine for MockEngine {
        fn load_and_play(&mut self, path: &Path) -> Result<(), crate::infra::audio::engine::AudioError> {
            let mut s = self.state.lock().unwrap();
            s.log.push(format!("open:{}", path.display()));
            s.active = true;
            s.paused = false;
            s.position = 0.0;
            s.path = Some(path.to_path_buf());
            Ok(())
        }
        fn load_paused(&mut self, path: &Path, at_secs: f64) -> Result<(), crate::infra::audio::engine::AudioError> {
            let mut s = self.state.lock().unwrap();
            s.log.push(format!("openPaused:{}@{at_secs:.1}", path.display()));
            s.active = true;
            s.paused = true;
            s.position = at_secs;
            s.path = Some(path.to_path_buf());
            Ok(())
        }
        fn pause(&mut self) {
            let mut s = self.state.lock().unwrap();
            s.log.push("pause".into());
            s.paused = true;
        }
        fn resume(&mut self) {
            let mut s = self.state.lock().unwrap();
            s.log.push("resume".into());
            s.paused = false;
        }
        fn stop(&mut self) {
            let mut s = self.state.lock().unwrap();
            s.log.push("stop".into());
            s.active = false;
            s.paused = false;
            s.path = None;
        }
        fn set_volume(&mut self, volume: f32) {
            self.state.lock().unwrap().volume = volume;
        }
        fn seek(&mut self, secs: f64) -> Result<(), crate::infra::audio::engine::AudioError> {
            let mut s = self.state.lock().unwrap();
            s.log.push(format!("seek:{secs:.1}"));
            s.position = secs;
            Ok(())
        }
        fn position_secs(&self) -> f64 {
            self.state.lock().unwrap().position
        }
        fn volume(&self) -> f32 {
            self.state.lock().unwrap().volume
        }
        fn is_paused(&self) -> bool {
            self.state.lock().unwrap().paused
        }
        fn is_active(&self) -> bool {
            let mut s = self.state.lock().unwrap();
            if s.active && self.finish_after_polls > 0 {
                s.active = false; // simulate end of track on first poll
            }
            s.active
        }
        fn current_path(&self) -> Option<PathBuf> {
            self.state.lock().unwrap().path.clone()
        }
    }

    // ---------- helpers ----------

    /// Service with two fake tracks (a.mp3, b.mp3) plus engine state handle.
    fn service_with_tracks() -> (PlayerService, Arc<Mutex<MockEngineState>>, tempfile::TempDir) {
        let dir = tempfile::TempDir::new().unwrap();
        let files = vec![PathBuf::from("C:/lib/a.mp3"), PathBuf::from("C:/lib/b.mp3")];
        let engine_state = Arc::new(Mutex::new(MockEngineState::default()));
        let engine = MockEngine {
            state: engine_state.clone(),
            finish_after_polls: 0,
        };
        let mut service = PlayerService::new(
            Box::new(engine),
            Arc::new(MockScanner {
                files: Mutex::new(files),
            }),
            Arc::new(MockMetadata),
            Arc::new(JsonPersistence::new(dir.path())),
        )
        .unwrap();
        service.scan_library(Path::new("C:/lib")).unwrap();
        (service, engine_state, dir)
    }

    fn log_of(state: &Arc<Mutex<MockEngineState>>) -> Vec<String> {
        state.lock().unwrap().log.clone()
    }

    // ---------- library / persistence ----------

    #[test]
    fn scan_counts_added_updated_and_prunes_missing() {
        let (mut service, _state, _dir) = service_with_tracks();
        assert_eq!(service.library_len(), 2);

        // Second scan sees only b.mp3 -> a.mp3 is pruned by the merge step.
        let summary = apply_scan_of(&mut service, &["C:/lib/b.mp3"]);
        assert_eq!(summary.removed, 1);
        assert_eq!(service.library_len(), 1);
        assert!(service.get_track("C:/lib/a.mp3").is_none());
    }

    /// Feeds files through the scan merge step (`apply_scan`), which is the
    /// pruning behavior under test.
    fn apply_scan_of(service: &mut PlayerService, files: &[&str]) -> ScanSummary {
        let tracks: Vec<Track> = files
            .iter()
            .map(|f| {
                let mut t = Track::from_stem(Path::new(f), 1);
                t.duration_secs = Some(10.0);
                t
            })
            .collect();
        service.apply_scan(Path::new("C:/lib"), files.len(), tracks, Vec::new())
    }

    #[test]
    fn state_survives_service_restart() {
        let (service, _engine, dir) = service_with_tracks();
        drop(service);
        let engine_state = Arc::new(Mutex::new(MockEngineState::default()));
        let reloaded = PlayerService::new(
            Box::new(MockEngine {
                state: engine_state,
                finish_after_polls: 0,
            }),
            Arc::new(MockScanner {
                files: Mutex::new(vec![]),
            }),
            Arc::new(MockMetadata),
            Arc::new(JsonPersistence::new(dir.path())),
        )
        .unwrap();
        assert_eq!(reloaded.library_len(), 2);
        assert_eq!(reloaded.settings().last_folder.as_deref(), Some("C:/lib"));
    }

    // ---------- playback transitions ----------

    #[test]
    fn play_pause_resume_stop_drive_engine() {
        let (mut service, engine, _dir) = service_with_tracks();
        assert_eq!(service.state().status, PlaybackStatus::Stopped);

        service
            .play_queue(vec!["C:/lib/a.mp3".into(), "C:/lib/b.mp3".into()], Some(0))
            .unwrap();
        assert_eq!(service.state().status, PlaybackStatus::Playing);
        assert_eq!(service.state().current_track.unwrap().id, "C:/lib/a.mp3");

        service.toggle().unwrap(); // playing -> paused
        assert_eq!(service.state().status, PlaybackStatus::Paused);
        service.toggle().unwrap(); // paused -> playing
        service.pause();
        service.resume();
        service.stop();
        assert_eq!(service.state().status, PlaybackStatus::Stopped);
        assert_eq!(
            log_of(&engine),
            vec![
                "open:C:/lib/a.mp3",
                "pause",
                "resume",
                "pause",
                "resume",
                "stop"
            ]
        );
    }

    #[test]
    fn toggle_from_stopped_replays_queue_head() {
        let (mut service, engine, _dir) = service_with_tracks();
        service
            .play_queue(vec!["C:/lib/a.mp3".into()], None)
            .unwrap();
        service.stop();
        service.toggle().unwrap();
        assert_eq!(service.state().status, PlaybackStatus::Playing);
        assert_eq!(log_of(&engine).last().unwrap(), "open:C:/lib/a.mp3");
    }

    #[test]
    fn empty_queue_is_rejected() {
        let (mut service, _engine, _dir) = service_with_tracks();
        assert!(matches!(
            service.play_queue(vec![], None),
            Err(PlayerError::EmptyQueue)
        ));
        assert!(matches!(
            service.toggle(),
            Err(PlayerError::EmptyQueue)
        ));
    }

    #[test]
    fn missing_track_reports_track_not_found() {
        let (mut service, _engine, _dir) = service_with_tracks();
        assert!(matches!(
            service.play_queue(vec!["C:/lib/ghost.mp3".into()], None),
            Err(PlayerError::TrackNotFound(_))
        ));
    }

    // ---------- auto advance ----------

    #[test]
    fn poll_advances_to_next_and_stops_at_end() {
        let dir = tempfile::TempDir::new().unwrap();
        let engine_state = Arc::new(Mutex::new(MockEngineState::default()));
        // Engine finishes a track on the first is_active() poll.
        let engine = MockEngine {
            state: engine_state.clone(),
            finish_after_polls: 1,
        };
        let mut service = PlayerService::new(
            Box::new(engine),
            Arc::new(MockScanner {
                files: Mutex::new(vec![PathBuf::from("C:/x/a.mp3"), PathBuf::from("C:/x/b.mp3")]),
            }),
            Arc::new(MockMetadata),
            Arc::new(JsonPersistence::new(dir.path())),
        )
        .unwrap();
        service.scan_library(Path::new("C:/x")).unwrap();
        service
            .play_queue(vec!["C:/x/a.mp3".into(), "C:/x/b.mp3".into()], Some(0))
            .unwrap();

        // First poll: a.mp3 "finished" -> b.mp3 starts.
        assert_eq!(service.poll(), PollOutcome::Advanced);
        assert_eq!(service.state().current_track.unwrap().id, "C:/x/b.mp3");
        assert_eq!(service.state().status, PlaybackStatus::Playing);

        // Second poll: b.mp3 finished -> queue exhausted -> stop.
        assert_eq!(service.poll(), PollOutcome::Stopped);
        assert_eq!(service.state().status, PlaybackStatus::Stopped);
        assert_eq!(log_of(&engine_state).last().unwrap(), "stop");
    }

    #[test]
    fn poll_replays_track_with_repeat_one() {
        let (mut service, engine, _dir) = service_with_tracks();
        service.set_repeat(RepeatMode::One);
        service.play_queue(vec!["C:/lib/a.mp3".into()], None).unwrap();
        // Simulate end of track.
        engine_set_active(&engine, false);
        assert_eq!(service.poll(), PollOutcome::Advanced);
        assert_eq!(service.state().current_track.unwrap().id, "C:/lib/a.mp3");
        assert_eq!(
            log_of(&engine).iter().filter(|l| l.starts_with("open")).count(),
            2
        );
    }

    fn engine_set_active(engine: &Arc<Mutex<MockEngineState>>, active: bool) {
        engine.lock().unwrap().active = active;
    }

    #[test]
    fn poll_is_noop_when_not_playing() {
        let (mut service, engine, _dir) = service_with_tracks();
        service.play_queue(vec!["C:/lib/a.mp3".into()], None).unwrap();
        service.pause();
        engine_set_active(&engine, false);
        assert_eq!(service.poll(), PollOutcome::Unchanged);
    }

    // ---------- volume / seek ----------

    #[test]
    fn set_volume_applies_clamps_and_persists() {
        let (mut service, engine, dir) = service_with_tracks();
        service.set_volume(2.0).unwrap();
        assert_eq!(service.state().volume, 1.0);
        assert_eq!(engine.lock().unwrap().volume, 1.0);
        assert_eq!(
            JsonPersistence::new(dir.path()).load_settings().unwrap().volume,
            1.0
        );
    }

    #[test]
    fn seek_is_clamped_to_duration() {
        let (mut service, engine, _dir) = service_with_tracks();
        service.play_queue(vec!["C:/lib/a.mp3".into()], None).unwrap();
        service.seek(99.0).unwrap(); // duration is 10s from MockMetadata
        assert_eq!(log_of(&engine).last().unwrap(), "seek:10.0");
    }

    // ---------- playlists ----------

    #[test]
    fn playlist_crud_via_service_persists_and_validates() {
        let (mut service, _engine, dir) = service_with_tracks();
        let playlist = service.create_playlist("Chill").unwrap();
        assert!(service.add_track_to_playlist(&playlist.id, "C:/lib/a.mp3".into()).unwrap());
        assert!(!service.add_track_to_playlist(&playlist.id, "C:/lib/a.mp3".into()).unwrap()); // no dupes
        let tracks = service.playlist_tracks(&playlist.id).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, "C:/lib/a.mp3");

        // Duplicate names rejected.
        assert!(matches!(
            service.create_playlist("chill"),
            Err(PlayerError::Playlist(PlaylistError::DuplicateName(_)))
        ));

        // Survives restart (persisted) - next to the scan's auto playlists.
        drop(service);
        let engine_state = Arc::new(Mutex::new(MockEngineState::default()));
        let reloaded = PlayerService::new(
            Box::new(MockEngine {
                state: engine_state,
                finish_after_polls: 0,
            }),
            Arc::new(MockScanner {
                files: Mutex::new(vec![]),
            }),
            Arc::new(MockMetadata),
            Arc::new(JsonPersistence::new(dir.path())),
        )
        .unwrap();
        // Manual playlist + auto playlists from the earlier scan.
        let names: Vec<(String, bool)> = reloaded
            .playlists()
            .iter()
            .map(|p| (p.name.clone(), p.auto_generated))
            .collect();
        assert_eq!(
            names,
            vec![
                ("All Tracks".to_string(), true),
                ("Default".to_string(), true),
                ("Chill".to_string(), false),
            ]
        );
        let playlists = reloaded.playlists();
        let chill = playlists.iter().find(|p| p.name == "Chill").unwrap();
        assert_eq!(chill.items, vec!["C:/lib/a.mp3".to_string()]);
    }

    #[test]
    fn scan_creates_and_resyncs_folder_playlists() {
        let (mut service, _engine, _dir) = service_with_tracks();
        // Initial scan: both mock files sit in the root -> Default + All.
        let by_name: Vec<(String, usize)> = service
            .playlists()
            .iter()
            .map(|p| (p.name.clone(), p.items.len()))
            .collect();
        assert_eq!(
            by_name,
            vec![("All Tracks".to_string(), 2), ("Default".to_string(), 2)]
        );

        // Rescan where only b.mp3 remains and lives in folder "Solo":
        // Default disappears, "Solo" appears, All Tracks shrinks. The old
        // root-level b.mp3 id is also replaced by the Solo path.
        let summary = apply_scan_of(&mut service, &["C:/lib/Solo/b.mp3"]);
        assert_eq!(summary.removed, 2);
        let by_name: Vec<(String, usize)> = service
            .playlists()
            .iter()
            .map(|p| (p.name.clone(), p.items.len()))
            .collect();
        assert_eq!(
            by_name,
            vec![("All Tracks".to_string(), 1), ("Solo".to_string(), 1)]
        );
    }

    // ---------- shuffle wiring ----------

    #[test]
    fn shuffle_toggle_changes_queue_mode() {
        let (mut service, _engine, _dir) = service_with_tracks();
        assert!(!service.state().shuffle);
        service.set_shuffle(true);
        assert!(service.state().shuffle);
        service.set_repeat(RepeatMode::All);
        assert_eq!(service.state().repeat, RepeatMode::All);
    }

    // ---------- playback session persistence ----------

    fn reopen(dir: &std::path::Path) -> (PlayerService, Arc<Mutex<MockEngineState>>) {
        let engine_state = Arc::new(Mutex::new(MockEngineState::default()));
        let service = PlayerService::new(
            Box::new(MockEngine {
                state: engine_state.clone(),
                finish_after_polls: 0,
            }),
            Arc::new(MockScanner {
                files: Mutex::new(vec![]),
            }),
            Arc::new(MockMetadata),
            Arc::new(JsonPersistence::new(dir)),
        )
        .unwrap();
        (service, engine_state)
    }

    fn saved_session(dir: &std::path::Path) -> Option<PlaybackSession> {
        JsonPersistence::new(dir).load_playback().unwrap()
    }

    #[test]
    fn playback_persists_queue_position_and_modes() {
        let (mut service, _engine, dir) = service_with_tracks();
        service.set_repeat(RepeatMode::All);
        service
            .play_queue(vec!["C:/lib/a.mp3".into(), "C:/lib/b.mp3".into()], Some(0))
            .unwrap();
        service.seek(4.0).unwrap();

        let session = saved_session(dir.path()).unwrap();
        assert_eq!(session.queue, vec!["C:/lib/a.mp3", "C:/lib/b.mp3"]);
        assert_eq!(session.current_index, 0);
        assert!((session.position_secs - 4.0).abs() < 1e-9);
        assert_eq!(session.repeat, RepeatMode::All);
        assert!(!session.shuffle);
    }

    #[test]
    fn stop_clears_persisted_session() {
        let (mut service, _engine, dir) = service_with_tracks();
        service.play_queue(vec!["C:/lib/a.mp3".into()], None).unwrap();
        assert!(saved_session(dir.path()).is_some());
        service.stop();
        assert_eq!(saved_session(dir.path()), None);
    }

    #[test]
    fn restart_restores_paused_session_at_last_position() {
        let (mut service, _engine, dir) = service_with_tracks();
        service
            .play_queue(vec!["C:/lib/a.mp3".into(), "C:/lib/b.mp3".into()], Some(0))
            .unwrap();
        service.set_shuffle(true);
        service.seek(4.0).unwrap();
        service.pause();
        drop(service);

        let (mut restored, engine_state) = reopen(dir.path());
        let state = restored.state();
        assert_eq!(state.status, PlaybackStatus::Paused);
        assert_eq!(state.current_track.unwrap().id, "C:/lib/a.mp3");
        assert!((state.position_secs - 4.0).abs() < 1e-9);
        assert_eq!(state.queue_len, 2);
        assert!(state.shuffle);
        assert_eq!(
            log_of(&engine_state),
            vec!["openPaused:C:/lib/a.mp3@4.0".to_string()]
        );

        // Restored paused: the poller must not treat it as playing/finished.
        assert_eq!(restored.poll(), PollOutcome::Unchanged);
        // Pressing play continues the restored track.
        restored.toggle().unwrap();
        assert_eq!(restored.state().status, PlaybackStatus::Playing);
        assert_eq!(log_of(&engine_state).last().unwrap(), "resume");
    }

    #[test]
    fn restart_without_session_stays_stopped() {
        let (_service, _engine, dir) = service_with_tracks();
        // No playback happened: nothing to restore.
        let (restored, _engine) = reopen(dir.path());
        assert_eq!(restored.state().status, PlaybackStatus::Stopped);
        assert_eq!(restored.state().current_track, None);
    }

    #[test]
    fn restore_drops_session_when_track_left_the_library() {
        let (_service, _engine, dir) = service_with_tracks();
        JsonPersistence::new(dir.path())
            .save_playback(&PlaybackSession {
                queue: vec!["C:/lib/ghost.mp3".into()],
                current_index: 0,
                position_secs: 3.0,
                shuffle: false,
                repeat: RepeatMode::Off,
            })
            .unwrap();
        let (restored, _engine) = reopen(dir.path());
        assert_eq!(restored.state().status, PlaybackStatus::Stopped);
        assert_eq!(restored.state().current_track, None);
        assert_eq!(saved_session(dir.path()), None);
    }

    #[test]
    fn corrupt_session_file_never_blocks_startup() {
        let (_service, _engine, dir) = service_with_tracks();
        std::fs::write(dir.path().join("playback.json"), b"{ nope").unwrap();
        let (restored, _engine) = reopen(dir.path());
        assert_eq!(restored.state().status, PlaybackStatus::Stopped);
    }

    #[test]
    fn poll_periodically_flushes_live_position() {
        let (mut service, engine, dir) = service_with_tracks();
        service.play_queue(vec!["C:/lib/a.mp3".into()], None).unwrap();
        // Simulate the crash case: no seek/pause transition, only time.
        service.session_save_interval = Duration::ZERO;
        engine.lock().unwrap().position = 7.5;
        assert_eq!(service.poll(), PollOutcome::Unchanged);
        let session = saved_session(dir.path()).unwrap();
        assert!((session.position_secs - 7.5).abs() < 1e-9);
    }

    // ---------- close-to-tray setting ----------

    #[test]
    fn set_close_to_tray_persists_across_restart() {
        let (mut service, _engine, dir) = service_with_tracks();
        service.set_close_to_tray(false);
        assert!(!service.settings().close_to_tray);
        // Read back from disk like a fresh launch would.
        assert!(
            !JsonPersistence::new(dir.path())
                .load_settings()
                .unwrap()
                .close_to_tray
        );
    }
}
