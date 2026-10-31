//! Persistence: JSON files under the app data directory.
//!
//! Writes are atomic (tmp file + rename) so a crash never corrupts state.

use std::fs;
use std::path::PathBuf;

use crate::domain::library::LibraryIndex;
use crate::domain::playlist::PlaylistCollection;
use crate::domain::session::PlaybackSession;
use crate::domain::settings::Settings;
use crate::domain::window::WindowGeometry;

/// Errors produced by the persistence layer.
#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("corrupt data file '{path}': {source}")]
    Corrupt {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
}

/// Abstraction over persistence so services can be unit-tested.
pub trait Persistence: Send + Sync {
    /// Loads the cached library; `Ok(None)` when no cache exists yet.
    fn load_library(&self) -> Result<Option<LibraryIndex>, PersistenceError>;
    fn save_library(&self, library: &LibraryIndex) -> Result<(), PersistenceError>;
    fn load_playlists(&self) -> Result<PlaylistCollection, PersistenceError>;
    fn save_playlists(&self, playlists: &PlaylistCollection) -> Result<(), PersistenceError>;
    fn load_settings(&self) -> Result<Settings, PersistenceError>;
    fn save_settings(&self, settings: &Settings) -> Result<(), PersistenceError>;
    /// Last window geometry; `Ok(None)` on a first launch.
    fn load_window(&self) -> Result<Option<WindowGeometry>, PersistenceError>;
    fn save_window(&self, geometry: &WindowGeometry) -> Result<(), PersistenceError>;
    fn load_playback(&self) -> Result<Option<PlaybackSession>, PersistenceError>;
    fn save_playback(&self, session: &PlaybackSession) -> Result<(), PersistenceError>;
    /// Removes the persisted session; used when playback ends for good so
    /// the next launch does not resurrect a finished session.
    fn clear_playback(&self) -> Result<(), PersistenceError>;
}

/// JSON-file backed store inside a single directory.
pub struct JsonPersistence {
    dir: PathBuf,
}

impl JsonPersistence {
    /// Creates the store; the directory is created lazily on first write.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path_for(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    fn read_json<T: serde::de::DeserializeOwned>(&self, name: &str) -> Result<Option<T>, PersistenceError> {
        let path = self.path_for(name);
        match fs::read(&path) {
            Ok(bytes) => {
                let value = serde_json::from_slice(&bytes).map_err(|source| PersistenceError::Corrupt {
                    path,
                    source,
                })?;
                Ok(Some(value))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn write_json<T: serde::Serialize>(&self, name: &str, value: &T) -> Result<(), PersistenceError> {
        fs::create_dir_all(&self.dir)?;
        let path = self.path_for(name);
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(value)?;
        fs::write(&tmp, bytes)?;
        // Atomic on POSIX; best-effort replace on Windows.
        fs::rename(&tmp, &path)?;
        Ok(())
    }
}

impl Persistence for JsonPersistence {
    fn load_library(&self) -> Result<Option<LibraryIndex>, PersistenceError> {
        self.read_json("library.json")
    }

    fn save_library(&self, library: &LibraryIndex) -> Result<(), PersistenceError> {
        self.write_json("library.json", library)
    }

    fn load_playlists(&self) -> Result<PlaylistCollection, PersistenceError> {
        Ok(self.read_json::<PlaylistCollection>("playlists.json")?.unwrap_or_default())
    }

    fn save_playlists(&self, playlists: &PlaylistCollection) -> Result<(), PersistenceError> {
        self.write_json("playlists.json", playlists)
    }

    fn load_settings(&self) -> Result<Settings, PersistenceError> {
        Ok(self.read_json::<Settings>("settings.json")?.unwrap_or_default())
    }

    fn save_settings(&self, settings: &Settings) -> Result<(), PersistenceError> {
        self.write_json("settings.json", settings)
    }

    fn load_window(&self) -> Result<Option<WindowGeometry>, PersistenceError> {
        self.read_json("window.json")
    }

    fn save_window(&self, geometry: &WindowGeometry) -> Result<(), PersistenceError> {
        self.write_json("window.json", geometry)
    }

    fn load_playback(&self) -> Result<Option<PlaybackSession>, PersistenceError> {
        self.read_json("playback.json")
    }

    fn save_playback(&self, session: &PlaybackSession) -> Result<(), PersistenceError> {
        self.write_json("playback.json", session)
    }

    fn clear_playback(&self) -> Result<(), PersistenceError> {
        match fs::remove_file(self.path_for("playback.json")) {
            Ok(()) => Ok(()),
            // Clearing an absent session is already the desired end state.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::track::Track;
    use std::path::Path;

    fn library_with_two_tracks() -> LibraryIndex {
        let mut lib = LibraryIndex::new();
        lib.upsert(Track::from_stem(Path::new("C:/a/one.mp3"), 10));
        lib.upsert(Track::from_stem(Path::new("C:/a/two.flac"), 20));
        lib
    }

    #[test]
    fn round_trips_library_playlists_and_settings() {
        let dir = tempfile::TempDir::new().unwrap();
        let store = JsonPersistence::new(dir.path());

        // Missing files degrade to defaults, not errors.
        assert_eq!(store.load_library().unwrap(), None);
        assert_eq!(store.load_playlists().unwrap(), PlaylistCollection::new());
        assert_eq!(store.load_settings().unwrap(), Settings::default());

        let lib = library_with_two_tracks();
        store.save_library(&lib).unwrap();
        assert_eq!(store.load_library().unwrap().as_ref(), Some(&lib));
        assert_eq!(store.load_library().unwrap().unwrap().len(), 2);

        let mut playlists = PlaylistCollection::new();
        playlists.create("Chill", "p1".into(), 7).unwrap();
        playlists.add_track("p1", "C:/a/one.mp3".into()).unwrap();
        store.save_playlists(&playlists).unwrap();
        assert_eq!(store.load_playlists().unwrap(), playlists);

        let settings = Settings {
            volume: 0.25,
            last_folder: Some("C:/music".into()),
            close_to_tray: false,
            ..Settings::default()
        };
        store.save_settings(&settings).unwrap();
        assert_eq!(store.load_settings().unwrap(), settings);

        // Window geometry: absent until the first save, then round-trips.
        assert_eq!(store.load_window().unwrap(), None);
        let geometry = crate::domain::window::WindowGeometry {
            x: -1920,
            y: 40,
            width: 960,
            height: 600,
            maximized: true,
        };
        store.save_window(&geometry).unwrap();
        assert_eq!(store.load_window().unwrap(), Some(geometry));
        // Settings and window writes are separate files: saving one must
        // not clobber the other.
        assert_eq!(store.load_settings().unwrap(), settings);

        assert_eq!(store.load_playback().unwrap(), None);
        let session = PlaybackSession {
            queue: vec!["C:/a/one.mp3".into()],
            current_index: 0,
            position_secs: 42.5,
            shuffle: true,
            repeat: crate::domain::queue::RepeatMode::All,
        };
        store.save_playback(&session).unwrap();
        assert_eq!(store.load_playback().unwrap(), Some(session));

        store.clear_playback().unwrap();
        assert_eq!(store.load_playback().unwrap(), None);
        // Clearing twice stays a no-op (file already absent).
        store.clear_playback().unwrap();
    }

    #[test]
    fn corrupt_playback_file_reports_error_with_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let store = JsonPersistence::new(dir.path());
        std::fs::write(dir.path().join("playback.json"), b"{ nope").unwrap();
        match store.load_playback().unwrap_err() {
            PersistenceError::Corrupt { path, .. } => assert!(path.ends_with("playback.json")),
            other => panic!("expected Corrupt, got {other:?}"),
        }
    }

    #[test]
    fn corrupt_file_reports_error_with_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let store = JsonPersistence::new(dir.path());
        std::fs::write(dir.path().join("settings.json"), b"{ not json").unwrap();
        let err = store.load_settings().unwrap_err();
        match err {
            PersistenceError::Corrupt { path, .. } => {
                assert!(path.ends_with("settings.json"));
            }
            other => panic!("expected Corrupt, got {other:?}"),
        }
    }

    #[test]
    fn save_settings_creates_missing_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        let nested = dir.path().join("a").join("b");
        let store = JsonPersistence::new(&nested);
        store.save_settings(&Settings::default()).unwrap();
        assert!(nested.join("settings.json").exists());
    }
}
