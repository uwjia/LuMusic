//! Library folder watcher: silent incremental merges of filesystem
//! changes, so renames/moves/deletes on disk never leave dead library
//! entries and new files appear without a manual rescan.
//!
//! Pipeline mirrors the scan's two phases: events are debounced
//! (editors emit bursts — temp file, rename, metadata), the disk is
//! asked for the truth at flush time, metadata reads run *outside* the
//! service lock, and the merge is one brief `apply_scan` — playback is
//! never blocked. The frontend needs no new surface: the regular
//! `library://updated` event already refreshes the library and playlists.
//!
//! Testing seams: event bookkeeping (`record`), flush partitioning and
//! the merge itself run against real tempdirs and a mock metadata
//! reader; the loop's debounce timing is driven through synthetic
//! messages with a tiny settle window. Only the notify wiring itself is
//! a thin untestable shell.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::service::PlayerService;
use super::state::SharedService;
use crate::domain::scan::{is_audio_file, ScanSummary};
use crate::infra::metadata::MetadataReader;

/// Quiet period after the latest event before the batch merges. Editors
/// and archive tools emit bursts around a single logical change.
const SETTLE: Duration = Duration::from_millis(800);
/// Ceiling on batching under continuous activity: a large copy job must
/// not postpone the merge indefinitely.
const MAX_WAIT: Duration = Duration::from_secs(3);

/// Everything the loop consumes: notify events and lifecycle commands
/// share one channel so a single `recv_timeout` drives the debounce.
enum WatchMsg {
    Fs(Result<Event, notify::Error>),
    /// Watch this root instead (drops any pending batch — those events
    /// belong to the old tree, and merging them under the new root's
    /// auto-playlist plan would misfile them as root-level files).
    SetRoot(PathBuf),
    Stop,
}

/// Latest-wins state of one path. Only the disk is authoritative at flush
/// time; this merely hints which side to check.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Pending {
    Changed,
    Removed,
}

/// Records an event into the pending batch (last write wins).
fn record(pending: &mut HashMap<PathBuf, Pending>, event: &Event) {
    let removed = matches!(event.kind, EventKind::Remove(_));
    let rename = matches!(event.kind, EventKind::Modify(ModifyKind::Name(_)));
    match (rename, event.paths.as_slice()) {
        // Rename events carry [from, to]: the source path is gone, the
        // target is new.
        (true, [from, to]) => {
            pending.insert(from.clone(), Pending::Removed);
            pending.insert(to.clone(), Pending::Changed);
        }
        _ => {
            for path in &event.paths {
                pending.insert(
                    path.clone(),
                    if removed {
                        Pending::Removed
                    } else {
                        Pending::Changed
                    },
                );
            }
        }
    }
}

/// Splits a settled batch by asking the disk: a Changed that has since
/// vanished is really a remove (bursty rename), a Removed that exists
/// again is really a refresh. Directories never refresh (their files
/// carry their own events); a removed path may be a file or a gone
/// directory — the merge prunes both.
fn partition(pending: HashMap<PathBuf, Pending>) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut refresh = Vec::new();
    let mut removed = Vec::new();
    for (path, kind) in pending {
        match kind {
            Pending::Changed if path.is_file() => refresh.push(path),
            Pending::Removed if !path.exists() => removed.push(path),
            Pending::Changed | Pending::Removed => {}
        }
    }
    (refresh, removed)
}

/// One debounce window's outcome.
#[derive(Debug, Default, PartialEq)]
struct FlushOutcome {
    added: usize,
    updated: usize,
    removed: usize,
    skipped: usize,
}

impl FlushOutcome {
    fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

/// Reads metadata for the refresh set (outside the service lock), then
/// merges in one brief critical section.
fn flush(
    pending: HashMap<PathBuf, Pending>,
    metadata: &dyn MetadataReader,
    service: &Mutex<PlayerService>,
    emit: &dyn Fn(&ScanSummary),
) -> FlushOutcome {
    let (refresh, removed): (Vec<PathBuf>, Vec<PathBuf>) = partition(pending);
    let refresh: Vec<PathBuf> = refresh.into_iter().filter(|p| is_audio_file(p)).collect();
    if refresh.is_empty() && removed.is_empty() {
        return FlushOutcome::default();
    }
    let mut tracks = Vec::with_capacity(refresh.len());
    let mut warnings = Vec::new();
    for path in &refresh {
        match metadata.read_track(path) {
            Ok(track) => tracks.push(track),
            Err(err) => {
                if warnings.len() < 100 {
                    warnings.push(format!("skipped '{}': {err}", path.display()));
                }
            }
        }
    }
    let Ok(mut guard) = service.lock() else {
        return FlushOutcome::default();
    };
    let summary = guard.merge_fs_changes(tracks, &removed, warnings);
    let outcome = FlushOutcome {
        added: summary.added,
        updated: summary.updated,
        removed: summary.removed,
        skipped: summary.skipped,
    };
    drop(guard);
    if outcome.changed() {
        tracing::info!(
            "watcher merged: +{} ~{} -{} ({} skipped)",
            outcome.added,
            outcome.updated,
            outcome.removed,
            outcome.skipped
        );
        emit(&summary);
    }
    outcome
}

/// Starts a recursive notify watcher forwarding into `tx`.
fn start_watcher(root: &Path, tx: &Sender<WatchMsg>) -> notify::Result<RecommendedWatcher> {
    let forwarding = {
        let tx = tx.clone();
        move |event| {
            let _ = tx.send(WatchMsg::Fs(event));
        }
    };
    let mut watcher = notify::recommended_watcher(forwarding)?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

struct LoopState {
    watcher: Option<RecommendedWatcher>,
    pending: HashMap<PathBuf, Pending>,
    /// Oldest and newest event of the current batch (debounce clocks).
    first: Option<Instant>,
    last: Instant,
}

/// Debounce loop: batches events until `settle` passes since the latest
/// one (or `max_wait` since the first), then flushes. Timing parameters
/// are injected so tests can run the loop at millisecond scales.
fn watch_loop(
    rx: Receiver<WatchMsg>,
    tx: Sender<WatchMsg>,
    metadata: Arc<dyn MetadataReader>,
    service: SharedService,
    emit: Arc<dyn Fn(&ScanSummary) + Send + Sync>,
    settle: Duration,
    max_wait: Duration,
) {
    let mut state = LoopState {
        watcher: None,
        pending: HashMap::new(),
        first: None,
        last: Instant::now(),
    };
    let emit_ref = &*emit;
    loop {
        // Sleep until the batch is due — or indefinitely while idle.
        let timeout = state.first.map(|first| {
            let by_settle = settle.saturating_sub(state.last.elapsed());
            let by_age = max_wait.saturating_sub(first.elapsed());
            by_settle.min(by_age)
        });
        let message = match timeout {
            None => match rx.recv() {
                Ok(message) => message,
                Err(_) => return, // sender gone: app teardown
            },
            Some(wait) => match rx.recv_timeout(wait) {
                Ok(message) => message,
                Err(RecvTimeoutError::Timeout) => {
                    let pending = std::mem::take(&mut state.pending);
                    state.first = None;
                    flush(pending, metadata.as_ref(), &service, emit_ref);
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return,
            },
        };
        match message {
            WatchMsg::Fs(Ok(event)) => {
                if state.first.is_none() {
                    state.first = Some(Instant::now());
                }
                state.last = Instant::now();
                record(&mut state.pending, &event);
            }
            WatchMsg::Fs(Err(err)) => {
                tracing::debug!("watch event error: {err}");
            }
            WatchMsg::SetRoot(root) => {
                // Old-tree events are stale by definition; drop them (see
                // WatchMsg::SetRoot).
                state.pending.clear();
                state.first = None;
                match start_watcher(&root, &tx) {
                    Ok(watcher) => {
                        state.watcher = Some(watcher);
                        tracing::info!("watching library folder {}", root.display());
                    }
                    Err(err) => {
                        // Root deleted mid-session or otherwise unwatchable:
                        // degrade to "no watching", never a crash.
                        state.watcher = None;
                        tracing::warn!("cannot watch {}: {err}", root.display());
                    }
                }
            }
            WatchMsg::Stop => return,
        }
    }
}

/// Managed handle to the watch thread. Dropping it stops the thread (the
/// channel disconnect acts as `Stop` too).
#[derive(Clone)]
pub struct LibraryWatch {
    tx: Sender<WatchMsg>,
}

impl LibraryWatch {
    /// Spawns the watch loop; nothing is watched until `set_root`.
    /// `emit` receives every merged summary (used for the
    /// `library://updated` event).
    pub fn start(
        metadata: Arc<dyn MetadataReader>,
        service: SharedService,
        emit: Arc<dyn Fn(&ScanSummary) + Send + Sync>,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<WatchMsg>();
        let loop_tx = tx.clone();
        let loop_emit = emit.clone();
        std::thread::Builder::new()
            .name("lumusic-watch".into())
            .spawn(move || {
                watch_loop(
                    rx,
                    loop_tx,
                    metadata,
                    service,
                    loop_emit,
                    SETTLE,
                    MAX_WAIT,
                )
            })
            .expect("watch thread starts");
        Self { tx }
    }

    /// Switches the watched root (called after a successful scan and on
    /// startup for the restored last folder).
    pub fn set_root(&self, root: &Path) {
        let _ = self.tx.send(WatchMsg::SetRoot(root.to_path_buf()));
    }
}

impl Drop for LibraryWatch {
    fn drop(&mut self) {
        let _ = self.tx.send(WatchMsg::Stop);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::track::Track;
    use crate::infra::fs_scan::{LibraryScanner, ScannedFiles};
    use crate::infra::metadata::MetadataError;
    use crate::infra::persistence::JsonPersistence;
    use notify::event::{CreateKind, RemoveKind, RenameMode};
    use std::path::Path;

    // ---------- mocks (same shape as the service tests') ----------

    struct MockScanner {
        files: Mutex<Vec<PathBuf>>,
    }

    impl LibraryScanner for MockScanner {
        fn scan(&self, _root: &Path) -> ScannedFiles {
            ScannedFiles {
                files: self.files.lock().unwrap().clone(),
                warnings: Vec::new(),
            }
        }
    }

    struct MockMetadata;

    impl MetadataReader for MockMetadata {
        fn read_track(&self, path: &Path) -> Result<Track, MetadataError> {
            let mut track = Track::from_stem(path, 1);
            track.duration_secs = Some(10.0);
            Ok(track)
        }
    }

    struct SilentEngine;

    impl crate::infra::audio::engine::AudioEngine for SilentEngine {
        fn load_and_play(
            &mut self,
            _path: &Path,
        ) -> Result<(), crate::infra::audio::engine::AudioError> {
            Ok(())
        }
        fn load_paused(
            &mut self,
            _path: &Path,
            _at_secs: f64,
        ) -> Result<(), crate::infra::audio::engine::AudioError> {
            Ok(())
        }
        fn pause(&mut self) {}
        fn resume(&mut self) {}
        fn stop(&mut self) {}
        fn set_volume(&mut self, _volume: f32) {}
        fn set_eq(&mut self, _eq: &crate::domain::equalizer::EqSettings) {}
        fn seek(
            &mut self,
            _secs: f64,
        ) -> Result<(), crate::infra::audio::engine::AudioError> {
            Ok(())
        }
        fn position_secs(&self) -> f64 {
            0.0
        }
        fn volume(&self) -> f32 {
            0.8
        }
        fn is_paused(&self) -> bool {
            false
        }
        fn is_active(&self) -> bool {
            false
        }
        fn current_path(&self) -> Option<PathBuf> {
            None
        }
    }

    fn mock_service(dir: &Path, files: Vec<PathBuf>) -> SharedService {
        let service = PlayerService::new(
            Box::new(SilentEngine),
            Arc::new(MockScanner {
                files: Mutex::new(files),
            }),
            Arc::new(MockMetadata),
            Arc::new(crate::infra::lyrics::FsLyricSource),
            Arc::new(JsonPersistence::new(dir)),
            Arc::new(crate::infra::shell::SystemRevealer),
        )
        .unwrap();
        Arc::new(Mutex::new(service))
    }

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        paths
            .iter()
            .fold(Event::new(kind), |event, path| {
                event.add_path(PathBuf::from(path))
            })
    }

    // ---------- event bookkeeping ----------

    #[test]
    fn record_keeps_the_latest_state_per_path() {
        let mut pending = HashMap::new();
        record(
            &mut pending,
            &event(EventKind::Create(CreateKind::Any), &["C:/m/a.mp3"]),
        );
        record(
            &mut pending,
            &event(EventKind::Remove(RemoveKind::Any), &["C:/m/a.mp3"]),
        );
        assert_eq!(pending.get(Path::new("C:/m/a.mp3")), Some(&Pending::Removed));
    }

    #[test]
    fn record_splits_rename_events_into_source_and_target() {
        let mut pending = HashMap::new();
        record(
            &mut pending,
            &event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &["C:/m/old.mp3", "C:/m/new.mp3"],
            ),
        );
        assert_eq!(pending.get(Path::new("C:/m/old.mp3")), Some(&Pending::Removed));
        assert_eq!(pending.get(Path::new("C:/m/new.mp3")), Some(&Pending::Changed));
    }

    #[test]
    fn partition_trusts_the_disk_over_event_kinds() {
        let dir = tempfile::TempDir::new().unwrap();
        let existing = dir.path().join("there.mp3");
        std::fs::write(&existing, b"x").unwrap();
        let back_from_dead = dir.path().join("back.txt");
        std::fs::write(&back_from_dead, b"x").unwrap();

        let mut pending = HashMap::new();
        pending.insert(existing.clone(), Pending::Changed); // on disk -> refresh
        pending.insert(dir.path().join("gone.mp3"), Pending::Changed); // vanished -> drop
        pending.insert(dir.path().join("dead.mp3"), Pending::Removed); // gone -> remove
        pending.insert(back_from_dead.clone(), Pending::Removed); // exists again -> drop
        pending.insert(dir.path().to_path_buf(), Pending::Changed); // directory -> drop

        let (refresh, removed) = partition(pending);
        assert_eq!(refresh, vec![existing]);
        assert_eq!(removed, vec![dir.path().join("dead.mp3")]);
    }

    // ---------- flush / merge ----------

    /// Service seeded by a scan over `files`; the watcher flush then adds
    /// one on-disk file and removes one vanished one.
    #[test]
    fn flush_merges_additions_and_removals_into_the_library() {
        let dir = tempfile::TempDir::new().unwrap();
        let a = dir.path().join("a.mp3");
        let service = mock_service(dir.path(), vec![a.clone()]);
        service.lock().unwrap().scan_library(dir.path()).unwrap();
        assert_eq!(service.lock().unwrap().library_len(), 1);

        // b appears on disk (garbage bytes are fine: the mock metadata
        // reader derives tracks from paths), a is gone.
        let b = dir.path().join("b.mp3");
        std::fs::write(&b, b"not really audio").unwrap();
        let mut pending = HashMap::new();
        pending.insert(b.clone(), Pending::Changed);
        pending.insert(a.clone(), Pending::Removed);

        let emissions = Arc::new(Mutex::new(Vec::new()));
        let sink = emissions.clone();
        let outcome = flush(
            pending,
            &MockMetadata,
            &service,
            &move |summary: &ScanSummary| sink.lock().unwrap().push(summary.clone()),
        );
        assert_eq!(
            outcome,
            FlushOutcome {
                added: 1,
                updated: 0,
                removed: 1,
                skipped: 0
            }
        );
        let guard = service.lock().unwrap();
        assert_eq!(guard.library_len(), 1);
        assert!(guard.get_track(&b.to_string_lossy()).is_some());
        assert!(guard.get_track(&a.to_string_lossy()).is_none());
        // Auto playlists followed the change.
        let all: Vec<usize> = guard
            .playlists()
            .iter()
            .filter(|p| p.name == "All Tracks")
            .map(|p| p.items.len())
            .collect();
        assert_eq!(all, vec![1]);
        // The merge was announced (frontend reload hook).
        assert_eq!(emissions.lock().unwrap().len(), 1);
    }

    /// A removed directory takes its whole subtree with it — the library
    /// must not keep children as dead entries.
    #[test]
    fn removing_a_directory_prunes_its_children() {
        let dir = tempfile::TempDir::new().unwrap();
        let child = dir.path().join("Rock").join("x.mp3");
        let root_file = dir.path().join("root.mp3");
        let service = mock_service(dir.path(), vec![child.clone(), root_file.clone()]);
        service.lock().unwrap().scan_library(dir.path()).unwrap();
        assert_eq!(service.lock().unwrap().library_len(), 2);

        let mut guard = service.lock().unwrap();
        let summary = guard.merge_fs_changes(Vec::new(), &[dir.path().join("Rock")], Vec::new());
        assert_eq!(summary.removed, 1);
        assert_eq!(guard.library_len(), 1);
        assert!(guard.get_track(&root_file.to_string_lossy()).is_some());
        assert!(guard.get_track(&child.to_string_lossy()).is_none());
        // The folder playlist vanished with its folder.
        assert!(!guard.playlists().iter().any(|p| p.name == "Rock"));
        assert_eq!(summary.added, 0);
    }

    #[test]
    fn flush_without_library_relevant_changes_stays_silent() {
        let dir = tempfile::TempDir::new().unwrap();
        let service = mock_service(dir.path(), vec![dir.path().join("a.mp3")]);
        service.lock().unwrap().scan_library(dir.path()).unwrap();

        // Only a non-audio text file changed: nothing to merge, nothing
        // to announce.
        std::fs::write(dir.path().join("notes.txt"), b"hi").unwrap();
        let mut pending = HashMap::new();
        pending.insert(dir.path().join("notes.txt"), Pending::Changed);
        let emissions = Arc::new(Mutex::new(Vec::new()));
        let sink = emissions.clone();
        let outcome = flush(pending, &MockMetadata, &service, &move |s| {
            sink.lock().unwrap().push(s.clone())
        });
        assert!(!outcome.changed());
        assert!(emissions.lock().unwrap().is_empty());
    }

    // ---------- loop timing ----------

    /// Drives the real loop with synthetic events at a tiny settle window:
    /// a burst coalesces into one flush, SetRoot discards pending events,
    /// Stop ends the thread.
    #[test]
    fn watch_loop_debounces_bursts_into_one_merge() {
        let dir = tempfile::TempDir::new().unwrap();
        let b = dir.path().join("b.mp3");
        std::fs::write(&b, b"x").unwrap();
        let c = dir.path().join("c.mp3");
        std::fs::write(&c, b"x").unwrap();
        let service = mock_service(dir.path(), vec![dir.path().join("a.mp3")]);
        service.lock().unwrap().scan_library(dir.path()).unwrap();

        let emissions = Arc::new(Mutex::new(Vec::new()));
        let sink = emissions.clone();
        let emit: Arc<dyn Fn(&ScanSummary) + Send + Sync> =
            Arc::new(move |s: &ScanSummary| sink.lock().unwrap().push(s.clone()));
        let (tx, rx) = mpsc::channel::<WatchMsg>();
        let handle = {
            let service = service.clone();
            let tx = tx.clone();
            std::thread::Builder::new()
                .name("test-watch".into())
                .spawn(move || {
                    watch_loop(
                        rx,
                        tx,
                        Arc::new(MockMetadata),
                        service,
                        emit,
                        Duration::from_millis(60),
                        Duration::from_millis(500),
                    )
                })
                .unwrap()
        };

        // A burst of two events for two files (plus one duplicate) — the
        // settle window must coalesce them into a single merge.
        tx.send(WatchMsg::Fs(Ok(event(
            EventKind::Create(CreateKind::Any),
            &[b.to_string_lossy().as_ref()],
        ))))
        .unwrap();
        tx.send(WatchMsg::Fs(Ok(event(
            EventKind::Create(CreateKind::Any),
            &[c.to_string_lossy().as_ref()],
        ))))
        .unwrap();
        tx.send(WatchMsg::Fs(Ok(event(
            EventKind::Modify(ModifyKind::Any),
            &[c.to_string_lossy().as_ref()],
        ))))
        .unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while emissions.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let merged = emissions.lock().unwrap();
        assert_eq!(merged.len(), 1, "burst must coalesce into one merge");
        assert_eq!(merged[0].added, 2);
        drop(merged);
        assert_eq!(service.lock().unwrap().library_len(), 3);

        // A pending event followed by SetRoot is discarded, never merged
        // under the wrong root.
        tx.send(WatchMsg::Fs(Ok(event(
            EventKind::Create(CreateKind::Any),
            &[c.to_string_lossy().as_ref()],
        ))))
        .unwrap();
        tx.send(WatchMsg::SetRoot(dir.path().to_path_buf())).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(
            emissions.lock().unwrap().len(),
            1,
            "pre-switch events must be dropped, not merged"
        );

        tx.send(WatchMsg::Stop).unwrap();
        assert!(handle.join().is_ok());
    }
}
