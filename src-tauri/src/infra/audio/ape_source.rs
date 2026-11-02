//! Monkey's Audio (`.ape`) decode adapter around the `ape-decoder` crate.
//!
//! symphonia has no APE codec (its `ape` feature is tag metadata only,
//! even in 0.6), so `.ape` takes a parallel source next to
//! `SymphoniaSource`. The two share the engine contract — f32 interleaved
//! samples, a shared [`PosTracker`], time-based seeking — and the engine
//! dispatches per file extension (see `engine::DecodedSource`).
//!
//! Testing seam: the crate is decode-only, so unlike WAVs (hound) no
//! fixture can be generated in-process. Everything the adapter consumes
//! of the decoder lives behind [`ApeStream`]; tests feed synthetic PCM
//! frames through a fake while decode correctness itself is covered
//! upstream (byte-exact against the C++ reference, fuzzed).

use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, SyncSender, TryRecvError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ape_decoder::ApeDecoder;
use rodio::Source;

use super::engine::AudioError;
use super::symphonia_source::PosTracker;

/// The decoder surface the source adapter consumes. Implemented by
/// [`ApeDecoderStream`] in production and by fakes in tests.
pub trait ApeStream: Send {
    fn sample_rate(&self) -> u32;
    fn channels(&self) -> u16;
    /// Per-channel byte width (1/2/3/4).
    fn bytes_per_sample(&self) -> u16;
    /// Total sample-frames ("blocks" in APE terms) in the file.
    fn total_blocks(&self) -> u64;
    /// APE can wrap AIFF-sourced data; honored when reassembling samples.
    fn is_big_endian(&self) -> bool {
        false
    }
    /// 8-bit APE exists in signed and unsigned flavors.
    fn is_signed_8bit(&self) -> bool {
        false
    }
    /// 32-bit float APE (rare) passes through as native f32.
    fn is_floating_point(&self) -> bool {
        false
    }
    /// Decodes the next frame in order as raw interleaved PCM bytes;
    /// `None` marks the end of the stream.
    fn next_frame_pcm(&mut self) -> Option<Result<Vec<u8>, String>>;
    /// Positions the stream so the next `next_frame_pcm` yields the frame
    /// holding `block`; returns how many blocks of that frame to skip to
    /// land exactly on the target.
    fn seek_block(&mut self, block: u64) -> Result<u32, String>;
}

/// Production [`ApeStream`] over an opened file.
///
/// **Decoding runs on its own thread, not the audio callback.** An APE
/// frame holds up to ~73728 blocks (~1.7 s of audio) and the entropy
/// decode of one frame costs tens of milliseconds — spent on the callback
/// thread that is an instant underrun (audible as crackle and hiccups;
/// symphonia formats decode in small packets and get away with it). The
/// worker prefetches [`PREFETCH_FRAMES`] decoded frames into a bounded
/// channel, so the audio thread only ever does a cheap `try`-style recv,
/// and the bound throttles decoding to just-ahead-of-playback.
///
/// Seeks race the prefetch: the consumer bumps a generation counter, the
/// worker tags every frame it decodes, and stale frames are dropped on
/// arrival. `ApeDecoder::seek` is a pure calculation, so the consumer can
/// also compute the intra-frame skip locally without touching the worker's
/// decoder (see [`locate_block`]).
pub struct ApeDecoderStream {
    /// Header snapshot: the info accessors must never touch the decoder
    /// (the worker owns it exclusively).
    info: StreamInfo,
    cmd_tx: Sender<WorkerCmd>,
    frames_rx: Receiver<DecodedFrame>,
    /// Raised on every seek; frames carrying an older value are stale.
    generation: u64,
    /// Kept to name the thread in panic messages; detached on drop.
    _worker: JoinHandle<()>,
}

/// Immutable header facts the stream answers from memory.
struct StreamInfo {
    sample_rate: u32,
    channels: u16,
    bytes_per_sample: u16,
    total_blocks: u64,
    total_frames: u32,
    blocks_per_frame: u64,
    big_endian: bool,
    signed_8bit: bool,
    floating_point: bool,
}

enum WorkerCmd {
    /// Jump to the frame holding `block`; tag everything decoded
    /// afterwards with `generation`.
    Seek { block: u64, generation: u64 },
    Stop,
}

struct DecodedFrame {
    generation: u64,
    pcm: Result<Vec<u8>, String>,
}

/// How many decoded frames may sit in the channel. Four frames cover
/// several seconds of audio at the common frame size — ample cushion for
/// decode-time spikes while capping buffered PCM to a few MB.
const PREFETCH_FRAMES: usize = 4;

/// Upper bound the audio thread ever blocks waiting for a frame. Reached
/// only at track start / after a seek (one frame of decode latency) or
/// when decoding is slower than realtime; then the track ends gracefully
/// like a truncated file instead of hard-locking the callback.
const FRAME_WAIT: Duration = Duration::from_secs(2);

/// Pure seek math mirroring `ApeDecoder::seek` (which is itself a pure
/// calculation): clamps the block and splits it into a frame index plus
/// the blocks to skip inside that frame.
fn locate_block(
    block: u64,
    total_blocks: u64,
    blocks_per_frame: u64,
    total_frames: u32,
) -> (u32, u32) {
    if total_blocks == 0 || blocks_per_frame == 0 || total_frames == 0 {
        return (0, 0);
    }
    let clamped = block.min(total_blocks - 1);
    let frame = ((clamped / blocks_per_frame) as u32).min(total_frames - 1);
    let frame_start = frame as u64 * blocks_per_frame;
    (frame, (clamped - frame_start) as u32)
}

impl ApeDecoderStream {
    pub fn open(path: &Path) -> Result<Self, AudioError> {
        let file =
            File::open(path).map_err(|_| AudioError::OpenFile(path.display().to_string()))?;
        let decoder = ApeDecoder::new(BufReader::new(file)).map_err(|err| {
            AudioError::Decode(path.display().to_string(), err.to_string())
        })?;
        let ape_info = decoder.info().clone();
        let info = StreamInfo {
            sample_rate: ape_info.sample_rate,
            channels: ape_info.channels,
            bytes_per_sample: ape_info.bytes_per_sample,
            total_blocks: ape_info.total_samples,
            total_frames: decoder.total_frames(),
            blocks_per_frame: ape_info.blocks_per_frame as u64,
            big_endian: ape_info.is_big_endian,
            signed_8bit: ape_info.is_signed_8bit,
            floating_point: ape_info.is_floating_point,
        };

        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<WorkerCmd>();
        let (frame_tx, frames_rx) =
            std::sync::mpsc::sync_channel::<DecodedFrame>(PREFETCH_FRAMES);
        let worker = std::thread::Builder::new()
            .name("lumusic-ape-decode".into())
            .spawn(move || decode_worker(decoder, cmd_rx, frame_tx))
            .map_err(|_| AudioError::NoDevice)?;
        Ok(Self {
            info,
            cmd_tx,
            frames_rx,
            generation: 0,
            _worker: worker,
        })
    }
}

/// Prefetch loop owning the decoder. Between frames it drains commands;
/// the bounded channel blocks here (never on the audio thread) once the
/// prefetch buffer is full — that is the throttle.
fn decode_worker(
    mut decoder: ApeDecoder<BufReader<File>>,
    cmd_rx: Receiver<WorkerCmd>,
    frame_tx: SyncSender<DecodedFrame>,
) {
    let total_frames = decoder.total_frames();
    let mut cursor: u32 = 0;
    let mut generation: u64 = 0;
    loop {
        // Serve the newest seek, then (re)start prefetching from it.
        match drain_commands(&cmd_rx, &mut cursor, &mut generation, &mut decoder, &frame_tx) {
            Flow::Stop => return,
            Flow::Continue => {}
        }
        if cursor >= total_frames {
            // Everything decoded: idle until a seek or shutdown. The
            // timeout only re-checks for a disconnected producer.
            match cmd_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(WorkerCmd::Seek { block, generation: gen }) => {
                    match decoder.seek(block) {
                        Ok(pos) => {
                            cursor = pos.frame_index;
                            generation = gen;
                        }
                        Err(err) => {
                            let _ = frame_tx.send(DecodedFrame {
                                generation: gen,
                                pcm: Err(err.to_string()),
                            });
                            return;
                        }
                    }
                }
                Ok(WorkerCmd::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => continue,
            }
        }
        let index = cursor;
        cursor += 1;
        let started = Instant::now();
        let pcm = decoder.decode_frame(index).map_err(|err| err.to_string());
        if started.elapsed() > Duration::from_millis(250) {
            // Slow-machine diagnostics: near-realtime decoding means the
            // prefetch cushion shrinks and playback may stutter.
            tracing::debug!(
                "ape frame {index} took {:#?} to decode (near-realtime risk)",
                started.elapsed()
            );
        }
        match pcm {
            Ok(bytes) => {
                if frame_tx
                    .send(DecodedFrame { generation, pcm: Ok(bytes) })
                    .is_err()
                {
                    return; // consumer dropped: stream closed
                }
            }
            Err(err) => {
                // Decode failures are terminal (no resync point); report
                // and stop prefetching.
                let _ = frame_tx.send(DecodedFrame {
                    generation,
                    pcm: Err(err),
                });
                return;
            }
        }
    }
}

enum Flow {
    Stop,
    Continue,
}

/// Applies every pending command; the last seek wins. A seek whose
/// calculation fails (theoretically unreachable — `seek` is pure math)
/// surfaces as a terminal error frame under the *new* generation so the
/// consumer stops cleanly instead of waiting it out.
fn drain_commands(
    cmd_rx: &Receiver<WorkerCmd>,
    cursor: &mut u32,
    generation: &mut u64,
    decoder: &mut ApeDecoder<BufReader<File>>,
    frame_tx: &SyncSender<DecodedFrame>,
) -> Flow {
    loop {
        match cmd_rx.try_recv() {
            Ok(WorkerCmd::Seek { block, generation: gen }) => match decoder.seek(block) {
                Ok(pos) => {
                    *cursor = pos.frame_index;
                    *generation = gen;
                }
                Err(err) => {
                    let _ = frame_tx.send(DecodedFrame {
                        generation: gen,
                        pcm: Err(err.to_string()),
                    });
                    return Flow::Stop;
                }
            },
            Ok(WorkerCmd::Stop) => return Flow::Stop,
            Err(TryRecvError::Empty) => return Flow::Continue,
            Err(TryRecvError::Disconnected) => return Flow::Stop,
        }
    }
}

impl ApeStream for ApeDecoderStream {
    fn sample_rate(&self) -> u32 {
        self.info.sample_rate
    }

    fn channels(&self) -> u16 {
        self.info.channels
    }

    fn bytes_per_sample(&self) -> u16 {
        self.info.bytes_per_sample
    }

    fn total_blocks(&self) -> u64 {
        self.info.total_blocks
    }

    fn is_big_endian(&self) -> bool {
        self.info.big_endian
    }

    fn is_signed_8bit(&self) -> bool {
        self.info.signed_8bit
    }

    fn is_floating_point(&self) -> bool {
        self.info.floating_point
    }

    fn next_frame_pcm(&mut self) -> Option<Result<Vec<u8>, String>> {
        loop {
            match self.frames_rx.recv_timeout(FRAME_WAIT) {
                Ok(frame) if frame.generation == self.generation => return Some(frame.pcm),
                // Stale pre-seek frame: the seek invalidated it, drop and
                // keep draining. Draining is instant (frames are already
                // decoded); at most the first new frame costs one decode.
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => {
                    tracing::warn!("ape decode stalled for {FRAME_WAIT:?}; ending track");
                    return Some(Err("decode stalled".into()));
                }
                Err(RecvTimeoutError::Disconnected) => return None,
            }
        }
    }

    fn seek_block(&mut self, block: u64) -> Result<u32, String> {
        self.generation += 1;
        let (_frame, skip) = locate_block(
            block,
            self.info.total_blocks,
            self.info.blocks_per_frame,
            self.info.total_frames,
        );
        self.cmd_tx
            .send(WorkerCmd::Seek {
                block,
                generation: self.generation,
            })
            .map_err(|_| "decoder worker is gone".to_string())?;
        Ok(skip)
    }
}

impl Drop for ApeDecoderStream {
    fn drop(&mut self) {
        // Idle workers see this; a worker blocked on a full frame channel
        // is released by the field drops right after this body (dropping
        // the receiver disconnects its send).
        let _ = self.cmd_tx.send(WorkerCmd::Stop);
    }
}

/// rodio source over any [`ApeStream`], emitting interleaved f32 samples
/// at the file's native rate (the sink handles rate conversion).
pub struct ApeSource<S: ApeStream> {
    stream: S,
    /// Decoded PCM bytes of the current frame and a byte cursor into it.
    buf: Vec<u8>,
    pos: usize,
    bytes_per_sample: usize,
    /// Blocks (sample-frames) to drop from the next frame after a seek.
    pending_skip_blocks: u32,
    total_blocks: u64,
    tracker: Arc<PosTracker>,
    finished: bool,
}

impl<S: ApeStream> ApeSource<S> {
    pub fn new(stream: S) -> Self {
        let (sample_rate, channels) = (stream.sample_rate(), stream.channels());
        let bytes_per_sample = stream.bytes_per_sample().max(1) as usize;
        let total_blocks = stream.total_blocks();
        Self {
            stream,
            buf: Vec::new(),
            pos: 0,
            bytes_per_sample,
            pending_skip_blocks: 0,
            total_blocks,
            tracker: Arc::new(PosTracker::new(
                sample_rate,
                channels.max(1) as u32,
            )),
            finished: false,
        }
    }

    /// Handle used by the engine to poll the playback position.
    pub fn position_tracker(&self) -> Arc<PosTracker> {
        self.tracker.clone()
    }

    pub fn sample_rate(&self) -> u32 {
        self.stream.sample_rate()
    }

    /// Seeks to `secs` (sample-accurate: the decoder locates the frame,
    /// the adapter skips the remainder inside it). Requests beyond the
    /// end clamp onto the last block — the tracker must report the
    /// *landed* position, never the raw request.
    pub fn seek_by_time(&mut self, secs: f64) -> Result<(), AudioError> {
        let sample_rate = self.stream.sample_rate() as f64;
        let requested = (secs.max(0.0) * sample_rate).round() as u64;
        let block = requested.min(self.total_blocks.saturating_sub(1));
        let skip = self
            .stream
            .seek_block(block)
            .map_err(|err| AudioError::Decode(String::new(), err))?;
        self.buf.clear();
        self.pos = 0;
        self.finished = false;
        self.pending_skip_blocks = skip;
        // The decoder lands exactly on the clamped block (its seek
        // computes the intra-frame skip), so the tracker can adopt the
        // target immediately — callers read position_secs() the instant
        // this returns, like with SymphoniaSource.
        self.tracker
            .set_position_secs(block as f64 / sample_rate.max(1.0));
        Ok(())
    }

    /// Pulls the next frame into `buf`, applying any post-seek skip.
    /// A mid-stream decode error ends the stream (there is no resync
    /// point to continue from); the engine's end-of-source handling then
    /// advances the queue, same as a truncated file in any other format.
    fn pull_frame(&mut self) -> bool {
        let skip = std::mem::take(&mut self.pending_skip_blocks);
        match self.stream.next_frame_pcm() {
            Some(Ok(bytes)) => {
                self.buf = bytes;
                self.pos = 0;
                if skip > 0 {
                    let block_align = self.bytes_per_sample * self.stream.channels() as usize;
                    self.pos = ((skip as usize) * block_align).min(self.buf.len());
                }
                true
            }
            Some(Err(err)) => {
                tracing::warn!("ape decode stopped mid-stream: {err}");
                false
            }
            None => false,
        }
    }

    /// Converts one raw sample to f32 by depth/endianness/signedness.
    fn decode_sample(&self, raw: &[u8]) -> f32 {
        // Zero-extends the raw sample bytes into a u32 in their native
        // byte order: LE places them in the low bytes, BE keeps the
        // buffer high-aligned (raw already starts with the MSB).
        let read_u32 = |raw: &[u8], big_endian: bool| -> u32 {
            let mut bytes = [0u8; 4];
            if big_endian {
                bytes[4 - raw.len()..].copy_from_slice(raw);
                u32::from_be_bytes(bytes)
            } else {
                bytes[..raw.len()].copy_from_slice(raw);
                u32::from_le_bytes(bytes)
            }
        };
        let big_endian = self.stream.is_big_endian();
        match self.bytes_per_sample {
            // 8-bit: signed per header flag, otherwise WAV-style unsigned
            // (bias 128).
            1 => {
                let byte = raw[0];
                let value = if self.stream.is_signed_8bit() {
                    byte as i8 as f32
                } else {
                    byte.wrapping_sub(128) as i8 as f32
                };
                value / 128.0
            }
            2 => read_u32(raw, big_endian) as u16 as i16 as f32 / 32_768.0,
            3 => {
                let raw24 = read_u32(raw, big_endian);
                // Sign-extend from bit 23, then normalize by 2^23.
                let value = ((raw24 << 8) as i32) >> 8;
                value as f32 / 8_388_608.0
            }
            4 if self.stream.is_floating_point() => f32::from_bits(read_u32(raw, big_endian)),
            4 => read_u32(raw, big_endian) as i32 as f32 / 2_147_483_648.0,
            // Defensive: unknown widths decode as silence instead of
            // panicking on the audio thread.
            _ => 0.0,
        }
    }
}

impl<S: ApeStream> Iterator for ApeSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.finished {
            return None;
        }
        loop {
            if self.pos + self.bytes_per_sample <= self.buf.len() {
                let raw = &self.buf[self.pos..self.pos + self.bytes_per_sample];
                self.pos += self.bytes_per_sample;
                let sample = self.decode_sample(raw);
                self.tracker.samples.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                return Some(sample);
            }
            if !self.pull_frame() {
                self.finished = true;
                return None;
            }
        }
    }
}

impl<S: ApeStream> Source for ApeSource<S> {
    /// Remaining *samples* in the current frame (all channels included) —
    /// rodio's conversion pipeline consumes this as a `Take(n)` limit over
    /// `Iterator::next`, i.e. over samples; returning byte or frame counts
    /// truncates conversion chunks and crackles (see the matching note in
    /// `symphonia_source.rs`).
    fn current_frame_len(&self) -> Option<usize> {
        Some((self.buf.len() - self.pos) / self.bytes_per_sample)
    }

    fn channels(&self) -> u16 {
        self.stream.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.stream.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        let rate = self.stream.sample_rate();
        if rate == 0 {
            return None;
        }
        Some(Duration::from_secs_f64(self.total_blocks as f64 / rate as f64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;
    use std::sync::atomic::Ordering;

    /// Synthetic APE stream: serves configured PCM frames in order and
    /// locates seeks by blocks-per-frame like the real decoder does.
    struct FakeApe {
        sample_rate: u32,
        channels: u16,
        bytes_per_sample: u16,
        total_blocks: u64,
        blocks_per_frame: u64,
        frames: Vec<Vec<u8>>,
        next: usize,
        big_endian: bool,
        signed_8bit: bool,
        floating: bool,
        /// Frames that fail instead of decoding (by index).
        failing: std::collections::HashSet<usize>,
    }

    impl FakeApe {
        fn stereo_16bit() -> Self {
            // 2 frames x 4 blocks x 2 channels x 2 bytes.
            Self {
                sample_rate: 8_000,
                channels: 2,
                bytes_per_sample: 2,
                total_blocks: 8,
                blocks_per_frame: 4,
                frames: vec![
                    i16s_to_bytes(&[1000, -1000, 2000, -2000, 3000, -3000, 4000, -4000]),
                    i16s_to_bytes(&[-1, 1, -2, 2, -3, 3, -4, 4]),
                ],
                next: 0,
                big_endian: false,
                signed_8bit: false,
                floating: false,
                failing: Default::default(),
            }
        }
    }

    fn i16s_to_bytes(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    impl ApeStream for FakeApe {
        fn sample_rate(&self) -> u32 {
            self.sample_rate
        }
        fn channels(&self) -> u16 {
            self.channels
        }
        fn bytes_per_sample(&self) -> u16 {
            self.bytes_per_sample
        }
        fn total_blocks(&self) -> u64 {
            self.total_blocks
        }
        fn is_big_endian(&self) -> bool {
            self.big_endian
        }
        fn is_signed_8bit(&self) -> bool {
            self.signed_8bit
        }
        fn is_floating_point(&self) -> bool {
            self.floating
        }
        fn next_frame_pcm(&mut self) -> Option<Result<Vec<u8>, String>> {
            if self.next >= self.frames.len() {
                return None;
            }
            let index = self.next;
            self.next += 1;
            if self.failing.contains(&index) {
                return Some(Err("corrupt frame".into()));
            }
            Some(Ok(self.frames[index].clone()))
        }
        fn seek_block(&mut self, block: u64) -> Result<u32, String> {
            let clamped = block.min(self.total_blocks.saturating_sub(1));
            let frame = (clamped / self.blocks_per_frame) as usize;
            self.next = frame;
            Ok((clamped % self.blocks_per_frame) as u32)
        }
    }

    fn source(fake: FakeApe) -> ApeSource<FakeApe> {
        ApeSource::new(fake)
    }

    #[test]
    fn decodes_16bit_frames_to_interleaved_f32() {
        // Hand-checked: 1000/32768, -1000/32768, ...
        let mut src = source(FakeApe::stereo_16bit());
        let expected: Vec<f32> = [1000, -1000, 2000, -2000, 3000, -3000, 4000, -4000]
            .iter()
            .map(|s| *s as f32 / 32_768.0)
            .collect();
        let got: Vec<f32> = (&mut src).take(8).collect();
        assert_eq!(got, expected, "left/right order must be preserved");
    }

    #[test]
    fn tracks_position_in_seconds_across_channels() {
        let src = source(FakeApe::stereo_16bit());
        let tracker = src.position_tracker();
        let mut src = src;
        for _ in 0..8 {
            src.next();
        }
        // 8 interleaved samples = 4 blocks at 8 kHz.
        assert!((tracker.position_secs() - 4.0 / 8_000.0).abs() < 1e-9);
    }

    /// Same contract as the SymphoniaSource pin: rodio's pipeline uses
    /// this as a Take limit over *samples* — byte or frame counts here
    /// drop audio when the device rate differs from the file.
    #[test]
    fn current_frame_len_counts_samples_not_bytes_or_blocks() {
        let mut src = source(FakeApe::stereo_16bit());
        assert!(src.next().is_some()); // loads frame 0: 4 blocks x 2 ch = 8 samples
        let before = src.current_frame_len().unwrap();
        assert_eq!(before, 7, "8 samples minus the one consumed");
        // Byte counts would say 14, block counts would say 3.
        for _ in 0..3 {
            src.next();
        }
        assert_eq!(src.current_frame_len().unwrap(), before - 3);
    }

    #[test]
    fn total_duration_covers_all_blocks() {
        let src = source(FakeApe::stereo_16bit());
        assert_eq!(src.total_duration(), Some(Duration::from_millis(1)));
        // 8 blocks @ 8 kHz = 1 ms exactly.
        assert_eq!(src.sample_rate(), 8_000);
        assert_eq!(src.channels(), 2);
    }

    #[test]
    fn exhausted_and_failing_streams_stay_finished() {
        let mut src = source(FakeApe::stereo_16bit());
        assert_eq!(src.by_ref().count(), 16);
        assert_eq!(src.next(), None);
        assert_eq!(src.next(), None);

        // A corrupt frame ends playback instead of looping on the error.
        let mut fake = FakeApe::stereo_16bit();
        fake.failing.insert(0);
        let mut src = source(fake);
        assert_eq!(src.by_ref().count(), 0);
        assert_eq!(src.next(), None);
    }

    #[test]
    fn seek_lands_exactly_on_the_target_block() {
        let src = source(FakeApe::stereo_16bit());
        let tracker = src.position_tracker();
        let mut src = src;
        // Block 6 lives in frame 1 (blocks 4-7); skip 2 blocks of it.
        src.seek_by_time(6.0 / 8_000.0).unwrap();
        assert!((tracker.position_secs() - 6.0 / 8_000.0).abs() < 1e-9);
        // First samples are block 6's channels: -3, 3 (blocks 4-5 skipped
        // inside frame 1 = 8 of its 16 bytes).
        let got: Vec<f32> = (&mut src).take(2).collect();
        assert_eq!(got, vec![-3.0 / 32_768.0, 3.0 / 32_768.0]);
        // Position advanced by exactly the two played samples: seek set
        // the counter to block 6 (12 interleaved samples), take(2) played
        // block 6's both channels -> block 7. Skipped blocks 4-5 never
        // counted.
        assert!(
            (tracker.position_secs() - 7.0 / 8_000.0).abs() < 1e-9,
            "skipped blocks must not count as played"
        );

        // Seeks past the end clamp onto the last block instead of failing.
        src.seek_by_time(60.0).unwrap();
        assert!(
            (tracker.position_secs() - 7.0 / 8_000.0).abs() < 1e-9,
            "seek past end clamps to the last block"
        );
    }

    #[test]
    fn twentyfour_bit_samples_convert_signed() {
        // One 24-bit frame with LE bytes for +8388607, -8388608, 0.
        let mut fake = FakeApe::stereo_16bit();
        fake.bytes_per_sample = 3;
        fake.frames = vec![vec![0xFF, 0xFF, 0x7F, 0x00, 0x00, 0x80, 0, 0, 0, 0, 0, 0]];
        let mut src = source(fake);
        let got: Vec<f32> = (&mut src).take(3).collect();
        assert!((got[0] - 1.0).abs() < 1e-6, "max positive");
        assert!((got[1] + 1.0).abs() < 1e-6, "min negative");
        assert_eq!(got[2], 0.0);
    }

    #[test]
    fn big_endian_and_8bit_flavors_are_honored() {
        // BE 16-bit 1000 = 0x03E8.
        let mut fake = FakeApe::stereo_16bit();
        fake.big_endian = true;
        fake.frames = vec![vec![0x03, 0xE8, 0xFC, 0x18]];
        let mut src = source(fake);
        let got: Vec<f32> = (&mut src).take(2).collect();
        assert_eq!(got, vec![1000.0 / 32_768.0, -1000.0 / 32_768.0]);

        // Unsigned 8-bit (WAV style): 128 is silence, 255 is max.
        let mut fake = FakeApe::stereo_16bit();
        fake.bytes_per_sample = 1;
        fake.frames = vec![vec![128, 255, 0, 0]];
        let mut src = source(fake);
        let got: Vec<f32> = (&mut src).take(3).collect();
        assert_eq!(got, vec![0.0, 127.0 / 128.0, -1.0]);
    }

    #[test]
    fn float32_passes_through_as_native_f32() {
        let mut fake = FakeApe::stereo_16bit();
        fake.bytes_per_sample = 4;
        fake.floating = true;
        fake.frames = vec![0.5f32.to_le_bytes().to_vec()];
        let mut src = source(fake);
        assert_eq!(src.next(), Some(0.5));
    }

    #[test]
    fn opening_a_non_ape_file_reports_a_decode_error() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("garbage.ape");
        std::fs::write(&path, b"definitely not a monkey's audio file").unwrap();
        let err = match ApeDecoderStream::open(&path) {
            Err(err) => err,
            Ok(_) => panic!("garbage must not decode"),
        };
        match err {
            AudioError::Decode(file, _) => assert!(file.ends_with("garbage.ape")),
            other => panic!("expected Decode error, got {other:?}"),
        }
    }

    #[test]
    fn opening_a_missing_file_reports_open_file() {
        let err = match ApeDecoderStream::open(Path::new("Z:/nope/missing.ape")) {
            Err(err) => err,
            Ok(_) => panic!("a missing file must not open"),
        };
        assert!(matches!(err, AudioError::OpenFile(_)));
    }

    /// The consumer-side seek math must mirror `ApeDecoder::seek` exactly:
    /// the adapter skips `skip` blocks inside frame `frame`, so an
    /// off-by-one here lands playback one block early/late.
    #[test]
    fn locate_block_splits_a_target_into_frame_and_skip() {
        // 8 blocks of 4 per frame -> frames [0-3], [4-7].
        let split = |block: u64| locate_block(block, 8, 4, 2);
        assert_eq!(split(0), (0, 0));
        assert_eq!(split(3), (0, 3));
        assert_eq!(split(4), (1, 0)); // exact frame boundary
        assert_eq!(split(6), (1, 2));
        // Past the end clamps onto the last block.
        assert_eq!(split(9), (1, 3));
        assert_eq!(split(u64::MAX), (1, 3));
    }

    #[test]
    fn locate_block_degenerates_to_the_start_on_empty_streams() {
        assert_eq!(locate_block(10, 0, 4, 0), (0, 0));
        assert_eq!(locate_block(10, 8, 0, 2), (0, 0));
        assert_eq!(locate_block(10, 8, 4, 0), (0, 0));
    }

    #[test]
    fn locate_block_never_passes_the_last_frame_index() {
        // A header claiming fewer frames than the blocks imply
        // (inconsistent file): the frame index clamps into range while the
        // skip keeps the algebraic difference — exactly what the upstream
        // decoder returns; the adapter additionally byte-clamps the skip
        // inside the frame (pull_frame's min).
        assert_eq!(locate_block(9, 10, 4, 2), (1, 5));
        assert_eq!(locate_block(9, 100, 4, 3), (2, 1));
    }

    #[test]
    fn tracker_counts_samples_through_the_seam() {
        // PosTracker lives behind Arc in symphonia_source; the adapter must
        // feed it interleaved samples (not blocks), or positions run
        // channels-times too fast.
        let src = source(FakeApe::stereo_16bit());
        let tracker = src.position_tracker();
        let mut src = src;
        src.by_ref().take(16).count();
        assert_eq!(
            tracker.samples.load(Ordering::Relaxed),
            16,
            "16 interleaved samples counted"
        );
    }
}
