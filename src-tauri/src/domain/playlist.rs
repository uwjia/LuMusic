//! User playlists: CRUD + ordering rules over track ids.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::track::TrackId;

/// Errors produced by playlist operations.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlaylistError {
    #[error("playlist name must not be empty")]
    EmptyName,
    #[error("a playlist named '{0}' already exists")]
    DuplicateName(String),
    #[error("playlist '{0}' was not found")]
    NotFound(String),
    #[error("track '{0}' is not in the playlist")]
    TrackNotFound(TrackId),
    #[error("position {0} is out of range")]
    PositionOutOfRange(usize),
}

/// A named, ordered list of track ids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub items: Vec<TrackId>,
    /// Unix timestamp (seconds) of creation.
    pub created_at: u64,
}

/// Collection of playlists ordered by name (BTreeMap keeps it sorted).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PlaylistCollection {
    playlists: BTreeMap<String, Playlist>,
}

impl PlaylistCollection {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.playlists.len()
    }

    pub fn is_empty(&self) -> bool {
        self.playlists.is_empty()
    }

    pub fn get(&self, id: &str) -> Option<&Playlist> {
        self.playlists.get(id)
    }

    pub fn list(&self) -> Vec<&Playlist> {
        self.playlists.values().collect()
    }

    /// Playlist names are unique case-insensitively.
    fn name_taken(&self, name: &str) -> bool {
        self.playlists
            .values()
            .any(|p| p.name.eq_ignore_ascii_case(name))
    }

    /// Creates a playlist with a unique name. Returns the new playlist.
    pub fn create(&mut self, name: &str, id: String, created_at: u64) -> Result<Playlist, PlaylistError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(PlaylistError::EmptyName);
        }
        if self.name_taken(name) {
            return Err(PlaylistError::DuplicateName(name.to_string()));
        }
        let playlist = Playlist {
            id,
            name: name.to_string(),
            items: Vec::new(),
            created_at,
        };
        self.playlists.insert(playlist.id.clone(), playlist.clone());
        Ok(playlist)
    }

    /// Renames a playlist; the new name must be unique and non-empty.
    pub fn rename(&mut self, id: &str, new_name: &str) -> Result<(), PlaylistError> {
        let new_name = new_name.trim();
        if new_name.is_empty() {
            return Err(PlaylistError::EmptyName);
        }
        let current_name = self
            .playlists
            .get(id)
            .map(|p| p.name.clone())
            .ok_or_else(|| PlaylistError::NotFound(id.to_string()))?;
        if self.name_taken(new_name) && current_name != new_name {
            return Err(PlaylistError::DuplicateName(new_name.to_string()));
        }
        let playlist = self.playlists.get_mut(id).expect("checked above");
        playlist.name = new_name.to_string();
        Ok(())
    }

    /// Deletes a playlist.
    pub fn delete(&mut self, id: &str) -> Result<(), PlaylistError> {
        self.playlists
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| PlaylistError::NotFound(id.to_string()))
    }

    /// Appends a track unless it is already in the playlist.
    /// Returns `true` when the track was added.
    pub fn add_track(&mut self, id: &str, track: TrackId) -> Result<bool, PlaylistError> {
        let playlist = self
            .playlists
            .get_mut(id)
            .ok_or_else(|| PlaylistError::NotFound(id.to_string()))?;
        if playlist.items.contains(&track) {
            return Ok(false);
        }
        playlist.items.push(track);
        Ok(true)
    }

    /// Removes the first occurrence of a track.
    pub fn remove_track(&mut self, id: &str, track: &str) -> Result<(), PlaylistError> {
        let playlist = self
            .playlists
            .get_mut(id)
            .ok_or_else(|| PlaylistError::NotFound(id.to_string()))?;
        playlist
            .items
            .iter()
            .position(|t| t == track)
            .map(|pos| {
                playlist.items.remove(pos);
            })
            .ok_or_else(|| PlaylistError::TrackNotFound(track.to_string()))
    }

    /// Moves a track from one position to another (zero-based).
    pub fn move_track(&mut self, id: &str, from: usize, to: usize) -> Result<(), PlaylistError> {
        let playlist = self
            .playlists
            .get_mut(id)
            .ok_or_else(|| PlaylistError::NotFound(id.to_string()))?;
        if from >= playlist.items.len() || to >= playlist.items.len() {
            return Err(PlaylistError::PositionOutOfRange(to.max(from)));
        }
        let track = playlist.items.remove(from);
        playlist.items.insert(to, track);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collection() -> PlaylistCollection {
        let mut c = PlaylistCollection::new();
        c.create("Road Trip", "p1".into(), 100).unwrap();
        c
    }

    #[test]
    fn create_validates_name_and_duplicates() {
        let mut c = collection();
        assert_eq!(c.create("  ", "p2".into(), 1), Err(PlaylistError::EmptyName));
        assert_eq!(
            c.create("road trip", "p2".into(), 1),
            Err(PlaylistError::DuplicateName("road trip".into()))
        );
        let p = c.create(" Focus ", "p2".into(), 1).unwrap();
        assert_eq!(p.name, "Focus"); // trimmed
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn rename_rejects_empty_duplicate_and_missing() {
        let mut c = collection();
        c.create("Focus", "p2".into(), 1).unwrap();
        assert_eq!(c.rename("p1", ""), Err(PlaylistError::EmptyName));
        assert_eq!(
            c.rename("p1", "focus"),
            Err(PlaylistError::DuplicateName("focus".into()))
        );
        assert_eq!(
            c.rename("nope", "x"),
            Err(PlaylistError::NotFound("nope".into()))
        );
        // Renaming to the own current name is a no-op, not an error.
        c.rename("p1", "Road Trip").unwrap();
        assert_eq!(c.get("p1").unwrap().name, "Road Trip");
    }

    #[test]
    fn delete_removes_playlist() {
        let mut c = collection();
        c.delete("p1").unwrap();
        assert!(c.is_empty());
        assert_eq!(
            c.delete("p1"),
            Err(PlaylistError::NotFound("p1".into()))
        );
    }

    #[test]
    fn add_track_is_idempotent() {
        let mut c = collection();
        assert!(c.add_track("p1", "a".into()).unwrap());
        assert!(!c.add_track("p1", "a".into()).unwrap());
        assert_eq!(c.get("p1").unwrap().items, vec!["a".to_string()]);
        assert!(c.add_track("p1", "b".into()).unwrap());
        assert_eq!(c.get("p1").unwrap().items.len(), 2);
    }

    #[test]
    fn remove_track_reports_missing_track() {
        let mut c = collection();
        c.add_track("p1", "a".into()).unwrap();
        c.remove_track("p1", "a").unwrap();
        assert_eq!(
            c.remove_track("p1", "a"),
            Err(PlaylistError::TrackNotFound("a".into()))
        );
    }

    #[test]
    fn move_track_reorders_within_bounds() {
        let mut c = collection();
        for t in ["a", "b", "c"] {
            c.add_track("p1", t.into()).unwrap();
        }
        c.move_track("p1", 2, 0).unwrap();
        assert_eq!(c.get("p1").unwrap().items, vec!["c", "a", "b"]);
        assert_eq!(
            c.move_track("p1", 0, 3),
            Err(PlaylistError::PositionOutOfRange(3))
        );
    }

    #[test]
    fn list_is_sorted_by_name() {
        let mut c = PlaylistCollection::new();
        c.create("Zeta", "z".into(), 1).unwrap();
        c.create("Alpha", "a".into(), 2).unwrap();
        let names: Vec<&str> = c.list().iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "Zeta"]);
    }
}
