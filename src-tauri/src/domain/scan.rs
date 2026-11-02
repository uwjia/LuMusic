//! Scan planning rules: which files count as audio, and what a scan produced.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::playlist::AutoPlaylistSpec;
use super::track::TrackId;

/// File extensions the audio stack can decode (keep in sync with the
/// symphonia features in Cargo.toml and the `ape-decoder` adapter).
/// Deliberately NOT listed: `.aac` (raw ADTS — symphonia 0.5 has no ADTS
/// reader), `.mp4` (a video container; scanning it would pull movies into
/// a music library) and WavPack/DSD/Opus (no upstream decoder).
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3",
    "flac",
    "wav",
    "ogg",
    "oga",
    // M4A = MP4 container with AAC or ALAC audio.
    "m4a",
    // AIFF (PCM).
    "aif",
    "aiff",
    // Monkey's Audio, via infra/audio/ape_source (ape-decoder crate).
    "ape",
];

/// Returns true when the extension is a supported audio format
/// (case-insensitive).
pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

/// True when `child` is `dir` itself or lives underneath it. Component
/// comparison with component boundaries (so `Music` never matches
/// `Music2`); lowercased because Windows filesystems are case-insensitive
/// and watcher/scan paths can differ in case (on case-sensitive systems
/// the lowering can only over-match pathologically-cased siblings).
pub fn path_is_at_or_under(child: &Path, dir: &Path) -> bool {
    let mut child = child.components();
    let mut dir = dir.components();
    loop {
        match (child.next(), dir.next()) {
            (Some(c), Some(d)) => {
                if !c
                    .as_os_str()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&d.as_os_str().to_string_lossy())
                {
                    return false;
                }
            }
            // Equal paths.
            (None, None) => return true,
            // `child` is shorter than `dir`: not underneath it.
            (None, Some(_)) => return false,
            // `dir` exhausted: strict prefix.
            (Some(_), None) => return true,
        }
    }
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

/// Name of the playlist holding every scanned track.
pub const ALL_TRACKS: &str = "All Tracks";
/// Name of the playlist holding files that sit directly in the scan root.
pub const DEFAULT_PLAYLIST: &str = "Default";

/// Plans the auto-generated playlists for a scan.
///
/// Rules:
/// - one playlist per *first-level* folder under `root`, named after the
///   folder, containing every audio file beneath it (recursively);
/// - files sitting directly in `root` go to the `Default` playlist (only
///   created when such files exist);
/// - `All Tracks` always contains every scanned file;
/// - paths that are not under `root` count as root-level files.
///
/// Ids are stable (`auto:all`, `auto:root`, `auto:dir:<name>`) so repeated
/// scans update the same playlists instead of duplicating them.
pub fn auto_playlist_plan(root: &Path, paths: &[PathBuf]) -> Vec<AutoPlaylistSpec> {
    let mut folders: BTreeMap<String, Vec<TrackId>> = BTreeMap::new();
    let mut root_files: Vec<TrackId> = Vec::new();
    let mut all: Vec<TrackId> = Vec::with_capacity(paths.len());

    for path in paths {
        let id: TrackId = path.to_string_lossy().into_owned();
        let relative: Vec<_> = path
            .strip_prefix(root)
            .map(|rel| rel.components().collect::<Vec<_>>())
            .unwrap_or_default();
        match relative.split_first() {
            // More than one component: the file lives inside a first-level
            // folder (possibly nested deeper) -> group by that folder.
            Some((first, rest)) if !rest.is_empty() => {
                let folder = first.as_os_str().to_string_lossy().into_owned();
                folders.entry(folder).or_default().push(id.clone());
            }
            // No relative path or a file directly in the root.
            _ => root_files.push(id.clone()),
        }
        all.push(id);
    }

    let mut specs = vec![AutoPlaylistSpec {
        id: "auto:all".into(),
        name: ALL_TRACKS.into(),
        items: all,
    }];
    if !root_files.is_empty() {
        specs.push(AutoPlaylistSpec {
            id: "auto:root".into(),
            name: DEFAULT_PLAYLIST.into(),
            items: root_files,
        });
    }
    specs.extend(folders.into_iter().map(|(name, items)| AutoPlaylistSpec {
        id: format!("auto:dir:{name}"),
        name,
        items,
    }));
    specs
}

/// Resolves the on-disk folder an auto playlist id maps to.
///
/// - `auto:all` / `auto:root` -> the scan root itself;
/// - `auto:dir:<name>` -> the first-level folder of that name;
/// - anything else (manual playlists, crafted ids) -> `None`.
///
/// The joined path must stay under `root`: the folder name has to be a
/// single normal path component and the root absolute, so ids like
/// `auto:dir:../x` or `auto:dir:a/b` resolve to nothing instead of
/// escaping the music folder.
pub fn auto_playlist_folder(id: &str, root: &Path) -> Option<PathBuf> {
    if !root.is_absolute() {
        return None;
    }
    if id == "auto:all" || id == "auto:root" {
        return Some(root.to_path_buf());
    }
    let name = id.strip_prefix("auto:dir:")?;
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(component), None) if matches!(component, std::path::Component::Normal(_)) => {
            Some(root.join(name))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_playlist_folder_maps_ids_to_paths_under_the_root() {
        let root = Path::new("C:/music");
        assert_eq!(auto_playlist_folder("auto:all", root).as_deref(), Some(root));
        assert_eq!(auto_playlist_folder("auto:root", root).as_deref(), Some(root));
        assert_eq!(
            auto_playlist_folder("auto:dir:Rock", root).as_deref(),
            Some(Path::new("C:/music/Rock"))
        );
        // Folder names are user data: unicode must survive verbatim.
        assert_eq!(
            auto_playlist_folder("auto:dir:周杰伦", root).as_deref(),
            Some(Path::new("C:/music/周杰伦"))
        );
    }

    #[test]
    fn auto_playlist_folder_rejects_escapes_and_manual_ids() {
        let root = Path::new("C:/music");
        for id in [
            "auto:dir:..",
            "auto:dir:../x",
            "auto:dir:a/b",
            "auto:dir:",
            "auto:dir:C:/x",
            "pl-1",
            "auto:",
            "auto:xyz",
        ] {
            assert!(auto_playlist_folder(id, root).is_none(), "{id} must not resolve");
        }
        // A relative scan root is meaningless on disk: refuse it too.
        assert!(auto_playlist_folder("auto:all", Path::new("music")).is_none());
    }

    #[test]
    fn is_audio_file_matches_supported_extensions_case_insensitively() {
        for name in [
            "a.mp3",
            "b.Flac",
            "C.WAV",
            "d.ogg",
            "e.oga",
            // M4A (AAC/ALAC in an MP4 container), AIFF and APE joined
            // the set.
            "f.m4a",
            "g.M4A",
            "h.aif",
            "i.AIFF",
            "j.ape",
            "k.APE",
        ] {
            assert!(is_audio_file(Path::new(name)), "{name} should match");
        }
    }

    #[test]
    fn is_audio_file_rejects_unsupported_or_missing_extensions() {
        for name in [
            "a.txt",
            "b.wv",
            "c.opus",
            "noext",
            "a.mp3.bak",
            // Raw ADTS has no symphonia reader, and the video container
            // must not sweep movies into a music library.
            "d.aac",
            "e.mp4",
        ] {
            assert!(!is_audio_file(Path::new(name)), "{name} should not match");
        }
    }

    #[test]
    fn extension_of_lowercases_and_defaults_to_empty() {
        assert_eq!(extension_of(Path::new("X.MP3")), "mp3");
        assert_eq!(extension_of(Path::new("noext")), "");
    }

    #[test]
    fn path_is_at_or_under_matches_prefixes_with_component_boundaries() {
        let under = |child: &str, dir: &str| path_is_at_or_under(Path::new(child), Path::new(dir));
        assert!(under("C:/music/a.mp3", "C:/music"));
        assert!(under("C:/music/Rock/x.mp3", "C:/music"));
        assert!(under("C:/music", "C:/music")); // the dir itself
        // Case-insensitive (watcher vs scan paths may differ in case).
        assert!(under("C:/MUSIC/a.mp3", "c:/Music"));
        // Component boundaries: a sibling sharing a prefix must not match.
        assert!(!under("C:/music2/a.mp3", "C:/music"));
        assert!(!under("C:/other/a.mp3", "C:/music"));
        // A longer "child" than the dir cannot be under it.
        assert!(!under("C:/music", "C:/music/Rock"));
    }

    #[test]
    fn to_retain_set_deduplicates_ids() {
        let set = to_retain_set(["a".to_string(), "a".to_string(), "b".to_string()]);
        assert_eq!(set.len(), 2);
    }

    fn p(path: &str) -> PathBuf {
        PathBuf::from(path)
    }

    #[test]
    fn auto_playlist_plan_groups_by_first_level_folder() {
        let root = Path::new("C:/music");
        let plan = auto_playlist_plan(
            root,
            &[
                p("C:/music/solo.mp3"),
                p("C:/music/周杰伦/晴天.mp3"),
                p("C:/music/周杰伦/叶惠美/七里香.mp3"), // nested -> first-level folder
                p("C:/music/Rock/track01.flac"),
            ],
        );

        let by_name: Vec<(&str, usize, &str)> = plan
            .iter()
            .map(|s| (s.name.as_str(), s.items.len(), s.id.as_str()))
            .collect();
        // All Tracks first, then Default, then folders sorted by name.
        assert_eq!(
            by_name,
            vec![
                ("All Tracks", 4, "auto:all"),
                ("Default", 1, "auto:root"),
                ("Rock", 1, "auto:dir:Rock"),
                ("周杰伦", 2, "auto:dir:周杰伦"),
            ]
        );
        assert_eq!(
            plan[3].items,
            vec![
                "C:/music/周杰伦/晴天.mp3",
                "C:/music/周杰伦/叶惠美/七里香.mp3"
            ]
        );
    }

    #[test]
    fn auto_playlist_plan_skips_default_when_root_has_no_files() {
        let plan = auto_playlist_plan(Path::new("C:/music"), &[p("C:/music/A/x.mp3")]);
        let names: Vec<&str> = plan.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["All Tracks", "A"]);
    }

    #[test]
    fn auto_playlist_plan_with_no_files_yields_only_all_tracks() {
        let plan = auto_playlist_plan(Path::new("C:/music"), &[]);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].name, "All Tracks");
        assert!(plan[0].items.is_empty());
    }

    #[test]
    fn auto_playlist_plan_is_stable_across_calls() {
        let root = Path::new("C:/music");
        let files = [p("C:/music/A/1.mp3"), p("C:/music/A/2.mp3")];
        assert_eq!(
            auto_playlist_plan(root, &files),
            auto_playlist_plan(root, &files)
        );
    }
}
