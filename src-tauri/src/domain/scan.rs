//! Scan planning rules: which files count as audio, and what a scan produced.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::track::TrackId;

/// File extensions the audio stack can decode (keep in sync with symphonia
/// features enabled in Cargo.toml).
pub const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "oga"];

/// Returns true when the extension is a supported audio format
/// (case-insensitive).
pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| {
            SUPPORTED_EXTENSIONS
                .contains(&ext.to_string_lossy().to_lowercase().as_str())
        })
        .unwrap_or(false)
}

/// Collects the (lowercased) extension of a path for reporting.
pub fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Outcome of one library scan, surfaced to the UI after `library://updated`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub root: String,
    pub files_seen: usize,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub skipped: usize,
    pub warnings: Vec<String>,
}

/// Converts scanned ids into the retain-set used to prune stale tracks.
pub fn to_retain_set(ids: impl IntoIterator<Item = TrackId>) -> HashSet<TrackId> {
    ids.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_audio_file_matches_supported_extensions_case_insensitively() {
        for name in ["a.mp3", "b.Flac", "C.WAV", "d.ogg", "e.oga"] {
            assert!(is_audio_file(Path::new(name)), "{name} should match");
        }
    }

    #[test]
    fn is_audio_file_rejects_unsupported_or_missing_extensions() {
        for name in ["a.txt", "b.m4a", "c.opus", "noext", "a.mp3.bak"] {
            assert!(!is_audio_file(Path::new(name)), "{name} should not match");
        }
    }

    #[test]
    fn extension_of_lowercases_and_defaults_to_empty() {
        assert_eq!(extension_of(Path::new("X.MP3")), "mp3");
        assert_eq!(extension_of(Path::new("noext")), "");
    }

    #[test]
    fn to_retain_set_deduplicates_ids() {
        let set = to_retain_set(["a".to_string(), "a".to_string(), "b".to_string()]);
        assert_eq!(set.len(), 2);
    }
}
