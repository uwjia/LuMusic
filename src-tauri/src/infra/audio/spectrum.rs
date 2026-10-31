//! Spectrum capture: a lock-free SPSC tap fed from the audio thread plus
//! the analyzer that turns captured samples into display frames.
//!
//! The audio callback must never block or allocate, so `SpectrumTap` only
//! performs one atomic store plus one release publish per sample. The
//! single writer (the source consumed by rodio) may overwrite samples the
//! single reader has not consumed yet — for a visualization that is the
//! right trade (drop old data, never stall playback). Reads of overwritten
//! slots still observe whole (atomic) samples, worst case a one-frame
//! visual glitch.

use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

use crate::domain::spectrum::{spectrum_bars, FFT_SIZE, SPECTRUM_BARS};

/// Lock-free single-producer/single-consumer ring of f32 samples.
pub struct SpectrumTap {
    /// f32 bit patterns; atomics keep torn writes impossible.
    slots: Box<[AtomicU32]>,
    /// Monotonic total-written counter (also the next write slot).
    written: AtomicUsize,
}

impl SpectrumTap {
    /// Capacity is rounded up to a power of two for mask addressing.
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(4).next_power_of_two();
        let slots = (0..capacity)
            .map(|_| AtomicU32::new(0))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        Self {
            slots,
            written: AtomicUsize::new(0),
        }
    }

    /// Producer side (audio thread). One store + one release publish.
    #[inline]
    pub fn push(&self, sample: f32) {
        let index = self.written.load(Ordering::Relaxed);
        self.slots[index & (self.slots.len() - 1)]
            .store(sample.to_bits(), Ordering::Relaxed);
        self.written.store(index + 1, Ordering::Release);
    }

    /// Consumer side: copies the newest `count` samples (fewer if less
    /// audio has been captured overall). Returns how many were copied.
    pub fn snapshot_newest(&self, count: usize, out: &mut Vec<f32>) -> usize {
        out.clear();
        let total = self.written.load(Ordering::Acquire);
        let available = total.min(self.slots.len());
        let take = count.min(available);
        if take == 0 {
            return 0;
        }
        out.reserve(take);
        let mask = self.slots.len() - 1;
        for slot in (total - take)..total {
            let bits = self.slots[slot & mask].load(Ordering::Relaxed);
            out.push(f32::from_bits(bits));
        }
        take
    }
}

/// Turns tap contents into normalized display frames.
pub struct SpectrumAnalyzer {
    tap: Arc<SpectrumTap>,
    scratch: Vec<f32>,
}

impl SpectrumAnalyzer {
    pub fn new(tap: Arc<SpectrumTap>) -> Self {
        Self {
            tap,
            scratch: Vec::with_capacity(FFT_SIZE),
        }
    }

    /// Latest frame, or `None` while less than a full analysis window of
    /// audio has been captured (start of a track / device-less session).
    pub fn frame(&mut self, sample_rate: u32) -> Option<Vec<f32>> {
        let captured = self.tap.snapshot_newest(FFT_SIZE, &mut self.scratch);
        if captured < FFT_SIZE {
            return None;
        }
        Some(spectrum_bars(&self.scratch, sample_rate, SPECTRUM_BARS))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn snapshot_returns_newest_samples_in_order() {
        let tap = SpectrumTap::new(8);
        let mut out = Vec::new();
        assert_eq!(tap.snapshot_newest(4, &mut out), 0);
        for i in 0..4i32 {
            tap.push(i as f32);
        }
        assert_eq!(tap.snapshot_newest(4, &mut out), 4);
        assert_eq!(out, vec![0.0, 1.0, 2.0, 3.0]);
        // Fewer requested than available: only the newest.
        assert_eq!(tap.snapshot_newest(2, &mut out), 2);
        assert_eq!(out, vec![2.0, 3.0]);
    }

    #[test]
    fn writing_past_capacity_overwrites_the_oldest() {
        let tap = SpectrumTap::new(8);
        for i in 0..20i32 {
            tap.push(i as f32);
        }
        let mut out = Vec::new();
        assert_eq!(tap.snapshot_newest(100, &mut out), 8);
        assert_eq!(out, vec![12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0]);
    }

    /// Concurrent hammering must never panic, corrupt lengths, or return
    /// non-finite values (the reader races the writer by design).
    #[test]
    fn concurrent_writer_never_breaks_the_reader() {
        let tap = Arc::new(SpectrumTap::new(1024));
        let writer_tap = tap.clone();
        let writer = thread::spawn(move || {
            for i in 0..500_000 {
                writer_tap.push((i as f32 * 0.001).sin());
            }
        });
        let mut out = Vec::new();
        let mut frames = 0;
        while !writer.is_finished() {
            let taken = tap.snapshot_newest(256, &mut out);
            assert!(taken <= 256);
            assert_eq!(out.len(), taken);
            assert!(out.iter().all(|s| s.is_finite()));
            frames += 1;
        }
        writer.join().unwrap();
        assert!(frames > 1, "reader must have run repeatedly");
    }

    #[test]
    fn analyzer_needs_a_full_window_before_producing_frames() {
        let tap = Arc::new(SpectrumTap::new(FFT_SIZE * 2));
        let mut analyzer = SpectrumAnalyzer::new(tap.clone());
        assert_eq!(analyzer.frame(44_100), None);
        for _ in 0..FFT_SIZE - 1 {
            tap.push(0.0);
        }
        assert_eq!(analyzer.frame(44_100), None, "one sample short");
        tap.push(0.0);
        assert_eq!(analyzer.frame(44_100), Some(vec![0.0; SPECTRUM_BARS]));
    }

    #[test]
    fn analyzer_locates_a_captured_bass_sine() {
        let tap = Arc::new(SpectrumTap::new(FFT_SIZE * 2));
        let mut analyzer = SpectrumAnalyzer::new(tap.clone());
        // Prime the tap with a 62 Hz sine (mono, one push per sample).
        let rate = 44_100.0f32;
        for t in 0..FFT_SIZE {
            tap.push((62.0 * t as f32 * std::f32::consts::TAU / rate).sin() * 0.9);
        }
        let frame = analyzer.frame(44_100).unwrap();
        assert_eq!(frame.len(), SPECTRUM_BARS);
        let peak = frame
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert!(peak <= 3, "bass peak bar was {peak}");
        assert!(frame[peak] > 0.4);
    }
}
