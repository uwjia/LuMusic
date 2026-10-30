//! Filesystem scanning: walks a folder tree and collects audio candidates.

use std::path::{Path, PathBuf};

use crate::domain::scan::is_audio_file;

/// Result of a raw filesystem scan (no metadata read yet).
#[derive(Debug, Clone, Default)]
pub struct ScannedFiles {
    /// Audio file paths, sorted for deterministic scanning order.
    pub files: Vec<PathBuf>,
    /// Non-fatal problems (unreadable folders, ...), capped at 100 entries.
    pub warnings: Vec<String>,
}

const MAX_WARNINGS: usize = 100;

/// Abstraction over the filesystem so services can be unit-tested.
pub trait LibraryScanner: Send + Sync {
    fn scan(&self, root: &Path) -> ScannedFiles;
}

/// Production scanner based on `walkdir`.
pub struct WalkdirScanner;

impl LibraryScanner for WalkdirScanner {
    fn scan(&self, root: &Path) -> ScannedFiles {
        let mut out = ScannedFiles::default();
        for entry in walkdir::WalkDir::new(root).follow_links(false) {
            match entry {
                Ok(entry) => {
                    if entry.file_type().is_file() && is_audio_file(entry.path()) {
                        out.files.push(entry.path().to_path_buf());
                    }
                }
                Err(err) => {
                    if out.warnings.len() < MAX_WARNINGS {
                        out.warnings.push(format!("scan error: {err}"));
                    }
                }
            }
        }
        out.files.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn scan_collects_only_supported_audio_files_sorted() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("b.mp3"), b"x").unwrap();
        fs::write(root.join("a.flac"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        fs::write(root.join("cover.png"), b"x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub").join("c.WAV"), b"x").unwrap();
        // A directory that merely looks like an audio file must be skipped.
        fs::create_dir(root.join("fake.mp3")).unwrap();

        let result = WalkdirScanner.scan(root);
        let names: Vec<String> = result
            .files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.flac", "b.mp3", "c.WAV"]);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn scan_of_missing_root_reports_warning_not_panic() {
        let result = WalkdirScanner.scan(Path::new("Z:/definitely/not/here"));
        assert!(result.files.is_empty());
        assert_eq!(result.warnings.len(), 1);
    }
}
