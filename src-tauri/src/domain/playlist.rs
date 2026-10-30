//! User playlists: CRUD + ordering rules over track ids.

use std::collections::{BTreeMap, HashSet};

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

/// Planned auto-generated playlist produced by a library scan (see
/// `domain::scan::auto_playlist_plan`). Ids are stable across scans so a
/// re-scan updates the existing auto playlist instead of duplicating it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoPlaylistSpec {
    pub id: String,
    pub name: String,
    pub items: Vec<TrackId>,
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
    /// True for playlists generated from the folder structure; they are
    /// replaced on every scan and can be pruned automatically.
    #[serde(default)]
    pub auto_generated: bool,
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
            auto_generated: false,
        };
        self.playlists.insert(playlist.id.clone(), playlist.clone());
        Ok(playlist)
    }

    /// Replaces all auto-generated playlists with `specs` (a scan result).
    ///
    /// Overwrite semantics - repeated scans never multiply playlists:
    /// - each spec maps to exactly one target playlist: an existing auto
    ///   playlist with the spec id, or a *manual* playlist with the same
    ///   (case-insensitive) name, which is **adopted** - its items are
    ///   overwritten with the scan result and it becomes auto-generated;
    /// - auto playlists that no spec targets are removed (folder deleted);
    /// - manual playlists whose name matches no scanned folder are never
    ///   touched;
    /// - a manual playlist merely squatting a spec *id* (not the name) is
    ///   never hijacked.
    ///
    /// Returns true when the collection changed.
    pub fn sync_auto(&mut self, specs: &[AutoPlaylistSpec], now: u64) -> bool {
        // Step 1: resolve every spec to its target playlist id. A playlist
        // (manual or auto) with the same name wins over the spec id, so an
        // adopted playlist stays the target of every future scan.
        let mut resolved: Vec<(&AutoPlaylistSpec, String, bool)> = Vec::with_capacity(specs.len());
        let mut target_ids: HashSet<String> = HashSet::with_capacity(specs.len());
        let mut used: HashSet<String> = HashSet::new();
        for spec in specs {
            let by_name = self
                .playlists
                .iter()
                .find(|(id, p)| !used.contains(*id) && p.name.eq_ignore_ascii_case(&spec.name))
                .map(|(id, _)| id.clone());
            let (id, adopted) = match by_name {
                Some(id) => {
                    let was_manual = !self.playlists[&id].auto_generated;
                    used.insert(id.clone());
                    (id, was_manual)
                }
                None => {
                    used.insert(spec.id.clone());
                    (spec.id.clone(), false)
                }
            };
            target_ids.insert(id.clone());
            resolved.push((spec, id, adopted));
        }

        // Step 2: prune auto playlists that no spec targets.
        let before = self.playlists.len();
        self.playlists
            .retain(|_, p| !p.auto_generated || target_ids.contains(&p.id));
        let mut changed = before != self.playlists.len();

        // Step 3: write the scan result into each target.
        for (spec, id, adopted) in resolved {
            match self.playlists.get_mut(&id) {
                // Adopted manual playlist or existing auto playlist:
                // overwrite items in place, keep id/name/created_at.
                Some(existing) if adopted || existing.auto_generated => {
                    if !existing.auto_generated || existing.items != spec.items {
                        existing.items = spec.items.clone();
                        existing.auto_generated = true;
                        changed = true;
                    }
                }
                // A manual playlist squatting this id without a name match
                // must not be hijacked; drop the spec instead.
                Some(_) => {}
                None => {
                    self.playlists.insert(
                        id.clone(),
                        Playlist {
                            id,
                            name: spec.name.clone(),
                            items: spec.items.clone(),
                            created_at: now,
                            auto_generated: true,
                        },
                    );
                    changed = true;
                }
            }
        }
        changed
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

    // ---------- auto playlists ----------

    fn spec(id: &str, name: &str, items: &[&str]) -> AutoPlaylistSpec {
        AutoPlaylistSpec {
            id: id.into(),
            name: name.into(),
            items: items.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn sync_auto_creates_updates_and_prunes() {
        let mut c = PlaylistCollection::new();
        c.create("Chill", "p1".into(), 100).unwrap(); // manual playlist

        // First scan: two auto playlists appear.
        let changed = c.sync_auto(
            &[spec("auto:all", "All Tracks", &["a", "b"]), spec("auto:dir:X", "X", &["a"])],
            200,
        );
        assert!(changed);
        assert_eq!(c.len(), 3);
        assert!(c.get("auto:all").unwrap().auto_generated);

        // Second scan: folder X renamed to Y (id gone -> pruned), All grows.
        let changed = c.sync_auto(
            &[spec("auto:all", "All Tracks", &["a", "b", "c"]), spec("auto:dir:Y", "Y", &["b", "c"])],
            300,
        );
        assert!(changed);
        assert!(c.get("auto:dir:X").is_none());
        assert_eq!(c.get("auto:all").unwrap().items.len(), 3);
        assert_eq!(c.get("auto:dir:Y").unwrap().items, vec!["b".to_string(), "c".to_string()]);
        // Manual playlist untouched.
        assert_eq!(c.get("p1").unwrap().name, "Chill");
        assert_eq!(c.get("p1").unwrap().items, Vec::<String>::new());

        // Idempotent rescan reports no change.
        assert!(!c.sync_auto(
            &[spec("auto:all", "All Tracks", &["a", "b", "c"]), spec("auto:dir:Y", "Y", &["b", "c"])],
            400
        ));
    }

    #[test]
    fn sync_auto_adopts_manual_playlist_with_same_name() {
        let mut c = PlaylistCollection::new();
        c.create("吸血鬼日记", "pl-1".into(), 1).unwrap();
        // Leftover twin from the old "(folder)" behavior.
        c.playlists.insert(
            "auto:dir:吸血鬼日记".into(),
            Playlist {
                id: "auto:dir:吸血鬼日记".into(),
                name: "吸血鬼日记 (folder)".into(),
                items: vec!["stale".into()],
                created_at: 1,
                auto_generated: true,
            },
        );

        let changed = c.sync_auto(&[spec("auto:dir:吸血鬼日记", "吸血鬼日记", &["a", "b"])], 2);
        assert!(changed);
        // The manual playlist was adopted: same id/name, scan result inside.
        let adopted = c.get("pl-1").unwrap();
        assert!(adopted.auto_generated);
        assert_eq!(adopted.items, vec!["a".to_string(), "b".to_string()]);
        // The twin is gone - exactly one playlist with this name remains.
        assert!(c.get("auto:dir:吸血鬼日记").is_none());
        assert_eq!(c.list().len(), 1);

        // Repeated scans stay idempotent.
        assert!(!c.sync_auto(&[spec("auto:dir:吸血鬼日记", "吸血鬼日记", &["a", "b"])], 3));
        assert_eq!(c.list().len(), 1);
    }

    #[test]
    fn sync_auto_repeated_scans_never_duplicate() {
        let mut c = PlaylistCollection::new();
        let specs = vec![
            spec("auto:all", "All Tracks", &["a"]),
            spec("auto:dir:X", "X", &["a"]),
        ];
        c.sync_auto(&specs, 1);
        for _ in 0..3 {
            c.sync_auto(&specs, 2);
        }
        assert_eq!(c.list().len(), 2);
        assert_eq!(c.get("auto:all").unwrap().items.len(), 1);
    }

    #[test]
    fn sync_auto_leaves_unrelated_manual_playlists_alone() {
        let mut c = PlaylistCollection::new();
        c.create("My Mix", "m".into(), 1).unwrap();
        c.add_track("m", "z".into()).unwrap();
        c.sync_auto(&[spec("auto:all", "All Tracks", &["a"])], 2);
        let manual = c.get("m").unwrap();
        assert!(!manual.auto_generated);
        assert_eq!(manual.items, vec!["z".to_string()]);
    }

    #[test]
    fn sync_auto_does_not_hijack_manual_playlist_squatting_an_auto_id() {
        let mut c = PlaylistCollection::new();
        c.playlists.insert(
            "auto:all".into(),
            Playlist {
                id: "auto:all".into(),
                name: "Mine".into(),
                items: vec!["z".into()],
                created_at: 1,
                auto_generated: false,
            },
        );
        c.sync_auto(&[spec("auto:all", "All Tracks", &["a"])], 2);
        assert_eq!(c.get("auto:all").unwrap().name, "Mine");
        assert_eq!(c.get("auto:all").unwrap().items, vec!["z".to_string()]);
    }

    #[test]
    fn auto_playlist_json_is_backward_compatible() {
        // Old caches lack `autoGenerated`; it must deserialize as false.
        let json = r#"{"id":"p1","name":"Chill","items":["a"],"createdAt":5}"#;
        let playlist: Playlist = serde_json::from_str(json).unwrap();
        assert!(!playlist.auto_generated);
        let serialized = serde_json::to_value(&playlist).unwrap();
        assert_eq!(serialized["autoGenerated"], false);
    }
}
