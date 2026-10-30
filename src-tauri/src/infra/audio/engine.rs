//! Playback engine: rodio sink management around `SymphoniaSource`.
//!
//! rodio's `OutputStream` is not `Send` on all platforms (it wraps a raw
//! device pointer), so the engine cannot live behind a mutex. Instead a
//! dedicated "audio thread" owns the stream/sink and executes commands sent
//! through a channel; `RodioEngine` is just a `Send` proxy to that thread.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use rodio::{OutputStream, OutputStreamHandle, Sink};

use super::symphonia_source::{PosTracker, SourceError, SymphoniaSource};
use symphonia::core::io::MediaSourceStream;

/// Engine-level errors.
#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("no audio output device available")]
    NoDevice,
    #[error("cannot open file '{0}'")]
    OpenFile(String),
    #[error("cannot decode '{0}': {1}")]
    Decode(String, String),
}

impl From<SourceError> for AudioError {
    fn from(err: SourceError) -> Self {
        match &err {
            SourceError::NoTrack(f) | SourceError::Decode(f, _) => {
                AudioError::Decode(f.clone(), err.to_string())
            }
        }
    }
}

/// Controls the audio device. Implemented by `RodioEngine` in production and
/// by mocks in service tests.
pub trait AudioEngine: Send {
    /// Opens `path` and starts playing it immediately from the start.
    fn load_and_play(&mut self, path: &Path) -> Result<(), AudioError>;
    fn pause(&mut self);
    fn resume(&mut self);
    /// Stops playback and releases the current track.
    fn stop(&mut self);
    /// Linear volume 0.0 - 1.0.
    fn set_volume(&mut self, volume: f32);
    /// Seeks within the current track (no-op when nothing is loaded).
    fn seek(&mut self, secs: f64) -> Result<(), AudioError>;
    fn position_secs(&self) -> f64;
    fn volume(&self) -> f32;
    /// True when a track is loaded and the user paused it.
    fn is_paused(&self) -> bool;
    /// True when a track is loaded and still holds audio to play.
    fn is_active(&self) -> bool;
    /// Path of the loaded track, if any.
    fn current_path(&self) -> Option<PathBuf>;
}

/// Reply channel type used by commands that need a result.
type Reply<T> = Sender<T>;

enum Command {
    Open {
        path: PathBuf,
        at_secs: Option<f64>,
        reply: Reply<Result<Arc<PosTracker>, AudioError>>,
    },
    Pause,
    Resume,
    Stop {
        reply: Reply<()>,
    },
    SetVolume {
        volume: f32,
    },
    Seek {
        secs: f64,
        reply: Reply<Result<(), AudioError>>,
    },
    Query {
        reply: Reply<EngineSnapshot>,
    },
}

/// Point-in-time state of the audio thread, used to answer trait queries.
#[derive(Debug, Clone, Default)]
struct EngineSnapshot {
    paused: bool,
    active: bool,
    volume: f32,
    current_path: Option<PathBuf>,
    tracker: Option<Arc<PosTracker>>,
}

/// State owned by the audio thread. Never shared directly.
struct DeviceState {
    _stream: OutputStream,
    handle: OutputStreamHandle,
    sink: Option<Sink>,
    volume: f32,
    paused: bool,
    path: Option<PathBuf>,
    tracker: Option<Arc<PosTracker>>,
}

impl DeviceState {
    fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            paused: self.paused,
            active: self.sink.as_ref().map(|s| !s.empty()).unwrap_or(false),
            volume: self.volume,
            current_path: self.path.clone(),
            tracker: self.tracker.clone(),
        }
    }

    /// (Re)creates the sink for `path`, optionally starting at `at_secs`.
    fn open_at(&mut self, path: &Path, at_secs: Option<f64>) -> Result<Arc<PosTracker>, AudioError> {
        let file =
            File::open(path).map_err(|_| AudioError::OpenFile(path.display().to_string()))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut source = SymphoniaSource::new(mss, path.display().to_string())
            .map_err(AudioError::from)?;
        if let Some(secs) = at_secs {
            source.seek_by_time(secs)?;
        }
        let tracker = source.position_tracker();
        let sink = Sink::try_new(&self.handle).map_err(|_| AudioError::NoDevice)?;
        sink.set_volume(self.volume);
        sink.append(source);
        // Replacing the previous sink drops (and therefore stops) it.
        self.sink = Some(sink);
        self.tracker = Some(tracker.clone());
        self.path = Some(path.to_path_buf());
        self.paused = false;
        Ok(tracker)
    }
}

/// `Send` proxy to the audio-owning thread.
pub struct RodioEngine {
    tx: Sender<Command>,
    snapshot: Arc<Mutex<EngineSnapshot>>,
}

impl RodioEngine {
    /// Connects to the default output device on a dedicated thread.
    ///
    /// The stream must be created *inside* the thread because it is not
    /// `Send`; a handshake channel reports whether the device opened.
    pub fn new() -> Result<Self, AudioError> {
        let snapshot = Arc::new(Mutex::new(EngineSnapshot::default()));
        let thread_snapshot = snapshot.clone();
        let (tx, rx) = mpsc::channel::<Command>();
        let (init_tx, init_rx) = mpsc::channel::<Result<(), AudioError>>();
        std::thread::Builder::new()
            .name("lumusic-audio".into())
            .spawn(move || {
                let (stream, handle) = match OutputStream::try_default() {
                    Ok(pair) => pair,
                    Err(_) => {
                        let _ = init_tx.send(Err(AudioError::NoDevice));
                        return;
                    }
                };
                let state = DeviceState {
                    _stream: stream,
                    handle,
                    sink: None,
                    volume: 0.8,
                    paused: false,
                    path: None,
                    tracker: None,
                };
                let _ = init_tx.send(Ok(()));
                audio_loop(state, rx, thread_snapshot);
            })
            .map_err(|_| AudioError::NoDevice)?;
        init_rx.recv().map_err(|_| AudioError::NoDevice)??;
        Ok(Self { tx, snapshot })
    }

    fn call<T>(&self, build: impl FnOnce(Reply<T>) -> Command) -> Option<T> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx.send(build(reply_tx)).ok()?;
        reply_rx.recv().ok()
    }

    fn query(&self) -> EngineSnapshot {
        self.call(|reply| Command::Query { reply }).unwrap_or_default()
    }
}

/// Command loop running on the audio thread.
fn audio_loop(
    mut state: DeviceState,
    rx: mpsc::Receiver<Command>,
    snapshot: Arc<Mutex<EngineSnapshot>>,
) {
    let publish = |state: &DeviceState, snapshot: &Arc<Mutex<EngineSnapshot>>| {
        let snap = state.snapshot();
        *snapshot.lock().unwrap_or_else(|e| e.into_inner()) = snap;
    };
    while let Ok(command) = rx.recv() {
        match command {
            Command::Open { path, at_secs, reply } => {
                let result = state.open_at(&path, at_secs);
                let _ = reply.send(result);
            }
            Command::Pause => {
                if let Some(sink) = &state.sink {
                    sink.pause();
                    state.paused = true;
                }
            }
            Command::Resume => {
                if let Some(sink) = &state.sink {
                    sink.play();
                    state.paused = false;
                }
            }
            Command::Stop { reply } => {
                state.sink = None; // dropping stops playback
                state.tracker = None;
                state.path = None;
                state.paused = false;
                let _ = reply.send(());
            }
            Command::SetVolume { volume } => {
                state.volume = volume.clamp(0.0, 1.0);
                if let Some(sink) = &state.sink {
                    sink.set_volume(state.volume);
                }
            }
            Command::Seek { secs, reply } => {
                let result = match state.path.clone() {
                    Some(path) => state.open_at(&path, Some(secs)).map(|_| ()),
                    None => Ok(()), // nothing loaded: seek is a no-op
                };
                let _ = reply.send(result);
            }
            Command::Query { reply } => {
                let _ = reply.send(state.snapshot());
            }
        }
        publish(&state, &snapshot);
    }
}

impl AudioEngine for RodioEngine {
    fn load_and_play(&mut self, path: &Path) -> Result<(), AudioError> {
        match self.call(|reply| Command::Open {
            path: path.to_path_buf(),
            at_secs: None,
            reply,
        }) {
            Some(result) => result.map(|_| ()),
            None => Err(AudioError::NoDevice), // audio thread is gone
        }
    }

    fn pause(&mut self) {
        let _ = self.tx.send(Command::Pause);
    }

    fn resume(&mut self) {
        let _ = self.tx.send(Command::Resume);
    }

    fn stop(&mut self) {
        let _ = self.call(|reply| Command::Stop { reply });
    }

    fn set_volume(&mut self, volume: f32) {
        let _ = self.tx.send(Command::SetVolume { volume });
    }

    fn seek(&mut self, secs: f64) -> Result<(), AudioError> {
        match self.call(|reply| Command::Seek { secs, reply }) {
            Some(result) => result,
            None => Err(AudioError::NoDevice),
        }
    }

    fn position_secs(&self) -> f64 {
        self.snapshot
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .tracker
            .as_ref()
            .map(|t| t.position_secs())
            .unwrap_or(0.0)
    }

    fn volume(&self) -> f32 {
        self.query().volume
    }

    fn is_paused(&self) -> bool {
        self.query().paused
    }

    fn is_active(&self) -> bool {
        self.query().active
    }

    fn current_path(&self) -> Option<PathBuf> {
        self.query().current_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_error_converts_from_source_error() {
        let err = AudioError::from(SourceError::NoTrack("x.mp3".into()));
        assert!(err.to_string().contains("x.mp3"));
    }
}
