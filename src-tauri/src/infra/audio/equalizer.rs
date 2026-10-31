//! Real-time equalizer: a `rodio::Source` wrapper applying the biquad bank
//! designed in `domain::equalizer`.
//!
//! Live updates without recreating the sink: settings live behind
//! `SharedEq` (mutex + generation counter). The per-sample fast path only
//! performs one relaxed atomic compare; the mutex is touched (and the
//! coefficient bank redesigned) when the generation or the inner stream
//! layout changes. Filter states are preserved across pure gain changes so
//! dragging a slider never produces a click, and reset when the EQ is
//! (re-)enabled or the channel count changes.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::Source;

use super::spectrum::SpectrumTap;

use crate::domain::equalizer::{design_bank, db_to_linear, BiquadCoeffs, BiquadState, EqSettings, BAND_COUNT};

/// EQ state shared between the service (writer) and the audio thread
/// (reader). Every write bumps `generation` so readers detect the change
/// without polling the mutex.
pub struct SharedEq {
    settings: Mutex<EqSettings>,
    generation: AtomicU64,
}

impl SharedEq {
    pub fn new(initial: EqSettings) -> Self {
        Self {
            settings: Mutex::new(initial),
            generation: AtomicU64::new(1),
        }
    }

    /// Publishes new settings and wakes readers via the generation bump.
    pub fn set(&self, eq: EqSettings) {
        let mut guard = self.settings.lock().unwrap_or_else(|e| e.into_inner());
        *guard = eq;
        self.generation.fetch_add(1, Ordering::Release);
    }

    fn current(&self) -> EqSettings {
        self.settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }
}

/// Per-channel cascade states for one designed bank.
struct FilterBank {
    coeffs: Vec<BiquadCoeffs>,
    /// `[band][channel]` — the per-sample loop walks bands for the current
    /// interleaved channel, so band-major keeps those rows contiguous.
    states: Vec<Vec<BiquadState>>,
    channels: u32,
}

impl FilterBank {
    fn design(sample_rate: u32, channels: u32, gains_db: &[f32]) -> Self {
        Self {
            coeffs: design_bank(sample_rate, gains_db),
            states: vec![vec![BiquadState::default(); channels as usize]; BAND_COUNT],
            channels,
        }
    }

    /// Swaps coefficients while keeping running states (click-free gain
    /// change); states are only meaningful per matching channel count.
    fn re_coeff(&mut self, coeffs: Vec<BiquadCoeffs>, channels: u32) {
        if channels != self.channels {
            self.states = vec![vec![BiquadState::default(); channels as usize]; BAND_COUNT];
            self.channels = channels;
        }
        self.coeffs = coeffs;
    }
}

/// Wraps a f32 sample source, applying the shared EQ inline.
pub struct EqualizerSource<S> {
    inner: S,
    shared: Arc<SharedEq>,
    /// Optional spectrum capture fed with the post-EQ signal (what the
    /// user actually hears); `None` in tests that only exercise EQ math.
    tap: Option<Arc<SpectrumTap>>,
    /// None while bypassed (disabled); Some when filtering.
    bank: Option<FilterBank>,
    last_generation: u64,
    cached_spec: (u32, u16),
    /// Linear preamp factor; 1.0 while bypassed.
    preamp: f32,
    /// Interleaved channel cursor for the filter states.
    channel_index: u32,
}

impl<S> EqualizerSource<S> {
    pub fn new(inner: S, shared: Arc<SharedEq>) -> Self {
        Self {
            inner,
            shared,
            tap: None,
            bank: None,
            last_generation: 0, // forces a first refresh
            cached_spec: (0, 0),
            preamp: 1.0,
            channel_index: 0,
        }
    }

    /// Same as `new`, but mirrors every emitted sample into `tap` (used by
    /// the engine for the spectrum view; one atomic store per sample).
    pub fn with_tap(inner: S, shared: Arc<SharedEq>, tap: Arc<SpectrumTap>) -> Self {
        Self {
            tap: Some(tap),
            ..Self::new(inner, shared)
        }
    }
}

impl<S: Source<Item = f32>> EqualizerSource<S> {
    /// Reloads settings when the shared generation or the inner stream
    /// layout changed. Kept inline-cold: runs once per update, not once per
    /// sample.
    fn refresh_if_stale(&mut self, sample_rate: u32, channels: u16) {
        let generation = self.shared.generation();
        let spec = (sample_rate, channels);
        if generation == self.last_generation && spec == self.cached_spec {
            return;
        }
        let settings = self.shared.current();
        self.preamp = db_to_linear(settings.preamp_db);
        if settings.enabled {
            let gains = settings.gains_db.as_slice();
            match self.bank.take() {
                // Same layout: swap coefficients only, keeping states.
                Some(mut bank) => {
                    bank.re_coeff(design_bank(sample_rate, gains), channels as u32);
                    self.bank = Some(bank);
                }
                // (Re-)enabled: fresh bank with zeroed states.
                None => {
                    self.bank = Some(FilterBank::design(sample_rate, channels as u32, gains));
                }
            }
        } else {
            // Bypass: drop the bank entirely so re-enabling starts clean.
            self.bank = None;
            self.preamp = 1.0;
        }
        self.last_generation = generation;
        self.cached_spec = spec;
    }
}

impl<S: Source<Item = f32>> Iterator for EqualizerSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        let channels = self.inner.channels();
        let rate = self.inner.sample_rate();
        self.refresh_if_stale(rate, channels);
        let value = match self.bank.as_mut() {
            None => sample, // bypassed
            Some(bank) => {
                let channels = bank.channels;
                let channel = self.channel_index as usize;
                self.channel_index = (self.channel_index + 1) % channels.max(1);
                let mut value = sample * self.preamp;
                // Split the bank borrow so coefficients and states coexist.
                let FilterBank { coeffs, states, .. } = bank;
                for (coeffs, states) in coeffs.iter().zip(states.iter_mut()) {
                    let index = channel.min(states.len().saturating_sub(1));
                    value = states[index].process(coeffs, value);
                }
                value
            }
        };
        // Mirror the emitted sample for the spectrum view (bypassed EQ
        // included — the visualization must not depend on the EQ switch).
        if let Some(tap) = &self.tap {
            tap.push(value);
        }
        Some(value)
    }
}

impl<S: Source<Item = f32>> Source for EqualizerSource<S> {
    // Delegated unchanged: the wrapper must not disturb rodio's conversion
    // pipeline (see the sample-vs-frame note in symphonia_source.rs).
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

    /// Writes a stereo 16-bit sine WAV of `seconds` at `frequency` Hz.
    fn wav_sine(frequency: f32, seconds: f64) -> Vec<u8> {
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
                let value = ((frequency * i as f32 * std::f32::consts::TAU / 44_100.0).sin()
                    * 12_000.0) as i16;
                writer.write_sample(value).unwrap();
                writer.write_sample(value).unwrap();
            }
            writer.finalize().unwrap();
        }
        cursor.into_inner()
    }

    /// Peak amplitude of the samples above `skip_ratio` (post-settling).
    fn peak_after(samples: &[f32], skip_ratio: f64) -> f32 {
        let skip = (samples.len() as f64 * skip_ratio) as usize;
        samples[skip..].iter().fold(0.0f32, |acc, s| acc.max(s.abs()))
    }

    fn eq_source(bytes: Vec<u8>, shared: Arc<SharedEq>) -> EqualizerSource<impl Source<Item = f32>> {
        let inner = source_from_bytes(bytes, "test.wav").unwrap();
        EqualizerSource::new(inner, shared)
    }

    #[test]
    fn disabled_eq_is_bit_exact_pass_through() {
        // Non-flat gains prove the bypass path, not a designed flat bank.
        let shared = Arc::new(SharedEq::new(
            EqSettings {
                enabled: false,
                preamp_db: -6.0,
                gains_db: vec![12.0; BAND_COUNT],
            }
            .sanitize(),
        ));
        let bytes = wav_sine(440.0, 0.2);
        let raw: Vec<f32> = source_from_bytes(bytes.clone(), "raw.wav").unwrap().collect();
        let filtered: Vec<f32> = eq_source(bytes, shared).collect();
        assert_eq!(raw.len(), filtered.len());
        assert_eq!(raw, filtered, "bypass must not touch samples");
    }

    #[test]
    fn enabled_flat_eq_is_bit_exact_pass_through() {
        let shared = Arc::new(SharedEq::new(EqSettings::default()));
        let bytes = wav_sine(440.0, 0.2);
        let raw: Vec<f32> = source_from_bytes(bytes.clone(), "raw.wav").unwrap().collect();
        let filtered: Vec<f32> = eq_source(bytes, shared).collect();
        assert_eq!(raw, filtered, "flat bank is identity by design");
    }

    #[test]
    fn bass_boost_amplifies_low_frequency_content() {
        let shared = Arc::new(SharedEq::new(EqSettings::default()));
        let bytes = wav_sine(20.0, 0.5);
        let raw: Vec<f32> = source_from_bytes(bytes.clone(), "raw.wav").unwrap().collect();
        let quiet: Vec<f32> = eq_source(bytes.clone(), shared.clone()).collect();
        assert!((peak_after(&raw, 0.5) - peak_after(&quiet, 0.5)).abs() < 1e-3);

        // Full bass boost, live, on the same (exhausted-free) source.
        shared.set(
            EqSettings {
                enabled: true,
                preamp_db: 0.0,
                gains_db: vec![12.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            }
            .sanitize(),
        );
        let boosted: Vec<f32> = eq_source(bytes, shared).collect();
        assert_eq!(boosted.len(), raw.len());
        assert!(
            peak_after(&boosted, 0.5) > peak_after(&raw, 0.5) * 1.5,
            "bass boost must amplify 20 Hz: {} vs {}",
            peak_after(&boosted, 0.5),
            peak_after(&raw, 0.5)
        );
    }

    #[test]
    fn live_update_takes_effect_mid_stream() {
        // One source, half the samples flat, then a boost published while
        // iterating: the second half must change without recreating the sink.
        let shared = Arc::new(SharedEq::new(EqSettings {
            enabled: true,
            ..EqSettings::default()
        }));
        let bytes = wav_sine(20.0, 1.0);
        let raw: Vec<f32> = source_from_bytes(bytes, "raw.wav").unwrap().collect();
        let mut source = eq_source(wav_sine(20.0, 1.0), shared.clone());

        let half = raw.len() / 2;
        let first: Vec<f32> = (&mut source).take(half).collect();
        shared.set(
            EqSettings {
                enabled: true,
                preamp_db: 0.0,
                gains_db: vec![12.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            }
            .sanitize(),
        );
        let second: Vec<f32> = source.collect();

        assert_eq!(first.len(), half);
        assert!((peak_after(&first, 0.0) - peak_after(&raw[..half], 0.0)).abs() < 1e-3);
        assert!(
            peak_after(&second, 0.0) > peak_after(&raw[half..], 0.0) * 1.5,
            "post-update samples must reflect the new gains"
        );
    }

    #[test]
    fn preamp_attenuates_everything() {
        let shared = Arc::new(SharedEq::new(
            EqSettings {
                enabled: true,
                preamp_db: -6.0,
                gains_db: vec![0.0; BAND_COUNT],
            }
            .sanitize(),
        ));
        let bytes = wav_sine(440.0, 0.3);
        let raw: Vec<f32> = source_from_bytes(bytes.clone(), "raw.wav").unwrap().collect();
        let filtered: Vec<f32> = eq_source(bytes, shared).collect();
        let ratio = peak_after(&filtered, 0.5) / peak_after(&raw, 0.5);
        // -6 dB ≈ 0.501.
        assert!((ratio - 0.501).abs() < 0.02, "preamp ratio was {ratio}");
    }

    #[test]
    fn delegates_layout_to_inner_source() {
        let shared = Arc::new(SharedEq::new(EqSettings::default()));
        let mut source = eq_source(wav_sine(440.0, 0.1), shared);
        assert_eq!(source.channels(), 2);
        assert_eq!(source.sample_rate(), 44_100);
        assert_eq!(source.total_duration(), None);
        assert!(source.next().is_some());
        assert!(source.current_frame_len().is_some());
    }

    /// The tap must mirror the *emitted* signal on every path: disabled EQ
    /// (bypass) and enabled EQ alike, in emission order.
    #[test]
    fn tap_captures_emitted_samples_on_bypass_and_filter_paths() {
        for enabled in [false, true] {
            let shared = Arc::new(SharedEq::new(EqSettings {
                enabled,
                preamp_db: 0.0,
                // Flat gains keep the filtered path == bypass mathematically,
                // so both paths must produce identical tap contents.
                gains_db: vec![0.0; BAND_COUNT],
            }));
            let tap = Arc::new(SpectrumTap::new(64));
            let inner = source_from_bytes(wav_sine(440.0, 0.05), "t.wav").unwrap();
            let mut source = EqualizerSource::with_tap(inner, shared, tap.clone());
            let emitted: Vec<f32> = (&mut source).take(16).collect();
            let mut captured = Vec::new();
            assert_eq!(tap.snapshot_newest(16, &mut captured), 16);
            assert_eq!(captured, emitted, "enabled={enabled}");
        }
    }

    #[test]
    fn tap_sees_the_boosted_signal_when_eq_is_active() {
        let shared = Arc::new(SharedEq::new(EqSettings::default()));
        let tap = Arc::new(SpectrumTap::new(8192));
        // 20 Hz sine: full bass boost must make captured samples louder.
        let inner = source_from_bytes(wav_sine(20.0, 0.5), "t.wav").unwrap();
        let mut source = EqualizerSource::with_tap(inner, shared.clone(), tap.clone());
        let flat: Vec<f32> = (&mut source).take(30_000).collect();
        let flat_peak = flat.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));

        shared.set(
            EqSettings {
                enabled: true,
                preamp_db: 0.0,
                gains_db: vec![12.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            }
            .sanitize(),
        );
        let boosted: Vec<f32> = source.take(30_000).collect();
        let boosted_peak = boosted.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));

        let mut captured = Vec::new();
        tap.snapshot_newest(8192, &mut captured);
        let captured_peak = captured.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));
        assert!(
            captured_peak > boosted_peak * 0.8,
            "tap must mirror the boosted tail: {captured_peak} vs {boosted_peak}"
        );
        assert!(boosted_peak > flat_peak * 1.5);
    }
}
