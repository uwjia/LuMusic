//! `rodio::Source` adapter around a symphonia `FormatReader`.
//!
//! Why a custom adapter instead of `rodio::Decoder`:
//! - accurate seeking to a wall-clock position via `FormatReader::seek`;
//! - a shared position tracker the engine can poll without touching the
//!   audio callback thread.

use std::io::{Cursor, Read, Seek};
use std::sync::atomic::{AtomicU64, Ordering};
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
#[derive(Debug)]
pub struct PosTracker {
    samples: AtomicU64,
    sample_rate: u32,
    channels: u32,
}

impl PosTracker {
    /// Current playback position in seconds.
    pub fn position_secs(&self) -> f64 {
        if self.sample_rate == 0 || self.channels == 0 {
            return 0.0;
        }
        let frames = self.samples.load(Ordering::Relaxed) / self.channels as u64;
        frames as f64 / self.sample_rate as f64
    }

    fn set_position_secs(&self, secs: f64) {
        let frames = (secs.max(0.0) * self.sample_rate as f64).round() as u64;
        self.samples
            .store(frames * self.channels as u64, Ordering::Relaxed);
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
        let mut format = probed.format;

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

        // Capacity per packet; generous default covers all bundled codecs.
        let max_frames = track
            .codec_params
            .max_frames_per_packet
            .unwrap_or(16_384)
            .max(16_384);
        let sample_buf = SampleBuffer::<f32>::new(max_frames, spec);

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
            tracker: Arc::new(PosTracker {
                samples: AtomicU64::new(0),
                sample_rate,
                channels: channel_count as u32,
            }),
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
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(_) => {
                    // End of stream or unrecoverable reader error: stop.
                    self.finished = true;
                    return None;
                }
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    self.sample_buf.copy_interleaved_ref(decoded);
                    self.buf = self.sample_buf.samples().to_vec();
                    self.buf_pos = 0;
                }
                Err(SymphoniaError::DecodeError(_)) => continue, // skip corrupt packet
                Err(_) => {
                    self.finished = true;
                    return None;
                }
            }
        }
    }
}

impl rodio::Source for SymphoniaSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some((self.buf.len() - self.buf_pos) / self.channels.max(1) as usize)
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

    /// Writes a stereo 16-bit sine WAV of `seconds` length into memory.
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
