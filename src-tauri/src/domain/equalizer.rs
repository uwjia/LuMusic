//! Ten-band graphic equalizer: settings model + biquad filter design.
//!
//! Pure math only (no IO): the audio thread feeds samples through the
//! designed coefficients (see `infra::audio::equalizer`), while this module
//! owns band layout, gain sanitization and RBJ cookbook filter design.
//!
//! Flat response is *exactly* identity: a peaking/shelf section with 0 dB
//! gain reduces to matching numerator/denominator polynomials, so a flat
//! bank is guaranteed to never alter samples (relied upon by tests).

use serde::{Deserialize, Serialize};

/// Number of EQ bands (ISO octave spacing).
pub const BAND_COUNT: usize = 10;

/// Center/corner frequencies of the ten bands (Hz).
pub const BAND_FREQUENCIES: [f32; BAND_COUNT] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16_000.0,
];

/// Per-band gain bounds (dB).
pub const MIN_GAIN_DB: f32 = -12.0;
pub const MAX_GAIN_DB: f32 = 12.0;
/// Preamp bounds (dB). Negative preamp compensates boosts to avoid clipping.
pub const MIN_PREAMP_DB: f32 = -12.0;
pub const MAX_PREAMP_DB: f32 = 12.0;

/// Resonance of the peaking sections: ~one-octave bandwidth, matching the
/// octave-spaced band layout so neighbouring bands overlap smoothly.
const PEAKING_Q: f32 = 1.41;

/// User-facing equalizer configuration (persisted inside `Settings`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EqSettings {
    /// Master switch: false bypasses every filter (bit-exact pass-through).
    pub enabled: bool,
    /// Global gain applied before the bands, in dB.
    pub preamp_db: f32,
    /// Per-band gains in dB; length is normalized to `BAND_COUNT`.
    pub gains_db: Vec<f32>,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preamp_db: 0.0,
            gains_db: vec![0.0; BAND_COUNT],
        }
    }
}

impl EqSettings {
    /// Normalizes arbitrary (frontend-supplied or hand-edited) values into a
    /// processable form: NaN collapses to 0.0, gains clamp to ±12 dB, the
    /// gain vector is padded/truncated to exactly `BAND_COUNT` entries.
    pub fn sanitize(&self) -> Self {
        let sanitize_gain = |g: f32| {
            if g.is_nan() {
                0.0
            } else {
                g.clamp(MIN_GAIN_DB, MAX_GAIN_DB)
            }
        };
        let mut gains_db = Vec::with_capacity(BAND_COUNT);
        for index in 0..BAND_COUNT {
            gains_db.push(sanitize_gain(self.gains_db.get(index).copied().unwrap_or(0.0)));
        }
        let preamp_db = if self.preamp_db.is_nan() {
            0.0
        } else {
            self.preamp_db.clamp(MIN_PREAMP_DB, MAX_PREAMP_DB)
        };
        Self {
            enabled: self.enabled,
            preamp_db,
            gains_db,
        }
    }

    /// True when no filter section would change audio (all gains 0 dB).
    /// Used to skip filter work even when the EQ is nominally enabled.
    pub fn is_flat(&self) -> bool {
        self.gains_db.iter().all(|g| *g == 0.0)
    }
}

/// Converts decibels to a linear amplitude factor.
pub fn db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}

/// Normalized biquad coefficients (a0 divided out), direct form II
/// transposed structure.
///
/// Flat (0 dB) peaking/shelf sections yield `b0 = 1, b1 = a1, b2 = a2`,
/// i.e. an exact identity filter.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    /// Identity filter (passes input through unchanged).
    pub const IDENTITY: Self = Self {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };
}

/// Running state of one biquad section (direct form II transposed).
#[derive(Debug, Clone, Copy, Default)]
pub struct BiquadState {
    z1: f32,
    z2: f32,
}

impl BiquadState {
    /// Processes one sample through the section, keeping internal state.
    pub fn process(&mut self, c: &BiquadCoeffs, x: f32) -> f32 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

/// Designs one peaking section (RBJ cookbook) for `gain_db` at `f0`.
fn peaking(sample_rate: f32, f0: f32, gain_db: f32) -> BiquadCoeffs {
    let a = db_to_linear(gain_db / 2.0);
    let omega = std::f32::consts::TAU * f0 / sample_rate;
    let (sin, cos) = omega.sin_cos();
    let alpha = sin / (2.0 * PEAKING_Q);

    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cos;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * cos;
    let a2 = 1.0 - alpha / a;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

/// Designs a low-shelf section boosting/cutting everything below `f0`.
fn low_shelf(sample_rate: f32, f0: f32, gain_db: f32) -> BiquadCoeffs {
    let a = db_to_linear(gain_db / 2.0);
    let omega = std::f32::consts::TAU * f0 / sample_rate;
    let (sin, cos) = omega.sin_cos();
    let alpha = sin / 2.0;
    let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

    let b0 = a * ((a + 1.0) - (a - 1.0) * cos + two_sqrt_a_alpha);
    let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos);
    let b2 = a * ((a + 1.0) - (a - 1.0) * cos - two_sqrt_a_alpha);
    let a0 = (a + 1.0) + (a - 1.0) * cos + two_sqrt_a_alpha;
    let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos);
    let a2 = (a + 1.0) + (a - 1.0) * cos - two_sqrt_a_alpha;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

/// Designs a high-shelf section boosting/cutting everything above `f0`.
fn high_shelf(sample_rate: f32, f0: f32, gain_db: f32) -> BiquadCoeffs {
    let a = db_to_linear(gain_db / 2.0);
    let omega = std::f32::consts::TAU * f0 / sample_rate;
    let (sin, cos) = omega.sin_cos();
    let alpha = sin / 2.0;
    let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

    let b0 = a * ((a + 1.0) + (a - 1.0) * cos + two_sqrt_a_alpha);
    let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos);
    let b2 = a * ((a + 1.0) + (a - 1.0) * cos - two_sqrt_a_alpha);
    let a0 = (a + 1.0) - (a - 1.0) * cos + two_sqrt_a_alpha;
    let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos);
    let a2 = (a + 1.0) - (a - 1.0) * cos - two_sqrt_a_alpha;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

/// Designs the ten-section cascade for the given gains at `sample_rate`.
///
/// Band layout: shelf sections at the extremes (nothing exists below 31 Hz /
/// above 16 kHz worth peaking at), peaking sections in between. Out-of-range
/// frequencies (file rate lower than a band) degrade to identity sections
/// instead of producing unstable coefficients.
pub fn design_bank(sample_rate: u32, gains_db: &[f32]) -> Vec<BiquadCoeffs> {
    let fs = sample_rate as f32;
    let mut bank = Vec::with_capacity(BAND_COUNT);
    for index in 0..BAND_COUNT {
        let gain = gains_db.get(index).copied().unwrap_or(0.0);
        let f0 = BAND_FREQUENCIES[index];
        // A band above Nyquist cannot be shaped; skip it as identity.
        if f0 >= fs / 2.0 {
            bank.push(BiquadCoeffs::IDENTITY);
            continue;
        }
        let coeffs = if index == 0 {
            low_shelf(fs, f0, gain)
        } else if index == BAND_COUNT - 1 {
            high_shelf(fs, f0, gain)
        } else {
            peaking(fs, f0, gain)
        };
        bank.push(coeffs);
    }
    bank
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    /// A 0 dB section must be an exact identity filter (numerator and
    /// denominator polynomials cancel), so enabling a flat EQ can never
    /// alter samples.
    #[test]
    fn flat_bank_is_exact_identity() {
        let flat = vec![0.0; BAND_COUNT];
        for (index, coeffs) in design_bank(44_100, &flat).iter().enumerate() {
            assert!(
                (coeffs.b0 - 1.0).abs() < 1e-6
                    && (coeffs.b1 - coeffs.a1).abs() < 1e-6
                    && (coeffs.b2 - coeffs.a2).abs() < 1e-6,
                "band {index} is not identity: {coeffs:?}"
            );
        }
        // And processing a signal through it reproduces it bit-closely.
        let mut state = BiquadState::default();
        let input: Vec<f32> = (0..1000).map(|i| (i as f32 / 13.0).sin() * 0.5).collect();
        for sample in input {
            let mut y = sample;
            for coeffs in design_bank(44_100, &flat) {
                y = state.process(&coeffs, y);
            }
            assert!((y - sample).abs() < 1e-5, "flat bank altered {sample} -> {y}");
        }
    }

    #[test]
    fn sanitize_clamps_pads_and_handles_nan() {
        let dirty = EqSettings {
            enabled: true,
            preamp_db: f32::NAN,
            gains_db: vec![99.0, f32::NAN, -99.0], // too short + out of range
        };
        let clean = dirty.sanitize();
        assert!(clean.enabled);
        assert_eq!(clean.preamp_db, 0.0);
        assert_eq!(clean.gains_db.len(), BAND_COUNT);
        assert_eq!(clean.gains_db[0], MAX_GAIN_DB);
        assert_eq!(clean.gains_db[1], 0.0);
        assert_eq!(clean.gains_db[2], MIN_GAIN_DB);
        // Missing entries backfill to flat.
        assert!(clean.gains_db[3..].iter().all(|g| *g == 0.0));
    }

    #[test]
    fn default_settings_are_flat_and_disabled() {
        let eq = EqSettings::default();
        assert!(!eq.enabled);
        assert_eq!(eq.preamp_db, 0.0);
        assert_eq!(eq.gains_db, vec![0.0; BAND_COUNT]);
        assert!(eq.is_flat());
    }

    /// Boosting the bass band must amplify a low-frequency sine while
    /// leaving a high-frequency sine essentially untouched (selectivity).
    #[test]
    fn bass_boost_amplifies_low_but_not_high_frequency() {
        let mut gains = vec![0.0; BAND_COUNT];
        gains[0] = MAX_GAIN_DB; // 31 Hz low shelf, full boost

        let amplitude = |freq: f32, bank: &[BiquadCoeffs]| -> f32 {
            let mut states = vec![BiquadState::default(); bank.len()];
            let mut peak = 0.0f32;
            for frame in 0..20_000 {
                let x = (freq * frame as f32 * TAU / 44_100.0).sin() * 0.1;
                let mut y = x;
                for (coeffs, state) in bank.iter().zip(states.iter_mut()) {
                    y = state.process(coeffs, y);
                }
                if frame > 10_000 {
                    // Post-settling peak; skip the filter's transient.
                    peak = peak.max(y.abs());
                }
            }
            peak
        };

        let boosted = design_bank(44_100, &gains);
        let flat = design_bank(44_100, &vec![0.0; BAND_COUNT]);
        // 20 Hz sits well below the 31 Hz shelf corner; 40 Hz would not
        // (RBJ shelves reach full gain only below the corner).
        let (low_boost, low_flat) = (amplitude(20.0, &boosted), amplitude(20.0, &flat));
        let (high_boost, high_flat) = (amplitude(10_000.0, &boosted), amplitude(10_000.0, &flat));

        assert!(
            low_boost > low_flat * 1.5,
            "bass boost must amplify 20 Hz: {low_boost} vs {low_flat}"
        );
        assert!(
            (high_boost - high_flat).abs() < high_flat * 0.2,
            "bass boost must spare 10 kHz: {high_boost} vs {high_flat}"
        );
    }

    /// Worst case stability: all bands at maximum boost must stay bounded
    /// and finite across sample rates (no unstable coefficient design).
    #[test]
    fn max_boost_bank_stays_bounded_across_rates() {
        for rate in [8_000u32, 22_050, 44_100, 48_000, 96_000, 192_000] {
            let bank = design_bank(rate, &vec![MAX_GAIN_DB; BAND_COUNT]);
            assert_eq!(bank.len(), BAND_COUNT);
            let mut states = vec![BiquadState::default(); BAND_COUNT];
            let mut max_abs = 0.0f32;
            for frame in 0..50_000 {
                // Deterministic pseudo-noise covering the spectrum.
                let x = (((frame as f32 * 12.9898).sin() * 43_758.5453).fract() - 0.5) * 0.9;
                let mut y = x;
                for (coeffs, state) in bank.iter().zip(states.iter_mut()) {
                    y = state.process(coeffs, y);
                }
                assert!(y.is_finite(), "non-finite output at {rate} Hz");
                max_abs = max_abs.max(y.abs());
            }
            // Boosting everything by 12 dB yields ~4x amplitude; bounded
            // far away from overflow and from the pathological >100x of an
            // unstable filter.
            assert!(max_abs < 100.0, "unbounded output {max_abs} at {rate} Hz");
        }
    }

    /// Bands above Nyquist must degrade to identity, never NaN coefficients.
    #[test]
    fn bands_above_nyquist_degrade_to_identity() {
        // 8 kHz sample rate: everything above 4 kHz is beyond Nyquist.
        let gains = vec![MAX_GAIN_DB; BAND_COUNT];
        let bank = design_bank(8_000, &gains);
        for (index, coeffs) in bank.iter().enumerate() {
            if BAND_FREQUENCIES[index] >= 4_000.0 {
                assert_eq!(coeffs, &BiquadCoeffs::IDENTITY, "band {index}");
            }
        }
    }

    #[test]
    fn db_to_linear_matches_reference_points() {
        assert!((db_to_linear(0.0) - 1.0).abs() < 1e-6);
        assert!((db_to_linear(20.0) - 10.0).abs() < 1e-4);
        assert!((db_to_linear(-20.0) - 0.1).abs() < 1e-6);
        assert!((db_to_linear(6.0) - 1.995_262).abs() < 1e-4);
    }
}
