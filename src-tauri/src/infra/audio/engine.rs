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

use super::equalizer::{EqualizerSource, SharedEq};
use super::spectrum::{SpectrumAnalyzer, SpectrumTap};
use super::symphonia_source::{PosTracker, SourceError, SymphoniaSource};
use crate::domain::equalizer::EqSettings;
use crate::domain::spectrum::FFT_SIZE;
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
    /// Opens `path` positioned at `at_secs` **without starting playback**
    /// (session restore). Pressing play afterwards continues from `at_secs`.
    fn load_paused(&mut self, path: &Path, at_secs: f64) -> Result<(), AudioError>;
    fn pause(&mut self);
    fn resume(&mut self);
    /// Stops playback and releases the current track.
    fn stop(&mut self);
    /// Linear volume 0.0 - 1.0.
    fn set_volume(&mut self, volume: f32);
    /// Applies equalizer settings live (no sink recreation, no gap).
    fn set_eq(&mut self, eq: &EqSettings);
    /// Latest spectrum frame (normalized per-bar magnitudes), or `None`
    /// when no engine captures audio (device-less, mock engines). Default
    /// `None` keeps mock/null engines untouched.
    fn spectrum(&mut self) -> Option<Vec<f32>> {
        None
    }
    /// Seeks within the current track (no-op when nothing is loaded).
    fn seek(&mut self, secs: f64) -> Result<(), AudioError>;
    /// Position of the source opened by the most recent successful
    /// `load_and_play` / `load_paused` / `seek`. Callers read this the
    /// instant those calls return, so the value must already reflect the
    /// fresh source — never the previous (now frozen) one.
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
        /// Pause inside the audio thread so a restored session can never
        /// leak a brief burst of sound between "open" and "pause".
        start_paused: bool,
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
    SetEq {
        eq: EqSettings,
    },
    Seek {
        secs: f64,
        /// `None` in the payload = "nothing was loaded, seek was a no-op"
        /// (the proxy then keeps the previous tracker).
        reply: Reply<Result<Option<Arc<PosTracker>>, AudioError>>,
    },
    Query {
        reply: Reply<EngineSnapshot>,
    },
}

/// Point-in-time state of the audio thread, used to answer trait queries.
///
/// Deliberately carries **no** position: the tracker swap happens inside
/// the thread, but callers observe `position_secs()` the moment a
/// synchronous open/seek returns — that read goes through the proxy-owned
/// [`CurrentTracker`] instead, so it can never lag a command reply.
#[derive(Debug, Clone, Default)]
struct EngineSnapshot {
    paused: bool,
    active: bool,
    volume: f32,
    sample_rate: u32,
    current_path: Option<PathBuf>,
}

/// Tracker of the most recently opened source, owned by the engine proxy.
///
/// `PlayerService::load_track` persists and reports the position right
/// after `load_and_play` returns; when the tracker swap lived only inside
/// the audio thread (published after the reply), that read could still see
/// the *previous* track's frozen tracker — surfacing as "next/previous
/// didn't restart from the beginning". Feeding the proxy from the command
/// reply makes the observation order deterministic.
#[derive(Default)]
struct CurrentTracker(Mutex<Option<Arc<PosTracker>>>);

impl CurrentTracker {
    fn set(&self, tracker: Arc<PosTracker>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(tracker);
    }

    fn clear(&self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn position_secs(&self) -> f64 {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|t| t.position_secs())
            .unwrap_or(0.0)
    }
}

/// State owned by the audio thread. Never shared directly.
struct DeviceState {
    _stream: OutputStream,
    handle: OutputStreamHandle,
    sink: Option<Sink>,
    volume: f32,
    paused: bool,
    path: Option<PathBuf>,
    /// Sample rate of the currently loaded source (0 = nothing loaded);
    /// drives spectrum bin→frequency mapping.
    sample_rate: u32,
    /// Live equalizer state, read by every appended `EqualizerSource`;
    /// outlives individual sinks so track changes keep the curve.
    eq: Arc<SharedEq>,
    /// Spectrum capture written by every appended source (post-EQ signal).
    spectrum_tap: Arc<SpectrumTap>,
}

impl DeviceState {
    fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            paused: self.paused,
            active: self.sink.as_ref().map(|s| !s.empty()).unwrap_or(false),
            volume: self.volume,
            sample_rate: self.sample_rate,
            current_path: self.path.clone(),
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
        self.sample_rate = source.sample_rate();
        let sink = Sink::try_new(&self.handle).map_err(|_| AudioError::NoDevice)?;
        sink.set_volume(self.volume);
        sink.append(EqualizerSource::with_tap(
            source,
            self.eq.clone(),
            self.spectrum_tap.clone(),
        ));
        // Replacing the previous sink drops (and therefore stops) it.
        self.sink = Some(sink);
        self.path = Some(path.to_path_buf());
        self.paused = false;
        Ok(tracker)
    }
}

/// `Send` proxy to the audio-owning thread.
pub struct RodioEngine {
    tx: Sender<Command>,
    /// Tracker of the source opened by the last successful open/seek;
    /// see [`CurrentTracker`] for why the proxy (not the audio thread)
    /// owns this swap.
    current: CurrentTracker,
    /// Drains the audio thread's tap into display frames; cheap enough to
    /// lock per poller tick (~20 Hz).
    analyzer: Mutex<SpectrumAnalyzer>,
}

impl RodioEngine {
    /// Connects to the default output device on a dedicated thread.
    ///
    /// The stream must be created *inside* the thread because it is not
    /// `Send`; a handshake channel reports whether the device opened.
    pub fn new() -> Result<Self, AudioError> {
        let (tx, rx) = mpsc::channel::<Command>();
        let (init_tx, init_rx) = mpsc::channel::<Result<(), AudioError>>();
        let eq = Arc::new(SharedEq::new(EqSettings::default()));
        let thread_eq = eq.clone();
        let tap = Arc::new(SpectrumTap::new(FFT_SIZE * 2));
        let thread_tap = tap.clone();
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
                    sample_rate: 0,
                    eq: thread_eq,
                    spectrum_tap: thread_tap,
                };
                let _ = init_tx.send(Ok(()));
                audio_loop(state, rx);
            })
            .map_err(|_| AudioError::NoDevice)?;
        init_rx.recv().map_err(|_| AudioError::NoDevice)??;
        Ok(Self {
            tx,
            current: CurrentTracker::default(),
            analyzer: Mutex::new(SpectrumAnalyzer::new(tap)),
        })
    }

    fn call<T>(&self, build: impl FnOnce(Reply<T>) -> Command) -> Option<T> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx.send(build(reply_tx)).ok()?;
        reply_rx.recv().ok()
    }

    fn query(&self) -> EngineSnapshot {
        self.call(|reply| Command::Query { reply }).unwrap_or_default()
    }

    /// Shared implementation of `load_and_play` / `load_paused`.
    ///
    /// On success the fresh tracker is adopted *before* returning, so the
    /// caller's immediate `position_secs()` read already sees 0.0 (or the
    /// seek target) instead of the previous track's frozen position. On
    /// error the audio thread kept the old sink playing, so the old
    /// tracker stays — matching what is actually audible.
    fn open(&self, path: &Path, at_secs: Option<f64>, start_paused: bool) -> Result<(), AudioError> {
        match self.call(|reply| Command::Open {
            path: path.to_path_buf(),
            at_secs,
            start_paused,
            reply,
        }) {
            Some(Ok(tracker)) => {
                self.current.set(tracker);
                Ok(())
            }
            Some(Err(err)) => Err(err),
            None => Err(AudioError::NoDevice), // audio thread is gone
        }
    }
}

/// Command loop running on the audio thread. Every reply already carries
/// the resulting state (tracker / snapshot), so the loop keeps no shared
/// side channel — nothing here can be observed stale by a caller.
fn audio_loop(mut state: DeviceState, rx: mpsc::Receiver<Command>) {
    while let Ok(command) = rx.recv() {
        match command {
            Command::Open { path, at_secs, start_paused, reply } => {
                let result = state.open_at(&path, at_secs).map(|tracker| {
                    if start_paused {
                        if let Some(sink) = &state.sink {
                            sink.pause();
                        }
                        state.paused = true;
                    }
                    tracker
                });
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
            Command::SetEq { eq } => {
                // Publishes to the shared state every appended source reads;
                // takes effect within a few samples, no sink recreation.
                state.eq.set(eq);
            }
            Command::Seek { secs, reply } => {
                let result = match state.path.clone() {
                    // Reopening is the seek: a new source positioned at
                    // `secs`, wrapped in a fresh sink (EQ/spectrum intact).
                    Some(path) => state.open_at(&path, Some(secs)).map(Some),
                    None => Ok(None), // nothing loaded: seek is a no-op
                };
                let _ = reply.send(result);
            }
            Command::Query { reply } => {
                let _ = reply.send(state.snapshot());
            }
        }
    }
}

impl AudioEngine for RodioEngine {
    fn load_and_play(&mut self, path: &Path) -> Result<(), AudioError> {
        self.open(path, None, false)
    }

    fn load_paused(&mut self, path: &Path, at_secs: f64) -> Result<(), AudioError> {
        self.open(path, Some(at_secs.max(0.0)), true)
    }

    fn pause(&mut self) {
        let _ = self.tx.send(Command::Pause);
    }

    fn resume(&mut self) {
        let _ = self.tx.send(Command::Resume);
    }

    fn stop(&mut self) {
        let _ = self.call(|reply| Command::Stop { reply });
        self.current.clear();
    }

    fn set_volume(&mut self, volume: f32) {
        let _ = self.tx.send(Command::SetVolume { volume });
    }

    fn set_eq(&mut self, eq: &EqSettings) {
        let _ = self.tx.send(Command::SetEq { eq: eq.clone() });
    }

    fn spectrum(&mut self) -> Option<Vec<f32>> {
        let snapshot = self.query();
        if snapshot.sample_rate == 0 {
            return None; // nothing loaded yet
        }
        let mut analyzer = self.analyzer.lock().unwrap_or_else(|e| e.into_inner());
        analyzer.frame(snapshot.sample_rate)
    }

    fn seek(&mut self, secs: f64) -> Result<(), AudioError> {
        match self.call(|reply| Command::Seek { secs, reply }) {
            // Adopt the re-opened source's tracker before returning, so an
            // immediately following read reports the seek target.
            Some(Ok(Some(tracker))) => {
                self.current.set(tracker);
                Ok(())
            }
            Some(Ok(None)) => Ok(()), // nothing was loaded: no-op
            Some(Err(err)) => Err(err),
            None => Err(AudioError::NoDevice),
        }
    }

    fn position_secs(&self) -> f64 {
        self.current.position_secs()
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

/// Silent engine used when no output device exists: accepts every command,
/// never reports end-of-track, so the UI stays usable for library management.
pub struct NullEngine {
    volume: f32,
    path: Option<PathBuf>,
    loaded: bool,
    paused: bool,
}

impl Default for NullEngine {
    fn default() -> Self {
        Self {
            volume: 0.8,
            path: None,
            loaded: false,
            paused: false,
        }
    }
}

impl AudioEngine for NullEngine {
    fn load_and_play(&mut self, path: &Path) -> Result<(), AudioError> {
        self.path = Some(path.to_path_buf());
        self.loaded = true;
        self.paused = false;
        Ok(())
    }

    fn load_paused(&mut self, path: &Path, _at_secs: f64) -> Result<(), AudioError> {
        self.path = Some(path.to_path_buf());
        self.loaded = true;
        self.paused = true;
        Ok(())
    }

    fn pause(&mut self) {
        self.paused = true;
    }

    fn resume(&mut self) {
        self.paused = false;
    }

    fn stop(&mut self) {
        self.loaded = false;
        self.path = None;
        self.paused = false;
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
    }

    /// No output device: accepts the command, nothing to filter.
    fn set_eq(&mut self, _eq: &EqSettings) {}

    fn seek(&mut self, _secs: f64) -> Result<(), AudioError> {
        Ok(())
    }

    fn position_secs(&self) -> f64 {
        0.0
    }

    fn volume(&self) -> f32 {
        self.volume
    }

    fn is_paused(&self) -> bool {
        self.paused
    }

    /// Always active once loaded so the poller never "auto-advances" through
    /// the queue of a device-less session.
    fn is_active(&self) -> bool {
        self.loaded
    }

    fn current_path(&self) -> Option<PathBuf> {
        self.path.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::audio::symphonia_source::source_from_bytes;
    use std::io::Cursor;

    /// Minimal stereo 16-bit WAV of `seconds` length, in memory.
    fn wav_bytes(seconds: f64) -> Vec<u8> {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
            let frames = (seconds * spec.sample_rate as f64) as u32;
            for i in 0..frames {
                let value = ((i as f32 / 20.0).sin() * 8000.0) as i16;
                writer.write_sample(value).unwrap();
                writer.write_sample(value).unwrap();
            }
            writer.finalize().unwrap();
        }
        cursor.into_inner()
    }

    /// Regression pin for "next/previous didn't restart from the beginning":
    /// the position read must come from the tracker of the most recent
    /// open/seek the moment that call returns — never from the previous
    /// track's (by then frozen) tracker. `RodioEngine` needs a real output
    /// device, so the pin targets the proxy-owned swap it delegates to.
    #[test]
    fn position_follows_the_newest_source_not_the_previous_one() {
        let current = CurrentTracker::default();

        // A source that already "played" for a while.
        let mut played = source_from_bytes(wav_bytes(1.0), "old.wav").unwrap();
        played.seek_by_time(0.5).unwrap();
        current.set(played.position_tracker());
        assert!(
            current.position_secs() > 0.4,
            "precondition: old tracker is mid-track"
        );

        // Switching tracks adopts the fresh source at 0.0 instantly.
        let fresh = source_from_bytes(wav_bytes(1.0), "new.wav").unwrap();
        current.set(fresh.position_tracker());
        assert_eq!(current.position_secs(), 0.0);

        // Stopping releases the tracker; no source, no position.
        current.clear();
        assert_eq!(current.position_secs(), 0.0);
    }

    #[test]
    fn audio_error_converts_from_source_error() {
        let err = AudioError::from(SourceError::NoTrack("x.mp3".into()));
        assert!(err.to_string().contains("x.mp3"));
    }

    #[test]
    fn null_engine_never_reports_end() {
        let mut engine = NullEngine::default();
        engine.set_volume(0.5);
        engine.load_and_play(Path::new("C:/any.flac")).unwrap();
        assert!(engine.is_active());
        engine.pause();
        assert!(engine.is_paused());
        assert!(engine.is_active());
        assert_eq!(engine.volume(), 0.5);
        engine.stop();
        assert!(!engine.is_active());
    }

    #[test]
    fn null_engine_load_paused_stays_paused() {
        let mut engine = NullEngine::default();
        engine.load_paused(Path::new("C:/any.flac"), 30.0).unwrap();
        // Loaded but paused: the poller must not treat it as playing.
        assert!(engine.is_active());
        assert!(engine.is_paused());
        engine.resume();
        assert!(!engine.is_paused());
    }

    #[test]
    fn engines_without_capture_report_no_spectrum() {
        // The trait default: mock/null engines never fabricate frames.
        let mut engine = NullEngine::default();
        engine.load_and_play(Path::new("C:/any.flac")).unwrap();
        assert_eq!(engine.spectrum(), None);
    }
}
