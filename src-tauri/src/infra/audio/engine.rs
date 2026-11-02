//! Playback engine: rodio sink management around `SymphoniaSource`.
//!
//! rodio's `OutputStream` is not `Send` on all platforms (it wraps a raw
//! device pointer), so the engine cannot live behind a mutex. Instead a
//! dedicated "audio thread" owns the stream/sink and executes commands sent
//! through a channel; `RodioEngine` is just a `Send` proxy to that thread.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::{OutputStream, OutputStreamHandle, Sink};

use super::ape_source::{ApeDecoderStream, ApeSource};
use super::equalizer::{EqualizerSource, SharedEq};
use super::fade::{FadeSource, SharedFade, FADE_OUT_SECS};
use super::spectrum::{SpectrumAnalyzer, SpectrumTap};
use super::symphonia_source::{PosTracker, SourceError, SymphoniaSource};
use crate::domain::equalizer::EqSettings;
use crate::domain::spectrum::FFT_SIZE;
use symphonia::core::io::MediaSourceStream;

/// How a freshly opened source ramps up. Derived *in the engine* from
/// what the audio thread already knows: whether the outgoing sink was
/// sounding when the open arrived — no service/API surface needed.
enum FadeIn {
    /// The listener just heard audio (fading manual switch): a soft ramp
    /// turns the seam into a gentle dip instead of "smooth down, then
    /// BAM".
    Soft,
    /// The previous instant was already silence (first play, auto
    /// advance, repeat-one, switch from a paused sink): a full ramp here
    /// would only soften the music's own attack on every album boundary.
    /// The short guard just protects against tracks that begin at full
    /// amplitude.
    Guard,
    /// No ramp (seek reopen): keeps the current gain so jumping inside a
    /// track never dips the audio.
    None,
}

impl Copy for FadeIn {}

impl Clone for FadeIn {
    fn clone(&self) -> Self {
        *self
    }
}

/// True for files the APE adapter owns (symphonia has no APE codec).
/// Case-insensitive, mirroring `domain::scan::is_audio_file`.
fn is_ape_path(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("ape"))
        .unwrap_or(false)
}

/// One decoded stream, whatever the format. An enum (not a trait object)
/// keeps the sources concrete — the EQ/fade wrappers stay monomorphized
/// and `Send` is checked per variant.
enum DecodedSource {
    Symphonia(SymphoniaSource),
    Ape(ApeSource<ApeDecoderStream>),
}

impl DecodedSource {
    /// Opens `path` with the decoder its extension maps to.
    fn open(path: &Path) -> Result<Self, AudioError> {
        if is_ape_path(path) {
            Ok(DecodedSource::Ape(ApeSource::new(ApeDecoderStream::open(path)?)))
        } else {
            let file =
                File::open(path).map_err(|_| AudioError::OpenFile(path.display().to_string()))?;
            let mss = MediaSourceStream::new(Box::new(file), Default::default());
            let source = SymphoniaSource::new(mss, path.display().to_string())
                .map_err(AudioError::from)?;
            Ok(DecodedSource::Symphonia(source))
        }
    }

    fn seek_by_time(&mut self, secs: f64) -> Result<(), AudioError> {
        match self {
            DecodedSource::Symphonia(source) => source.seek_by_time(secs).map_err(AudioError::from),
            DecodedSource::Ape(source) => source.seek_by_time(secs),
        }
    }

    fn position_tracker(&self) -> Arc<PosTracker> {
        match self {
            DecodedSource::Symphonia(source) => source.position_tracker(),
            DecodedSource::Ape(source) => source.position_tracker(),
        }
    }

    fn sample_rate(&self) -> u32 {
        match self {
            DecodedSource::Symphonia(source) => source.sample_rate(),
            DecodedSource::Ape(source) => source.sample_rate(),
        }
    }
}

impl Iterator for DecodedSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        match self {
            DecodedSource::Symphonia(source) => source.next(),
            DecodedSource::Ape(source) => source.next(),
        }
    }
}

impl rodio::Source for DecodedSource {
    fn current_frame_len(&self) -> Option<usize> {
        match self {
            DecodedSource::Symphonia(source) => source.current_frame_len(),
            DecodedSource::Ape(source) => source.current_frame_len(),
        }
    }

    fn channels(&self) -> u16 {
        match self {
            // Trait call: SymphoniaSource's inherent channels() returns u32.
            DecodedSource::Symphonia(source) => rodio::Source::channels(source),
            DecodedSource::Ape(source) => rodio::Source::channels(source),
        }
    }

    fn sample_rate(&self) -> u32 {
        match self {
            DecodedSource::Symphonia(source) => source.sample_rate(),
            DecodedSource::Ape(source) => source.sample_rate(),
        }
    }

    fn total_duration(&self) -> Option<Duration> {
        match self {
            DecodedSource::Symphonia(source) => source.total_duration(),
            DecodedSource::Ape(source) => source.total_duration(),
        }
    }
}

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
    /// When another track is actively sounding, the rodio engine first
    /// fades it out and swaps only once the ramp has drained (~0.2 s;
    /// the caller blocks through it — dropping the old sink at full gain
    /// would pop).
    fn load_and_play(&mut self, path: &Path) -> Result<(), AudioError>;
    /// Opens `path` positioned at `at_secs` **without starting playback**
    /// (session restore). Pressing play afterwards continues from `at_secs`.
    fn load_paused(&mut self, path: &Path, at_secs: f64) -> Result<(), AudioError>;
    /// Pauses playback. The rodio engine ramps the gain down first (see
    /// `fade`); mock/null engines pause instantly.
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
    /// Fading pause: ramps the gain down, then (deferred, unless canceled
    /// by a newer command) issues the real [`Command::PauseNow`].
    Pause,
    /// The actual sink pause, sent by the deferred-pause timer once the
    /// fade-out has drained. Never user-issued.
    PauseNow,
    /// The deferred half of a fading track switch: sent by the timer once
    /// the old track's fade-out has drained, carrying the generation of
    /// the [`Command::Open`] it serves. Never user-issued.
    OpenNow {
        generation: u64,
    },
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
    /// Gain ramp read by every appended `FadeSource`; like the EQ it
    /// outlives sinks so the ramp survives seeks (which reopen sources).
    fade: Arc<SharedFade>,
    /// Cancellation token for deferred follow-ups (`PauseNow`,
    /// `OpenNow`): bumped by every command that invalidates an in-flight
    /// fade-out, so the timer threads can drop stale commands.
    command_generation: Arc<AtomicU64>,
}

/// A track switch parked until the outgoing track's fade-out has drained.
struct PendingOpen {
    path: PathBuf,
    at_secs: Option<f64>,
    start_paused: bool,
    reply: Reply<Result<Arc<PosTracker>, AudioError>>,
}

/// Extra slack added to a fade before its deferred follow-up fires. The
/// fade is complete once the audio callback has *pulled* it — with a
/// large callback chunk (tens of ms on some device configs) a 120 ms ramp
/// finishes pulling up to one chunk late, and pausing/swapping mid-ramp
/// truncates the tail into an audible step.
const DEFER_MARGIN: Duration = Duration::from_millis(100);

/// Arms the deferred follow-up of a fade-out: sleeps past the fade (plus
/// [`DEFER_MARGIN`]), then sends `make()` unless the generation moved on.
fn arm_deferred(
    tx: &Sender<Command>,
    token: Arc<AtomicU64>,
    generation: u64,
    make: impl FnOnce() -> Command + Send + 'static,
) {
    let tx = tx.clone();
    std::thread::spawn(move || {
        // Deferred follow-ups trail a *fade-out* — see DEFER_MARGIN for
        // why the pull-domain drain needs the slack.
        std::thread::sleep(Duration::from_secs_f64(FADE_OUT_SECS) + DEFER_MARGIN);
        if token.load(Ordering::SeqCst) == generation {
            let _ = tx.send(make());
        }
    });
}

/// Opens `path` as the new sink, honoring `start_paused`.
fn open_source(
    state: &mut DeviceState,
    path: &Path,
    at_secs: Option<f64>,
    start_paused: bool,
    fade_in: FadeIn,
) -> Result<Arc<PosTracker>, AudioError> {
    state.open_at(path, at_secs, fade_in).map(|tracker| {
        if start_paused {
            if let Some(sink) = &state.sink {
                sink.pause();
            }
            state.paused = true;
        }
        tracker
    })
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
    ///
    /// `fade_in` selects the up-ramp by context (see [`FadeIn`]); it is
    /// published *before* the sink is appended so the device can never
    /// pull an unramped first sample.
    fn open_at(
        &mut self,
        path: &Path,
        at_secs: Option<f64>,
        fade_in: FadeIn,
    ) -> Result<Arc<PosTracker>, AudioError> {
        let mut source = DecodedSource::open(path)?;
        if let Some(secs) = at_secs {
            source.seek_by_time(secs)?;
        }
        let tracker = source.position_tracker();
        self.sample_rate = source.sample_rate();
        self.fade.configure(self.sample_rate);
        match fade_in {
            FadeIn::Soft => self.fade.start_soft(),
            FadeIn::Guard => self.fade.start_guard(),
            FadeIn::None => {}
        }
        let sink = Sink::try_new(&self.handle).map_err(|_| AudioError::NoDevice)?;
        sink.set_volume(self.volume);
        sink.append(FadeSource::new(
            EqualizerSource::with_tap(source, self.eq.clone(), self.spectrum_tap.clone()),
            self.fade.clone(),
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
        let fade = Arc::new(SharedFade::new());
        let thread_fade = fade.clone();
        let command_generation = Arc::new(AtomicU64::new(0));
        let thread_generation = command_generation.clone();
        let thread_tx = tx.clone();
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
                    fade: thread_fade,
                    command_generation: thread_generation,
                };
                let _ = init_tx.send(Ok(()));
                audio_loop(state, thread_tx, rx);
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
        self.call(|reply| Command::Query { reply })
            .unwrap_or_default()
    }

    /// Shared implementation of `load_and_play` / `load_paused`.
    ///
    /// May block for one fade window when a sounding sink is replaced
    /// (the audio thread parks the open until the old track's fade-out
    /// has drained, then replies — see `Command::Open`).
    ///
    /// On success the fresh tracker is adopted *before* returning, so the
    /// caller's immediate `position_secs()` read already sees 0.0 (or the
    /// seek target) instead of the previous track's frozen position. On
    /// error the audio thread kept the old sink playing, so the old
    /// tracker stays — matching what is actually audible.
    fn open(
        &self,
        path: &Path,
        at_secs: Option<f64>,
        start_paused: bool,
    ) -> Result<(), AudioError> {
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
///
/// Concurrency note: every engine command originates from the
/// `PlayerService` mutex, so while a *deferred* switch parks a caller
/// (waiting for its reply) no other command can interleave — only timer
/// follow-ups (`PauseNow`/`OpenNow`) can, and the generation token makes
/// stale ones inert. The supersession replies below are defensive paths
/// for any future caller that does not hold the service lock.
fn audio_loop(mut state: DeviceState, tx: Sender<Command>, rx: mpsc::Receiver<Command>) {
    // Parked switch (fading out the old track) and its fallback reply.
    let mut pending_open: Option<PendingOpen> = None;
    let mut last_tracker: Option<Arc<PosTracker>> = None;

    while let Ok(command) = rx.recv() {
        match command {
            Command::Open {
                path,
                at_secs,
                start_paused,
                reply,
            } => {
                // A new source invalidates any in-flight deferred pause: a
                // stale PauseNow must never mute the freshly opened track.
                state.command_generation.fetch_add(1, Ordering::SeqCst);

                // Fading switch: dropping the old sink mid-waveform at full
                // gain is a step discontinuity — the pop on next/previous.
                // When the old sink is actively sounding, ramp it down and
                // swap once the ramp has drained. Idle switches (nothing
                // loaded, old sink paused or already drained to silence)
                // have nothing audible to cut and swap immediately.
                let old_sounding = !start_paused
                    && state
                        .sink
                        .as_ref()
                        .map(|sink| !sink.empty() && !state.paused)
                        .unwrap_or(false);
                if old_sounding {
                    state.fade.fade_out();
                    let generation = state.command_generation.load(Ordering::SeqCst);
                    arm_deferred(
                        &tx,
                        state.command_generation.clone(),
                        generation,
                        move || Command::OpenNow { generation },
                    );
                    pending_open = Some(PendingOpen {
                        path,
                        at_secs,
                        start_paused,
                        reply,
                    });
                } else {
                    // Nothing audible precedes this open (idle, paused or
                    // drained old sink): only a guard ramp, so album
                    // boundaries and repeat-one keeps their attack.
                    let result = open_source(&mut state, &path, at_secs, start_paused, FadeIn::Guard);
                    if let Ok(tracker) = &result {
                        last_tracker = Some(tracker.clone());
                    }
                    let _ = reply.send(result);
                }
            }
            Command::OpenNow { generation } => {
                if generation == state.command_generation.load(Ordering::SeqCst) {
                    if let Some(pending) = pending_open.take() {
                        // The outgoing track faded to zero before this
                        // swap: the soft ramp shapes the join perceptually
                        // (the pop itself is already gone with the fade).
                        let result = open_source(
                            &mut state,
                            &pending.path,
                            pending.at_secs,
                            pending.start_paused,
                            FadeIn::Soft,
                        );
                        if let Ok(tracker) = &result {
                            last_tracker = Some(tracker.clone());
                        }
                        let _ = pending.reply.send(result);
                    }
                } else if let Some(pending) = pending_open.take() {
                    // Superseded (unreachable under the service lock; see
                    // the loop's concurrency note). Release the caller with
                    // the current tracker so it can never hang.
                    let fallback = last_tracker.clone().ok_or(AudioError::NoDevice);
                    let _ = pending.reply.send(fallback);
                }
            }
            Command::Pause => {
                if state.sink.is_some() {
                    // Instant pausing while samples are at full gain clicks;
                    // ramp down first and pause once the ramp has drained.
                    state.fade.fade_out();
                    let generation = state.command_generation.fetch_add(1, Ordering::SeqCst) + 1;
                    arm_deferred(
                        &tx,
                        state.command_generation.clone(),
                        generation,
                        || Command::PauseNow,
                    );
                }
            }
            Command::PauseNow => {
                if let Some(sink) = &state.sink {
                    sink.pause();
                    state.paused = true;
                }
            }
            Command::Resume => {
                // Cancels a pending deferred pause (the generation bump
                // makes the timer thread drop its PauseNow) and ramps the
                // gain back up from wherever the fade-out stopped.
                state.command_generation.fetch_add(1, Ordering::SeqCst);
                if let Some(sink) = &state.sink {
                    state.fade.fade_in();
                    sink.play();
                    state.paused = false;
                }
            }
            Command::Stop { reply } => {
                state.command_generation.fetch_add(1, Ordering::SeqCst);
                if let Some(pending) = pending_open.take() {
                    // Defensive supersession release (see loop docs).
                    let _ = pending.reply.send(Err(AudioError::NoDevice));
                }
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
                state.command_generation.fetch_add(1, Ordering::SeqCst);
                if let Some(pending) = pending_open.take() {
                    // Defensive supersession release (see loop docs).
                    let _ = pending.reply.send(Err(AudioError::NoDevice));
                }
                let result = match state.path.clone() {
                    // Reopening is the seek: a new source positioned at
                    // `secs`, wrapped in a fresh sink (EQ/spectrum intact).
                    // Gain continuity is kept (no ramp) so seeking never
                    // dips the audio.
                    Some(path) => state.open_at(&path, Some(secs), FadeIn::None).map(Some),
                    None => Ok(None), // nothing loaded: seek is a no-op
                };
                if let Ok(Some(tracker)) = &result {
                    last_tracker = Some(tracker.clone());
                }
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

    /// Only the APE adapter owns `.ape` — everything else goes through the
    /// symphonia probe (symphonia has no APE codec). Case-insensitive like
    /// `domain::scan::is_audio_file`, so `Album.APE` from macOS rips scans
    /// and plays identically.
    #[test]
    fn ape_dispatch_matches_extension_case_insensitively() {
        for name in ["a.ape", "b.APE", "c.Ape"] {
            assert!(is_ape_path(Path::new(name)), "{name} must dispatch to the APE adapter");
        }
        for name in ["a.mp3", "b.m4a", "ape", "a.apefile", "noext"] {
            assert!(!is_ape_path(Path::new(name)), "{name} must stay on the symphonia path");
        }
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
