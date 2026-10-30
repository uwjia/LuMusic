//! Smoke test against the real-world sample that motivated the lyrics
//! feature: `C:\Data\Music\吸血鬼日记\will_do.{mp3,lrc}`. Skips silently when
//! the folder is absent (CI machines), so it pins behavior locally without
//! making the user's Music directory a hard dependency.

use lumusic_lib::domain::lyrics::parse_lrc;
use lumusic_lib::infra::lyrics::{FsLyricSource, LyricSource};
use std::path::Path;

const SAMPLE_AUDIO: &str = r"C:\Data\Music\吸血鬼日记\will_do.mp3";

#[test]
fn will_do_sample_associates_and_parses() {
    let audio = Path::new(SAMPLE_AUDIO);
    if !audio.exists() {
        eprintln!("sample '{SAMPLE_AUDIO}' not present; skipping");
        return;
    }

    // Association: the sibling .lrc is found and decoded (UTF-8 + BOM).
    let loaded = FsLyricSource.load(audio).expect("will_do.lrc sits next to will_do.mp3");
    assert!(loaded.path.ends_with("will_do.lrc"), "{:?}", loaded.path);
    assert!(!loaded.text.starts_with('\u{FEFF}'));

    // Parsing: metadata ignored, offset applied, chorus repeats expanded,
    // interludes kept, output time-sorted.
    let lyrics = parse_lrc(&loaded.text);
    assert_eq!(lyrics.offset_ms, 500);
    assert!(lyrics.lines.iter().any(|l| l.text == "I will do do do do do"));
    let repeats = lyrics
        .lines
        .iter()
        .filter(|l| l.text == "Yes I will do do do do do")
        .count();
    assert_eq!(repeats, 3, "the 3-timestamp chorus line expands to 3 entries");
    assert!(lyrics.lines.iter().any(|l| l.text.is_empty()), "interlude markers kept");
    assert!(lyrics.lines.windows(2).all(|w| w[0].time_ms <= w[1].time_ms));
}
