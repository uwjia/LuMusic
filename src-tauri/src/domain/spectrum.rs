//! Spectrum analysis math: FFT + windowing + log-frequency band aggregation.
//!
//! Pure math (no IO): the audio thread only *captures* samples into a tap
//! (see `infra::audio::spectrum`); this module owns the transforms run on
//! the poller thread. The FFT is a hand-rolled iterative radix-2
//! (Cooley–Tukey) — the project keeps a zero-redundancy-dependency policy
//! and the required transform is small (2048 points, ~20 Hz).

/// Number of displayed spectrum bars.
pub const SPECTRUM_BARS: usize = 24;

/// Analysis window length in samples (power of two).
pub const FFT_SIZE: usize = 2048;

/// Lowest/highest band edge (Hz) — aligned with the equalizer band layout
/// so both views describe the same frequency range.
pub const SPECTRUM_MIN_HZ: f32 = 31.0;
pub const SPECTRUM_MAX_HZ: f32 = 16_000.0;

/// Displayed dynamic range: magnitudes below this dB floor render as zero.
const MIN_DB: f32 = -60.0;
/// dB headroom above a full-scale sinusoid peak (+6 dB with a Hann window
/// and bin normalization) so loud content tops out inside the range.
const MAX_DB: f32 = 12.0;

/// Multi-purpose tiny float epsilon for log/degenerate-input protection.
const EPS: f32 = 1e-9;

/// Iterative radix-2 FFT (in-place, decimation in time).
///
/// `re`/`im` must share a power-of-two length; other lengths are a caller
/// bug and panic (the analyzer always passes `FFT_SIZE`).
pub fn fft_radix2(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    assert!(n.is_power_of_two(), "fft length must be a power of two");
    assert_eq!(im.len(), n, "re/im buffers must match");

    // Bit-reversal permutation.
    let bits = n.trailing_zeros();
    for i in 0..n {
        let j = (i.reverse_bits() >> (usize::BITS - bits)) as usize;
        if j > i {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    // Butterfly passes; twiddle advances multiplicatively per stage.
    let mut len = 2usize;
    while len <= n {
        let angle = -std::f32::consts::TAU / len as f32;
        let (sin_a, cos_a) = angle.sin_cos();
        let (wr, wi) = (cos_a, sin_a); // w = e^{i·angle}
        for start in (0..n).step_by(len) {
            let (mut cur_r, mut cur_i) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let even_r = re[start + k];
                let even_i = im[start + k];
                let odd_r = re[start + k + len / 2];
                let odd_i = im[start + k + len / 2];
                let t_r = cur_r * odd_r - cur_i * odd_i;
                let t_i = cur_r * odd_i + cur_i * odd_r;
                re[start + k] = even_r + t_r;
                im[start + k] = even_i + t_i;
                re[start + k + len / 2] = even_r - t_r;
                im[start + k + len / 2] = even_i - t_i;
                let next_r = cur_r * wr - cur_i * wi;
                cur_i = cur_r * wi + cur_i * wr;
                cur_r = next_r;
            }
        }
        len *= 2;
    }
}

/// Hann window of `len` samples (periodic form).
pub fn hann_window(len: usize) -> Vec<f32> {
    (0..len)
        .map(|i| {
            let t = i as f32 / len as f32;
            0.5 - 0.5 * (std::f32::consts::TAU * t).cos()
        })
        .collect()
}

/// Aggregates `FFT_SIZE` mono samples into `bars` normalized magnitudes.
///
/// `window.len()` must equal a power of two; anything shorter than 2 (e.g.
/// silence before enough audio arrived) yields all zeros rather than an
/// error — a missing spectrum must never disturb playback paths.
pub fn spectrum_bars(window: &[f32], sample_rate: u32, bars: usize) -> Vec<f32> {
    let out = vec![0.0; bars];
    if window.len() < 2 || !window.len().is_power_of_two() || sample_rate == 0 {
        return out;
    }

    // Window + FFT.
    let hann = hann_window(window.len());
    let mut re: Vec<f32> = window.iter().zip(hann).map(|(s, w)| s * w).collect();
    let mut im = vec![0.0; re.len()];
    fft_radix2(&mut re, &mut im);

    // Per-bin linear magnitudes, normalized so a full-scale sine lands near
    // the top of the displayed range regardless of window length.
    let n = re.len();
    let half = n / 2;
    let mags: Vec<f32> = (0..half)
        .map(|k| re[k].hypot(im[k]) / half as f32)
        .collect();

    // Log-spaced band edges over [MIN_HZ, MAX_HZ].
    let hz_per_bin = sample_rate as f32 / n as f32;
    let ratio = (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ).ln();
    let bin_of = |hz: f32| ((hz / hz_per_bin).round() as usize).min(half.saturating_sub(1));
    let mut out = out;
    for bar in 0..bars {
        let low_hz = SPECTRUM_MIN_HZ * (ratio * bar as f32 / bars as f32).exp();
        let high_hz = SPECTRUM_MIN_HZ * (ratio * (bar + 1) as f32 / bars as f32).exp();
        // At least one bin per bar, even at the bottom where log spacing
        // narrows below the bin width.
        let low_bin = bin_of(low_hz);
        let high_bin = bin_of(high_hz).max(low_bin + 1).min(half);
        let peak = mags[low_bin..high_bin].iter().copied().fold(0.0f32, f32::max);
        let db = 20.0 * (peak + EPS).log10();
        out[bar] = ((db - MIN_DB) / (MAX_DB - MIN_DB)).clamp(0.0, 1.0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    /// Naive O(n²) DFT reference for correctness checking.
    fn naive_dft(input: &[f32]) -> (Vec<f32>, Vec<f32>) {
        let n = input.len();
        let mut re = vec![0.0; n];
        let mut im = vec![0.0; n];
        for k in 0..n {
            for (t, x) in input.iter().enumerate() {
                let angle = -TAU * (k * t) as f32 / n as f32;
                re[k] += x * angle.cos();
                im[k] += x * angle.sin();
            }
        }
        (re, im)
    }

    #[test]
    fn fft_matches_naive_dft() {
        // Deterministic pseudo-random signal across the spectrum.
        let input: Vec<f32> = (0..64)
            .map(|i| ((i as f32 * 12.9898).sin() * 43_758.5453).fract() - 0.5)
            .collect();
        let (want_re, want_im) = naive_dft(&input);
        let mut re = input.clone();
        let mut im = vec![0.0; input.len()];
        fft_radix2(&mut re, &mut im);
        for k in 0..input.len() {
            assert!(
                (re[k] - want_re[k]).abs() < 1e-2,
                "bin {k} re: {} vs {}",
                re[k],
                want_re[k]
            );
            assert!(
                (im[k] - want_im[k]).abs() < 1e-2,
                "bin {k} im: {} vs {}",
                im[k],
                want_im[k]
            );
        }
    }

    #[test]
    fn sine_peaks_in_its_bin() {
        let rate = 8_000u32;
        let n = 1_024usize;
        // Pick a frequency exactly on a bin: no window means any fractional
        // bin leaks into its neighbours (that leakage is real physics, not
        // an FFT bug), which would mask the sharpness this test pins.
        let peak_bin_expected = 56usize;
        let freq = peak_bin_expected as f32 * rate as f32 / n as f32;
        let input: Vec<f32> = (0..n)
            .map(|t| (freq * t as f32 * TAU / rate as f32).sin() * 0.5)
            .collect();
        let (re, im) = naive_dft(&input);
        let mut mags: Vec<f32> = (0..n / 2)
            .map(|k| re[k].hypot(im[k]))
            .collect();
        let peak_bin = mags
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert_eq!(peak_bin, peak_bin_expected, "peak must sit at the sine bin");
        assert!(mags[peak_bin] > 100.0, "peak must dominate");
        // An integer-bin sine keeps every other bin at float noise level.
        mags[peak_bin] = 0.0;
        assert!(mags.iter().all(|m| *m < 1.0), "side bins must be empty");
    }

    #[test]
    fn silence_yields_all_zero_bars() {
        let bars = spectrum_bars(&vec![0.0; FFT_SIZE], 44_100, SPECTRUM_BARS);
        assert_eq!(bars.len(), SPECTRUM_BARS);
        assert!(bars.iter().all(|b| *b == 0.0));
    }

    #[test]
    fn degenerate_windows_return_zeros_without_panicking() {
        assert_eq!(spectrum_bars(&[], 44_100, SPECTRUM_BARS), vec![0.0; SPECTRUM_BARS]);
        assert_eq!(
            spectrum_bars(&[0.5; 1000], 44_100, SPECTRUM_BARS), // not a power of two
            vec![0.0; SPECTRUM_BARS]
        );
        assert_eq!(
            spectrum_bars(&vec![0.5; FFT_SIZE], 0, SPECTRUM_BARS), // no rate yet
            vec![0.0; SPECTRUM_BARS]
        );
    }

    #[test]
    fn bass_sine_lights_the_lowest_bar_not_the_high_ones() {
        let rate = 44_100u32;
        let input: Vec<f32> = (0..FFT_SIZE)
            .map(|t| (62.0 * t as f32 * TAU / rate as f32).sin() * 0.9)
            .collect();
        let bars = spectrum_bars(&input, rate, SPECTRUM_BARS);
        let peak = bars
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        // 62 Hz sits in band 2; the Hann main lobe (~±2 bins ≈ ±43 Hz)
        // legitimately spills into neighbours, so the peak lands in band
        // 0-3 — but never higher.
        assert!(peak <= 3, "peak bar was {peak}");
        assert!(bars[peak] > 0.4, "peak must be visible: {}", bars[peak]);
        // High-frequency bands stay dark for a pure bass sine.
        assert!(
            bars[16..].iter().all(|b| *b < 0.05),
            "high bars must stay dark: {:?}",
            &bars[16..]
        );
    }

    #[test]
    fn treble_sine_lights_a_high_bar_not_the_low_ones() {
        let rate = 44_100u32;
        let input: Vec<f32> = (0..FFT_SIZE)
            .map(|t| (10_000.0 * t as f32 * TAU / rate as f32).sin() * 0.9)
            .collect();
        let bars = spectrum_bars(&input, rate, SPECTRUM_BARS);
        let peak = bars
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert!(peak >= 18, "peak bar was {peak}");
        assert!(bars[peak] > 0.4, "peak must be visible: {}", bars[peak]);
        assert!(
            bars[..8].iter().all(|b| *b < 0.05),
            "low bars must stay dark: {:?}",
            &bars[..8]
        );
    }

    #[test]
    fn bar_count_is_respected_for_any_request() {
        let input = vec![0.5f32; 512];
        assert_eq!(spectrum_bars(&input, 44_100, 16).len(), 16);
        assert_eq!(spectrum_bars(&input, 44_100, 32).len(), 32);
    }
}
