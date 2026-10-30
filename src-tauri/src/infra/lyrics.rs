//! Lyric file association + loading.
//!
//! Convention: a track's lyrics live next to the audio file with the same
//! stem and an `.lrc` extension (`will_do.mp3` ↔ `will_do.lrc`), matched
//! case-insensitively so `WILL_DO.LRC` works too. Everything here is
//! best-effort: any problem (no match, unreadable file, odd encoding)
//! degrades to `None` — lyrics must never break playback or the library.
//!
//! Encoding: LRC files predate UTF-8's dominance and CJK taggers frequently
//! wrote GBK/Big5/Shift-JIS. UTF-8 (with or without BOM) is tried strictly
//! first, then the same CJK candidate order as `domain::encoding`, with a
//! lossy UTF-8 fallback so garbage bytes still render *something*.

use std::fs;
use std::path::{Path, PathBuf};

use encoding_rs::{BIG5, EUC_KR, GB18030, SHIFT_JIS};

/// A lyric file located for an audio file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedLyricFile {
    /// The matched `.lrc` path (surfaced to the UI as the association proof).
    pub path: PathBuf,
    /// Decoded file content (BOM stripped).
    pub text: String,
}

/// Abstraction over lyric storage so the service can be unit-tested.
pub trait LyricSource: Send + Sync {
    /// Finds and reads the lyrics for `audio_path`, or `None` when the track
    /// has no associated lyric file.
    fn load(&self, audio_path: &Path) -> Option<LoadedLyricFile>;
}

/// Production source: sibling `.lrc` files on the local filesystem.
pub struct FsLyricSource;

impl LyricSource for FsLyricSource {
    fn load(&self, audio_path: &Path) -> Option<LoadedLyricFile> {
        let path = find_lrc_path(audio_path)?;
        let bytes = fs::read(&path).ok()?;
        Some(LoadedLyricFile {
            path,
            text: decode_lrc(&bytes),
        })
    }
}

/// Picks `<same-dir>/<same-stem>.lrc`, ignoring case in stem and extension.
/// Deterministic: when several files tie (e.g. `Song.lrc` and `song.LRC`,
/// possible on case-sensitive filesystems) the lexicographically first wins.
pub fn find_lrc_path(audio_path: &Path) -> Option<PathBuf> {
    let stem = audio_path.file_stem()?.to_string_lossy().to_lowercase();
    let dir = audio_path.parent()?;

    let mut matches: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path.extension().is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("lrc"))
                && path.file_stem().is_some_and(|s| {
                    s.to_string_lossy().to_lowercase() == stem
                })
        })
        .collect();
    // read_dir order is filesystem-dependent; sort keeps repeats stable.
    matches.sort();
    matches.into_iter().next()
}

/// Decodes lyric bytes: strict UTF-8 first (BOM allowed), then the CJK
/// candidate encodings, finally lossy UTF-8 so garbage still renders text.
fn decode_lrc(bytes: &[u8]) -> String {
    // Strip a UTF-8 BOM so it never leaks into the first lyric line.
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(bytes);

    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    // GB18030 first: it is the GBK superset and the most common case by far.
    for encoding in [&GB18030, &BIG5, &SHIFT_JIS, &EUC_KR] {
        let (decoded, _, had_errors) = encoding.decode(bytes);
        if !had_errors {
            return decoded.into_owned();
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::GB18030;
    use std::fs;
    use tempfile::TempDir;

    fn dir_with_files(files: &[(&str, &[u8])]) -> TempDir {
        let dir = TempDir::new().unwrap();
        for (name, contents) in files {
            fs::write(dir.path().join(name), contents).unwrap();
        }
        dir
    }

    #[test]
    fn finds_sibling_lrc_and_strips_bom() {
        let dir = dir_with_files(&[
            ("will_do.mp3", b"audio"),
            ("will_do.lrc", b"\xEF\xBB\xBF[00:01.00]\xE6\x99\xB4\xE5\xA4\xA9"),
        ]);
        let loaded = FsLyricSource
            .load(&dir.path().join("will_do.mp3"))
            .expect("sibling lrc is found");
        assert_eq!(loaded.path, dir.path().join("will_do.lrc"));
        // BOM stripped → the text parses as a normal tagged line.
        assert_eq!(loaded.text, "[00:01.00]晴天");
    }

    #[test]
    fn stem_and_extension_match_case_insensitively() {
        let dir = dir_with_files(&[
            ("Will Do.mp3", b"audio"),
            ("WILL DO.LRC", b"[00:01.00]hi"),
        ]);
        let loaded = FsLyricSource.load(&dir.path().join("Will Do.mp3"));
        assert_eq!(
            loaded.map(|l| l.path),
            Some(dir.path().join("WILL DO.LRC"))
        );
    }

    #[test]
    fn other_names_and_other_extensions_are_ignored() {
        let dir = dir_with_files(&[
            ("a.mp3", b"audio"),
            ("a.txt", b"[00:01.00]nope"),
            ("b.lrc", b"[00:01.00]nope"),
        ]);
        assert_eq!(FsLyricSource.load(&dir.path().join("a.mp3")), None);
    }

    #[test]
    fn missing_audio_stem_yields_none() {
        let dir = dir_with_files(&[]);
        assert_eq!(FsLyricSource.load(&dir.path().join("ghost.mp3")), None);
    }

    #[test]
    fn gbk_encoded_lyrics_are_decoded() {
        let (gbk_bytes, _, _) = GB18030.encode("[00:01.00]晴天 - live");
        let dir = dir_with_files(&[("song.flac", b"audio"), ("song.lrc", &gbk_bytes)]);
        let loaded = FsLyricSource.load(&dir.path().join("song.flac")).unwrap();
        assert_eq!(loaded.text, "[00:01.00]晴天 - live");
    }

    #[test]
    fn undecodable_bytes_fall_back_to_lossy_utf8() {
        // 0xFF is invalid in UTF-8 and in every candidate encoding's ASCII
        // range: the lossy fallback replaces it but keeps the rest.
        let dir = dir_with_files(&[("s.mp3", b"x"), ("s.lrc", b"\xFF[00:01.00]ok")]);
        let loaded = FsLyricSource.load(&dir.path().join("s.mp3")).unwrap();
        assert!(loaded.text.ends_with("[00:01.00]ok"), "{:?}", loaded.text);
        assert!(loaded.text.contains('\u{FFFD}'));
    }

    #[test]
    fn find_lrc_path_is_deterministic_among_case_variants() {
        let dir = dir_with_files(&[
            ("t.ogg", b"audio"),
            ("T.Lrc", b"1"),
            ("t.lrc", b"2"),
        ]);
        // Both variants match on a case-insensitive stem; the pick must be
        // stable across calls (sorted, not read_dir order).
        let audio = dir.path().join("t.ogg");
        let first = find_lrc_path(&audio).expect("a variant matches");
        assert!(
            first.ends_with("T.Lrc") || first.ends_with("t.lrc"),
            "unexpected pick: {first:?}"
        );
        assert_eq!(find_lrc_path(&audio), Some(first));
    }
}
