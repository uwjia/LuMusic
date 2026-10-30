//! Track model: the core entity of the library.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Stable identifier for a track. Locally we use the file path string because
/// it is unique per file and survives restarts without a database.
pub type TrackId = String;

/// A single audio file with its metadata resolved (from tags or the file name).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub id: TrackId,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    /// Duration in seconds when known from the container/tags.
    pub duration_secs: Option<f64>,
    /// Absolute path of the audio file on disk.
    pub file_path: PathBuf,
    pub size_bytes: u64,
}

impl Default for Track {
    fn default() -> Self {
        Self {
            id: TrackId::new(),
            title: String::new(),
            artist: None,
            album: None,
            album_artist: None,
            track_no: None,
            disc_no: None,
            year: None,
            genre: None,
            duration_secs: None,
            file_path: PathBuf::new(),
            size_bytes: 0,
        }
    }
}

impl Track {
    /// Builds the base track for a file. The title - our display label -
    /// is always derived from the file stem (file names are the most direct,
    /// user-controlled label).
    pub fn from_stem(path: &Path, size_bytes: u64) -> Self {
        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Unknown".to_string());
        Self {
            id: path.to_string_lossy().into_owned(),
            title,
            file_path: path.to_path_buf(),
            size_bytes,
            ..Self::default()
        }
    }

    /// Lowercased concatenation of all searchable fields (title/artist/album).
    pub fn searchable_text(&self) -> String {
        let mut text = String::with_capacity(self.title.len() + 64);
        text.push_str(&self.title);
        for field in [&self.artist, &self.album, &self.album_artist] {
            if let Some(value) = field {
                text.push(' ');
                text.push_str(value);
            }
        }
        text.to_lowercase()
    }

    /// Sort key for the requested field; `None` fields always sort last.
    pub fn sort_value(&self, field: SortField) -> Option<String> {
        match field {
            SortField::Title => Some(self.title.to_lowercase()),
            SortField::Artist => self.artist.as_ref().map(|a| a.to_lowercase()),
            SortField::Album => self.album.as_ref().map(|a| a.to_lowercase()),
        }
    }
}

/// Sortable track fields exposed to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortField {
    #[default]
    Title,
    Artist,
    Album,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Track {
        Track {
            id: "C:/music/foo.mp3".into(),
            title: "Foo".into(),
            artist: Some("Bar".into()),
            album: Some("Baz".into()),
            ..Track::from_stem(Path::new("C:/music/foo.mp3"), 10)
        }
    }

    #[test]
    fn from_stem_derives_title_from_file_name() {
        let track = Track::from_stem(Path::new("C:/music/My Song.flac"), 42);
        assert_eq!(track.title, "My Song");
        assert_eq!(track.id, "C:/music/My Song.flac");
        assert_eq!(track.size_bytes, 42);
        assert_eq!(track.duration_secs, None);
    }

    #[test]
    fn from_stem_handles_path_without_stem() {
        let track = Track::from_stem(Path::new("/"), 0);
        assert_eq!(track.title, "Unknown");
    }

    #[test]
    fn searchable_text_joins_fields_case_insensitively() {
        let track = sample();
        assert_eq!(track.searchable_text(), "foo bar baz");
    }

    #[test]
    fn sort_value_returns_none_for_missing_fields() {
        let mut track = sample();
        assert_eq!(track.sort_value(SortField::Artist), Some("bar".into()));
        track.artist = None;
        assert_eq!(track.sort_value(SortField::Artist), None);
        assert_eq!(track.sort_value(SortField::Title), Some("foo".into()));
    }
}
