//! Library index: in-memory catalog of all known tracks.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use super::track::{SortField, Track, TrackId};

/// Query parameters for listing tracks (search box + column sorting).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackQuery {
    /// Whitespace-separated terms; every term must match somewhere.
    pub search: Option<String>,
    pub sort: SortField,
    pub descending: bool,
}

/// In-memory track catalog keyed by `TrackId`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryIndex {
    tracks: BTreeMap<TrackId, Track>,
}

impl LibraryIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.tracks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }

    pub fn get(&self, id: &str) -> Option<&Track> {
        self.tracks.get(id)
    }

    pub fn ids(&self) -> Vec<TrackId> {
        self.tracks.keys().cloned().collect()
    }

    /// Inserts or replaces a track. Returns `true` when a track was replaced.
    pub fn upsert(&mut self, track: Track) -> bool {
        self.tracks.insert(track.id.clone(), track).is_some()
    }

    /// Removes tracks whose id is not in `keep`; returns how many were removed.
    pub fn retain_only(&mut self, keep: &HashSet<TrackId>) -> usize {
        let before = self.tracks.len();
        self.tracks.retain(|id, _| keep.contains(id));
        before - self.tracks.len()
    }

    /// Filters and sorts tracks by the query.
    ///
    /// Rules:
    /// - every whitespace-separated search term must appear in
    ///   title/artist/album (case-insensitive);
    /// - `None` sort values always go last regardless of direction;
    /// - sorting is stable, so equal keys keep insertion (id) order.
    pub fn query(&self, query: &TrackQuery) -> Vec<&Track> {
        let terms: Vec<String> = query
            .search
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_lowercase)
            .collect();

        let mut hits: Vec<&Track> = self
            .tracks
            .values()
            .filter(|track| {
                let haystack = track.searchable_text();
                terms.iter().all(|term| haystack.contains(term))
            })
            .collect();

        hits.sort_by(|a, b| {
            let av = a.sort_value(query.sort);
            let bv = b.sort_value(query.sort);
            // `None` values always go last, regardless of the direction.
            match (av, bv) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(x), Some(y)) => {
                    if query.descending {
                        y.cmp(&x)
                    } else {
                        x.cmp(&y)
                    }
                }
            }
        });
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn track(id: &str, title: &str, artist: Option<&str>, album: Option<&str>) -> Track {
        Track {
            id: id.into(),
            title: title.into(),
            artist: artist.map(str::to_string),
            album: album.map(str::to_string),
            ..Track::from_stem(Path::new(id), 1)
        }
    }

    fn index() -> LibraryIndex {
        let mut lib = LibraryIndex::new();
        lib.upsert(track("a", "Alpha", Some("Zed"), Some("Album One")));
        lib.upsert(track("b", "Beta", Some("Amy"), Some("Album Two")));
        lib.upsert(track("c", "Gamma", None, Some("Album One")));
        lib
    }

    #[test]
    fn upsert_replaces_existing_track_by_id() {
        let mut lib = index();
        assert_eq!(lib.len(), 3);
        assert!(!lib.upsert(track("d", "Delta", None, None)));
        assert!(lib.upsert(track("a", "Alpha v2", Some("Zed"), None)));
        assert_eq!(lib.len(), 4);
        assert_eq!(lib.get("a").unwrap().title, "Alpha v2");
    }

    #[test]
    fn retain_only_prunes_missing_ids() {
        let mut lib = index();
        let keep: HashSet<TrackId> = ["a".to_string(), "b".to_string()].into();
        assert_eq!(lib.retain_only(&keep), 1);
        assert_eq!(lib.ids(), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn query_matches_terms_across_any_field() {
        let lib = index();
        let q = |s: &str| {
            lib.query(&TrackQuery {
                search: Some(s.into()),
                ..Default::default()
            })
            .iter()
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>()
        };
        // Single term matching a title.
        assert_eq!(q("alpha"), vec!["a"]);
        // "album" matches all albums, "one" narrows to Album One.
        assert_eq!(q("album one"), vec!["a", "c"]);
    }

    #[test]
    fn query_requires_all_terms() {
        let lib = index();
        let q = |s: &str| {
            lib.query(&TrackQuery {
                search: Some(s.into()),
                ..Default::default()
            })
            .len()
        };
        // "beta amy" both appear in track b.
        assert_eq!(q("beta amy"), 1);
        // "beta zed" mixes fields of different tracks -> no match.
        assert_eq!(q("beta zed"), 0);
        // Empty search returns everything.
        assert_eq!(q(""), 3);
        assert_eq!(q("   "), 3);
    }

    #[test]
    fn query_sorts_with_none_last_in_both_directions() {
        let lib = index();
        let sorted: Vec<&str> = lib
            .query(&TrackQuery {
                sort: SortField::Artist,
                ..Default::default()
            })
            .iter()
            .map(|t| t.id.as_str())
            .collect();
        // Amy < Zed < (none).
        assert_eq!(sorted, vec!["b", "a", "c"]);

        let desc: Vec<&str> = lib
            .query(&TrackQuery {
                sort: SortField::Artist,
                descending: true,
                ..Default::default()
            })
            .iter()
            .map(|t| t.id.as_str())
            .collect();
        // Zed > Amy, none still last.
        assert_eq!(desc, vec!["a", "b", "c"]);
    }
}
