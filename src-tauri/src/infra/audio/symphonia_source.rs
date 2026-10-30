//! `rodio::Source` adapter around a symphonia `FormatReader`.
//!
//! Why a custom adapter instead of `rodio::Decoder`:
//! - accurate seeking to a wall-clock position via `FormatReader::seek`;
//! - a shared position tracker the engine can poll without touching the
//!   audio callback thread.

use std::io::{Cursor, Read, Seek};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use symphonia::core::audio::{Channels, SampleBuffer, SignalSpec};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::{Time, TimeBase};

/// Shared playback position (interleaved sample counter).
///
/// The rate/channels live behind atomics because the decode side may correct
/// them mid-stream (containers can misreport the layout) while the poller
/// thread reads the position concurrently.
#[derive(Debug)]
pub struct PosTracker {
    samples: AtomicU64,
    sample_rate: AtomicU32,
    channels: AtomicU32,
}

impl PosTracker {
    fn new(sample_rate: u32, channels: u32) -> Self {
        Self {
            samples: AtomicU64::new(0),
            sample_rate: AtomicU32::new(sample_rate),
            channels: AtomicU32::new(channels),
        }
    }

    /// Called when the decoded stream corrects the layout mid-stream.
    fn update_spec(&self, sample_rate: u32, channels: u32) {
        self.sample_rate.store(sample_rate, Ordering::Relaxed);
        self.channels.store(channels.max(1), Ordering::Relaxed);
    }

    /// Current playback position in seconds.
    pub fn position_secs(&self) -> f64 {
        let sample_rate = self.sample_rate.load(Ordering::Relaxed) as u64;
        let channels = self.channels.load(Ordering::Relaxed).max(1) as u64;
        if sample_rate == 0 {
            return 0.0;
        }
        let frames = self.samples.load(Ordering::Relaxed) / channels;
        frames as f64 / sample_rate as f64
    }

    fn set_position_secs(&self, secs: f64) {
        let sample_rate = self.sample_rate.load(Ordering::Relaxed) as f64;
        let channels = self.channels.load(Ordering::Relaxed).max(1) as u64;
        let frames = (secs.max(0.0) * sample_rate).round() as u64;
        self.samples
            .store(frames * channels, Ordering::Relaxed);
    }
}

/// Errors raised while opening or decoding a stream.
#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("no decodable audio track in '{0}'")]
    NoTrack(String),
    #[error("unsupported or corrupt audio stream in '{0}': {1}")]
    Decode(String, String),
}

/// Decodes any format supported by the enabled symphonia features and yields
/// interleaved f32 samples at native rate.
pub struct SymphoniaSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    time_base: TimeBase,
    sample_rate: u32,
    channels: u32,
    sample_buf: SampleBuffer<f32>,
    buf: Vec<f32>,
    buf_pos: usize,
    tracker: Arc<PosTracker>,
    file_name: String,
    finished: bool,
}

// Manual impl: the decoder handles contain non-Debug types.
impl std::fmt::Debug for SymphoniaSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SymphoniaSource")
            .field("file_name", &self.file_name)
            .field("sample_rate", &self.sample_rate)
            .field("channels", &self.channels)
            .field("finished", &self.finished)
            .finish()
    }
}

impl SymphoniaSource {
    /// Probes and opens `mss` for decoding.
    pub fn new(mss: MediaSourceStream, file_name: String) -> Result<Self, SourceError> {
        let probed = symphonia::default::get_probe()
            .format(
                &Hint::new(),
                mss,
                &Default::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| SourceError::Decode(file_name.clone(), e.to_string()))?;
        let format = probed.format;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| SourceError::NoTrack(file_name.clone()))?
            .clone();
        let track_id = track.id;
        let sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
        let channels = track
            .codec_params
            .channels
            .unwrap_or(Channels::FRONT_LEFT | Channels::FRONT_RIGHT);
        let channel_count = channels.count();
        let time_base = track
            .codec_params
            .time_base
            .unwrap_or_else(|| TimeBase::new(1, sample_rate));
        let spec = SignalSpec::new(sample_rate, channels);

        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| SourceError::Decode(file_name.clone(), e.to_string()))?;

        // Initial capacity only; `fill_buf` resizes to the real packet
        // capacity and corrects the channel count/rate from the decoded
        // stream (containers sometimes misreport them).
        let sample_buf = SampleBuffer::<f32>::new(16_384, spec);

        Ok(Self {
            format,
            decoder,
            track_id,
            time_base,
            sample_rate,
            channels: channel_count as u32,
            sample_buf,
            buf: Vec::new(),
            buf_pos: 0,
            tracker: Arc::new(PosTracker::new(sample_rate, channel_count as u32)),
            file_name,
            finished: false,
        })
    }

    /// Handle used by the engine to poll the playback position.
    pub fn position_tracker(&self) -> Arc<PosTracker> {
        self.tracker.clone()
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u32 {
        self.channels
    }

    /// Decodes the next packet into `self.buf`; returns false at end of stream.
    ///
    /// The `SampleBuffer` spec follows the *decoded* audio: decoding with a
    /// mismatched spec interleaves samples at the wrong stride (e.g. a mono
    /// stream declared as stereo), which surfaces as crackling noise. The
    /// output `Vec` is reused across packets so the audio thread never
    /// allocates per packet (allocation jitter causes underruns).
    fn fill_buf(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(_) => return false, // end of stream or reader failure
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    let channels = spec.channels.count() as u32;
                    let needed = decoded.capacity() as usize * channels as usize;
                    if channels != self.channels
                        || spec.rate != self.sample_rate
                        || self.sample_buf.capacity() < needed
                    {
                        self.sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                        self.channels = channels;
                        self.sample_rate = spec.rate;
                        self.tracker.update_spec(spec.rate, channels);
                    }
                    self.sample_buf.copy_interleaved_ref(decoded);
                    self.buf.clear();
                    self.buf.extend_from_slice(self.sample_buf.samples());
                    self.buf_pos = 0;
                    return true;
                }
                Err(SymphoniaError::DecodeError(_)) => continue, // skip corrupt packet
                Err(_) => return false,
            }
        }
    }

    /// Seeks to `secs` (accurate mode) and resets the position tracker to the
    /// actual position the container landed on.
    pub fn seek_by_time(&mut self, secs: f64) -> Result<(), SourceError> {
        let secs = secs.max(0.0);
        let time = Time::new(secs.floor() as u64, secs.fract());
        let to = SeekTo::Time {
            time,
            track_id: Some(self.track_id),
        };
        // Discard anything still buffered from the old position.
        self.buf.clear();
        self.buf_pos = 0;
        self.finished = false;
        match self.format.seek(SeekMode::Accurate, to) {
            Ok(seeked) => {
                let actual = self.time_base.calc_time(seeked.actual_ts);
                self.decoder.reset();
                self.tracker
                    .set_position_secs(actual.seconds as f64 + actual.frac);
                Ok(())
            }
            Err(e) => Err(SourceError::Decode(self.file_name.clone(), e.to_string())),
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.finished {
            return None;
        }
        loop {
            if self.buf_pos < self.buf.len() {
                let sample = self.buf[self.buf_pos];
                self.buf_pos += 1;
                self.tracker.samples.fetch_add(1, Ordering::Relaxed);
                return Some(sample);
            }
            // Buffer drained: decode the next packet.
            if !self.fill_buf() {
                self.finished = true;
                return None;
            }
        }
    }
}

impl rodio::Source for SymphoniaSource {
    /// Remaining *samples* in the current packet (all channels included).
    ///
    /// NOTE: despite the name, rodio's conversion pipeline consumes this
    /// value as a `Take(n)` limit over `Iterator::next`, i.e. over *samples*
    /// (see `rodio::source::uniform`). Returning frame counts here
    /// (samples / channels) truncates every conversion chunk and drops
    /// audio - audible as crackling whenever the device sample rate differs
    /// from the file (e.g. a 48 kHz device playing 44.1 kHz audio).
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.buf.len() - self.buf_pos)
    }

    fn channels(&self) -> u16 {
        self.channels.min(u16::MAX as u32) as u16
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// Wraps any in-memory reader as a symphonia `MediaSource`.
pub struct ReaderSource<R: Read + Seek + Send + Sync> {
    inner: R,
    len: Option<u64>,
}

impl<R: Read + Seek + Send + Sync> ReaderSource<R> {
    pub fn new(mut inner: R) -> Self {
        let len = inner.seek(std::io::SeekFrom::End(0)).ok();
        let _ = inner.seek(std::io::SeekFrom::Start(0));
        Self { inner, len }
    }
}

impl<R: Read + Seek + Send + Sync> Read for ReaderSource<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl<R: Read + Seek + Send + Sync> Seek for ReaderSource<R> {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

impl<R: Read + Seek + Send + Sync> MediaSource for ReaderSource<R> {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        self.len
    }
}

/// Convenience helper: builds a source over an in-memory byte buffer (tests).
pub fn source_from_bytes(bytes: Vec<u8>, file_name: &str) -> Result<SymphoniaSource, SourceError> {
    let mss = MediaSourceStream::new(
        Box::new(ReaderSource::new(Cursor::new(bytes))),
        Default::default(),
    );
    SymphoniaSource::new(mss, file_name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;

    /// Writes a stereo 16-bit sine WAV of `seconds` length into memory.
    fn wav_bytes(seconds: f64) -> Vec<u8> {
        wav_bytes_with(2, 44_100, seconds)
    }

    /// Writes a 16-bit sine WAV with the given layout into memory.
    fn wav_bytes_with(channels: u16, sample_rate: u32, seconds: f64) -> Vec<u8> {
        let spec = hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
            let frames = (seconds * spec.sample_rate as f64) as u32;
            for i in 0..frames {
                let value = ((i as f32 / 10.0).sin() * 8000.0) as i16;
                for _ in 0..channels {
                    writer.write_sample(value).unwrap();
                }
            }
            writer.finalize().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn decodes_full_wav_and_reports_position() {
        let mut src = source_from_bytes(wav_bytes(1.0), "test.wav").unwrap();
        assert_eq!(src.sample_rate(), 44_100);
        assert_eq!(src.channels(), 2);

        let tracker = src.position_tracker();
        let count = src.by_ref().count();
        // 1s * 44100 frames * 2 channels; allow a truncated trailing frame.
        assert!(
            (88_100..=88_200).contains(&count),
            "unexpected sample count {count}"
        );
        let pos = tracker.position_secs();
        assert!((0.95..=1.05).contains(&pos), "position was {pos}");

        // Exhausted source stays exhausted.
        assert_eq!(src.next(), None);
        assert_eq!(src.next(), None);
    }

    /// Guards against crackling noise: rodio's conversion pipeline uses
    /// `current_frame_len()` as a `Take(n)` limit over *samples*. Returning
    /// frame counts (samples / channels) silently drops (channels-1)/channels
    /// of every conversion chunk whenever the device rate differs from the
    /// file rate.
    #[test]
    fn current_frame_len_counts_samples_not_frames() {
        let mut src = source_from_bytes(wav_bytes(0.5), "test.wav").unwrap();
        // Pull the first packet without draining it.
        assert!(src.next().is_some());
        let remaining = src.current_frame_len().expect("packet is loaded");
        assert!(
            remaining > 1_000,
            "a 2-channel packet must expose thousands of samples, got {remaining}"
        );
        // Consume a few samples; the value must shrink by exactly that much.
        let before = src.current_frame_len().unwrap();
        for _ in 0..10 {
            src.next().unwrap();
        }
        assert_eq!(src.current_frame_len().unwrap(), before - 10);
    }

    /// Guards against channel-stride crackling: mono files must report one
    /// channel and decode exactly one sample per frame.
    #[test]
    fn mono_wav_reports_one_channel() {
        let mut src = source_from_bytes(wav_bytes_with(1, 8_000, 0.1), "mono.wav").unwrap();
        let expected = 800usize; // 0.1s * 8000 frames
        let count = src.by_ref().count();
        assert!(
            (count as i64 - expected as i64).abs() < 4,
            "mono decode produced {count} samples, expected ~{expected}"
        );
    }

    /// End-to-end integrity check: decoded f32 samples must match the source
    /// waveform (within i16 -> f32 conversion error). Any stride/truncation
    /// bug immediately desynchronizes the comparison.
    #[test]
    fn decoded_samples_match_source_waveform() {
        let sample_rate = 8_000u32;
        let frames = 800u32;
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let original: Vec<i16> = (0..frames)
            .flat_map(|i| {
                let value = ((i as f32 / 7.0).sin() * 12_000.0) as i16;
                [value, value]
            })
            .collect();
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for sample in &original {
                writer.write_sample(*sample).unwrap();
            }
            writer.finalize().unwrap();
        }

        let src = source_from_bytes(cursor.into_inner(), "wave.wav").unwrap();
        let decoded: Vec<f32> = src.collect();
        assert_eq!(decoded.len(), original.len(), "sample count mismatch");

        let to_f32 = |s: i16| s as f32 / i16::MAX as f32;
        for (index, (got, want)) in decoded.iter().zip(original.iter()).enumerate() {
            let expected = to_f32(*want);
            assert!(
                (got - expected).abs() < 1e-4,
                "sample {index} drifted: got {got}, expected {expected}"
            );
        }
    }

    #[test]
    fn seek_moves_position_and_continues_decoding() {
        let mut src = source_from_bytes(wav_bytes(1.0), "test.wav").unwrap();
        let tracker = src.position_tracker();

        src.seek_by_time(0.5).unwrap();
        assert!(
            (0.45..=0.55).contains(&tracker.position_secs()),
            "tracker after seek {}",
            tracker.position_secs()
        );

        let count = src.by_ref().count();
        // Accurate seek lands within ~one frame of the target; roughly half a
        // second (±1%) remains.
        assert!(
            (43_650..=44_550).contains(&count),
            "unexpected remaining samples {count}"
        );
    }

    #[test]
    fn seek_past_end_does_not_panic() {
        let mut src = source_from_bytes(wav_bytes(0.02), "test.wav").unwrap();
        // Whatever the outcome, it must not panic and must leave a usable state.
        let _ = src.seek_by_time(120.0);
        let _ = src.by_ref().take(64).count();
    }

    #[test]
    fn garbage_input_reports_decode_error() {
        let err = source_from_bytes(vec![0u8; 32], "junk.bin").unwrap_err();
        match err {
            SourceError::Decode(file, _) => assert_eq!(file, "junk.bin"),
            other => panic!("expected Decode error, got {other:?}"),
        }
    }
}
