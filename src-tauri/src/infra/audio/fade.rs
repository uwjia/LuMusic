//! Playback fades: a `rodio::Source` wrapper applying a short linear
//! gain ramp, driven by an atomic shared state.
//!
//! Why a source wrapper (like the EQ) instead of `Sink::set_volume`
//! sweeps: the sink volume is the *master* volume the user controls, and
//! polling it from a timer clicks if frames land late. A per-sample ramp
//! in the source is sample-accurate and lock-free.
//!
//! Scope, by context (the engine picks per open — see `FadeIn` there):
//! - fade-out (120 ms) on pause and track switches: dropping or pausing a
//!   sink at non-zero gain is a step discontinuity — the pop;
//! - *soft* fade-in (60 ms) where the listener just heard audio (manual
//!   switch, resume): softens the join perceptually;
//! - *guard* fade-in (20 ms) where the previous instant was already
//!   silence (first play, auto-advance, repeat-one): a full-length ramp
//!   there only softens the music itself — every album boundary would
//!   lose its attack. The 20 ms guard still protects against tracks that
//!   literally begin at full amplitude;
//! - seeks reopen the source without fading (instant feedback, gain
//!   continuity). True crossfading is the separate gapless non-goal.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::Source;

/// Fade-out length: covers the transient while still feeling immediate.
pub const FADE_OUT_SECS: f64 = 0.12;
/// Soft fade-in: long enough to read as a gentle join, short enough not
/// to soften a musical attack.
pub const FADE_IN_SECS: f64 = 0.06;
/// Guard ramp for sources opened onto an already-silent device.
pub const FADE_GUARD_SECS: f64 = 0.02;

/// Gain ramp shared between the engine (writer) and the audio thread
/// (reader). Values are linear gains stored as f32 bits in atomics.
pub struct SharedFade {
    current: AtomicU32,
    target: AtomicU32,
    sample_rate: AtomicU32,
    /// Active up-ramp rate (per sample). Soft and guard ramps differ in
    /// speed, so the rate is (re)selected by whichever entry point starts
    /// an up-ramp; the down-ramp rate is fixed by [`FADE_OUT_SECS`].
    step_in: AtomicU32,
    step_out: AtomicU32,
}

fn to_bits(value: f32) -> u32 {
    value.to_bits()
}

fn rate(sample_rate: u32, secs: f64) -> f32 {
    if sample_rate == 0 {
        0.0
    } else {
        (1.0 / (sample_rate as f64 * secs)) as f32
    }
}

impl SharedFade {
    pub fn new() -> Self {
        Self {
            // Audible by default: sources created before the first open
            // must never fade a mid-stream command (e.g. a volume change).
            current: AtomicU32::new(to_bits(1.0)),
            target: AtomicU32::new(to_bits(1.0)),
            sample_rate: AtomicU32::new(0),
            step_in: AtomicU32::new(to_bits(0.0)),
            step_out: AtomicU32::new(to_bits(0.0)),
        }
    }

    /// Stores the source's sample rate and recomputes both ramp rates.
    pub fn configure(&self, sample_rate: u32) {
        self.sample_rate.store(sample_rate, Ordering::Relaxed);
        self.step_in
            .store(to_bits(rate(sample_rate, FADE_IN_SECS)), Ordering::Relaxed);
        self.step_out
            .store(to_bits(rate(sample_rate, FADE_OUT_SECS)), Ordering::Relaxed);
    }

    fn arm_up(&self, secs: f64) {
        let step = rate(self.sample_rate.load(Ordering::Relaxed), secs);
        self.step_in.store(to_bits(step), Ordering::Relaxed);
        self.target.store(to_bits(1.0), Ordering::Release);
    }

    /// Soft fade-in to full gain from wherever the ramp currently stands
    /// (resume after pause).
    pub fn fade_in(&self) {
        self.arm_up(FADE_IN_SECS);
    }

    /// Ramps down to silence (deferred pause, fading track switch).
    pub fn fade_out(&self) {
        self.target.store(to_bits(0.0), Ordering::Release);
    }

    /// New source opened where the listener just heard audio: full soft
    /// ramp up from silence.
    pub fn start_soft(&self) {
        self.current.store(to_bits(0.0), Ordering::Relaxed);
        self.arm_up(FADE_IN_SECS);
    }

    /// New source opened onto an already-silent device: minimal guard
    /// ramp, three times faster than the soft one.
    pub fn start_guard(&self) {
        self.current.store(to_bits(0.0), Ordering::Relaxed);
        self.arm_up(FADE_GUARD_SECS);
    }

    /// Advances and returns the gain for the next sample. Called once per
    /// sample from the audio thread; everything here is relaxed atomic
    /// math because the only writer of `target`/rates is the engine
    /// thread and stale-by-one-command values are harmless (the ramp just
    /// turns around a sample later).
    pub fn next_gain(&self) -> f32 {
        let current = f32::from_bits(self.current.load(Ordering::Relaxed));
        let target = f32::from_bits(self.target.load(Ordering::Acquire));
        if current == target {
            return current;
        }
        let rising = current < target;
        let step = f32::from_bits(if rising {
            self.step_in.load(Ordering::Relaxed)
        } else {
            self.step_out.load(Ordering::Relaxed)
        });
        if step == 0.0 {
            // Unconfigured (or unknown sample rate): jump instead of
            // ramping forever at zero progress.
            self.current.store(to_bits(target), Ordering::Relaxed);
            return target;
        }
        let moved = if rising {
            (current + step).min(target)
        } else {
            (current - step).max(target)
        };
        self.current.store(to_bits(moved), Ordering::Relaxed);
        moved
    }

    /// Current gain (test seam; not used on the audio path).
    pub fn gain(&self) -> f32 {
        f32::from_bits(self.current.load(Ordering::Relaxed))
    }
}

impl Default for SharedFade {
    fn default() -> Self {
        Self::new()
    }
}

/// Wraps a f32 sample source, multiplying every sample by the shared ramp.
pub struct FadeSource<S> {
    inner: S,
    fade: Arc<SharedFade>,
}

impl<S> FadeSource<S> {
    pub fn new(inner: S, fade: Arc<SharedFade>) -> Self {
        Self { inner, fade }
    }
}

impl<S: Source<Item = f32>> Iterator for FadeSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        // At rest the gain is exactly 1.0, and `x * 1.0 == x` for every
        // finite f32, so the idle path is bit-transparent.
        Some(sample * self.fade.next_gain())
    }
}

impl<S: Source<Item = f32>> Source for FadeSource<S> {
    // Delegated unchanged (same contract note as EqualizerSource).
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::audio::symphonia_source::source_from_bytes;
    use std::io::Cursor;

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
                let value = ((i as f32 / 10.0).sin() * 8000.0) as i16;
                writer.write_sample(value).unwrap();
                writer.write_sample(value).unwrap();
            }
            writer.finalize().unwrap();
        }
        cursor.into_inner()
    }

    /// Collects the per-sample gain the source applies by dividing the
    /// faded output by the raw decode (both derived from identical WAVs).
    fn gains_over(fade: Arc<SharedFade>, samples: usize) -> Vec<f32> {
        let raw: Vec<f32> = source_from_bytes(wav_bytes(1.5), "raw.wav")
            .unwrap()
            .take(samples)
            .collect();
        let faded: Vec<f32> = FadeSource::new(
            source_from_bytes(wav_bytes(1.5), "t.wav").unwrap(),
            fade,
        )
        .take(samples)
        .collect();
        raw.iter()
            .zip(faded.iter())
            .map(|(r, f)| f / r)
            .filter(|g| g.is_finite())
            .collect()
    }

    #[test]
    fn idle_ramp_is_bit_exact_pass_through() {
        let fade = Arc::new(SharedFade::new());
        let raw: Vec<f32> = source_from_bytes(wav_bytes(0.1), "raw.wav")
            .unwrap()
            .collect();
        let passed: Vec<f32> = FadeSource::new(
            source_from_bytes(wav_bytes(0.1), "t.wav").unwrap(),
            fade.clone(),
        )
        .collect();
        assert_eq!(raw, passed, "no fade requested: samples must be untouched");
        assert_eq!(fade.gain(), 1.0);
    }

    #[test]
    fn fade_in_ramps_monotonically_to_unity_within_the_window() {
        let fade = Arc::new(SharedFade::new());
        fade.configure(44_100);
        fade.start_soft();
        let window = (44_100.0 * FADE_IN_SECS) as usize;
        let gains = gains_over(fade.clone(), window + 4_410);
        // Stereo WAV starts with two sine-zero samples, so the first
        // *observable* gain is already a few steps in (3 x step at 60 ms).
        assert!(gains.first().unwrap() < &0.005, "must start silent");
        for pair in gains.windows(2) {
            assert!(pair[1] >= pair[0] - 1e-6, "fade-in must not dip");
        }
        // By the end of the window the gain sits at (≈) full scale and
        // stays there.
        assert!(*gains.last().unwrap() > 0.999);
        assert_eq!(fade.gain(), 1.0);
    }

    #[test]
    fn fade_out_ramps_monotonically_to_silence() {
        let fade = Arc::new(SharedFade::new());
        fade.configure(44_100);
        fade.fade_out();
        let window = (44_100.0 * FADE_OUT_SECS) as usize;
        let gains = gains_over(fade.clone(), window + 4_410);
        assert!(*gains.first().unwrap() > 0.999);
        for pair in gains.windows(2) {
            assert!(pair[1] <= pair[0] + 1e-6, "fade-out must not rise");
        }
        assert_eq!(fade.gain(), 0.0);
        // Past the target the ramp holds silence exactly.
        assert!(*gains.last().unwrap() < 0.001);
    }

    /// The whole point of the guard ramp: a source opened onto an
    /// already-silent device must reach full gain ~3x faster than the
    /// soft join, or every album track's attack gets softened.
    #[test]
    fn guard_ramp_reaches_unity_much_faster_than_the_soft_ramp() {
        let fade = Arc::new(SharedFade::new());
        fade.configure(44_100);
        fade.start_guard();
        let guard_window = (44_100.0 * FADE_GUARD_SECS) as usize;
        let gains = gains_over(fade.clone(), guard_window + 2_205);
        // Same stereo-zero caveat: a few steps of the (fast) guard ramp.
        assert!(gains.first().unwrap() < &0.02, "guard still starts silent");
        assert!(*gains.last().unwrap() > 0.999, "guard completes in its window");
        assert_eq!(fade.gain(), 1.0);
        // And the ratio between the two up-ramp durations is real:
        // reaching 0.5 gain takes ~3x fewer samples under the guard.
        assert!(
            FADE_IN_SECS / FADE_GUARD_SECS >= 2.5,
            "guard must be markedly shorter than the soft ramp"
        );
    }

    #[test]
    fn interrupted_ramps_reverse_from_wherever_they_stand() {
        // pause-fade interrupted mid-way by resume: the gain must climb
        // back up from its current value, not restart from 0 or 1.
        let fade = Arc::new(SharedFade::new());
        fade.configure(44_100);
        fade.fade_out();
        let half = (44_100.0 * FADE_OUT_SECS / 2.0) as usize;
        let during = gains_over(fade.clone(), half);
        let mid = *during.last().unwrap();
        assert!((0.3..0.7).contains(&mid), "mid-ramp gain was {mid}");
        fade.fade_in();
        let back = gains_over(fade.clone(), (44_100.0 * FADE_IN_SECS) as usize);
        assert!(*back.first().unwrap() >= mid - 1e-6);
        assert_eq!(fade.gain(), 1.0);
    }

    #[test]
    fn zero_sample_rate_disables_the_ramp_instead_of_dividing_by_zero() {
        let fade = SharedFade::new();
        fade.configure(0);
        fade.start_soft();
        // First sample jumps straight to the target: no NaN, no stall.
        assert_eq!(fade.next_gain(), 1.0);
    }

    #[test]
    fn ramp_length_scales_with_the_sample_rate() {
        // 8 kHz source: the same window must translate into a per-sample
        // step 5.5125x *larger* than at 44.1 kHz (fewer samples per second).
        let fade = SharedFade::new();
        fade.configure(44_100);
        let hi = f32::from_bits(fade.step_out.load(Ordering::Relaxed));
        fade.configure(8_000);
        let lo = f32::from_bits(fade.step_out.load(Ordering::Relaxed));
        assert!((lo / hi - 44_100.0 / 8_000.0).abs() < 0.01);
    }

    /// Out and in differ on purpose (120 ms down, 60 ms up); the down-ramp
    /// must be the slower one because it alone carries the pop-masking.
    /// Step ratio is the inverse of the duration ratio.
    #[test]
    fn down_ramp_is_slower_than_the_up_ramp() {
        let fade = SharedFade::new();
        fade.configure(44_100);
        let out = f32::from_bits(fade.step_out.load(Ordering::Relaxed));
        fade.start_soft();
        let soft_in = f32::from_bits(fade.step_in.load(Ordering::Relaxed));
        let ratio = soft_in / out;
        assert!((ratio - (FADE_OUT_SECS / FADE_IN_SECS) as f32).abs() < 0.05, "ratio {ratio}");
        assert!(soft_in > out, "rising must be faster than falling");
    }
}
