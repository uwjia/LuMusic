//! Metadata reading: turns files on disk into `Track` values via lofty tags.

use std::path::Path;

use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;

use crate::domain::encoding::fix_mojibake;
use crate::domain::track::Track;

/// Errors while reading one file's metadata.
#[derive(Debug, thiserror::Error)]
pub enum MetadataError {
    #[error("cannot read file: {0}")]
    Io(#[from] std::io::Error),
    #[error("lofty error: {0}")]
    Lofty(#[from] lofty::error::LoftyError),
}

/// Abstraction over tag reading so services can be unit-tested.
pub trait MetadataReader: Send + Sync {
    /// Reads tags + audio properties. The display title is always derived
    /// from the file name; tags only fill artist/album/genre/etc. Fails only
    /// on IO errors.
    fn read_track(&self, path: &Path) -> Result<Track, MetadataError>;
}

/// Production reader based on lofty.
pub struct LoftyMetadataReader;

impl MetadataReader for LoftyMetadataReader {
    fn read_track(&self, path: &Path) -> Result<Track, MetadataError> {
        let size = path.metadata()?.len();
        let file = Probe::open(path)?.read()?;
        let duration_secs = file.properties().duration().as_secs_f64();
        let tag = file.primary_tag().or_else(|| file.first_tag());
        Ok(map_tag(path, size, tag, duration_secs))
    }
}

/// Pure mapping from a lofty tag into our `Track` model.
///
/// The title is *always* the file stem: file names are the most direct,
/// user-controlled label, while embedded tag titles are frequently missing,
/// inconsistent, or mojibake. Tag fields other than the title (artist, album,
/// ...) still come from the tags and run through `fix_mojibake`, because
/// legacy taggers stored GBK/Big5 bytes declared as Latin-1.
pub fn map_tag(path: &Path, size_bytes: u64, tag: Option<&Tag>, duration_secs: f64) -> Track {
    let mut track = Track::from_stem(path, size_bytes);
    track.duration_secs = if duration_secs.is_finite() && duration_secs > 0.0 {
        Some(duration_secs)
    } else {
        None
    };
    let Some(tag) = tag else {
        return track;
    };

    // Repair first, trim second: mojibake bytes never carry meaningful spaces.
    // The tag title is deliberately ignored (see the doc comment above).
    let clean = |value: Option<std::borrow::Cow<'_, str>>| {
        value
            .map(|v| fix_mojibake(v.trim()))
            .filter(|v| !v.is_empty())
    };
    track.artist = clean(tag.artist());
    track.album = clean(tag.album());
    // AlbumArtist has no dedicated accessor; read the raw item instead.
    track.album_artist = clean(
        tag.get(&ItemKey::AlbumArtist)
            .and_then(|item| item.value().text())
            .map(std::borrow::Cow::Borrowed),
    );
    track.track_no = tag.track();
    track.disc_no = tag.disk();
    track.year = tag.year();
    track.genre = clean(tag.genre());
    track
}

#[cfg(test)]
mod tests {
    use super::*;
    use lofty::tag::Accessor;

    // `Accessor` provides the set_title/set_artist helpers used below.

    fn tagged(title: Option<&str>) -> Option<Tag> {
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        if let Some(title) = title {
            tag.set_title(title.to_string());
        }
        tag.set_artist("Artist".to_string());
        tag.set_album("Album".to_string());
        tag.insert_text(ItemKey::AlbumArtist, "AA".to_string());
        tag.set_genre("Rock".to_string());
        Some(tag)
    }

    #[test]
    fn map_tag_uses_tag_fields_except_title() {
        let track = map_tag(
            Path::new("C:/m/song.mp3"),
            123,
            tagged(Some("Real Title")).as_ref(),
            187.5,
        );
        // The title always comes from the file stem.
        assert_eq!(track.title, "song");
        assert_eq!(track.artist.as_deref(), Some("Artist"));
        assert_eq!(track.album.as_deref(), Some("Album"));
        assert_eq!(track.album_artist.as_deref(), Some("AA"));
        assert_eq!(track.genre.as_deref(), Some("Rock"));
        assert_eq!(track.duration_secs, Some(187.5));
        assert_eq!(track.size_bytes, 123);
    }

    #[test]
    fn map_tag_falls_back_to_stem_and_blanks() {
        let track = map_tag(Path::new("C:/m/My Song.flac"), 1, None, 0.0);
        assert_eq!(track.title, "My Song");
        assert_eq!(track.artist, None);
        // Non-positive duration is treated as unknown.
        assert_eq!(track.duration_secs, None);
    }

    #[test]
    fn map_tag_title_always_uses_file_stem() {
        // Even a well-formed tag title loses to the file name on purpose:
        // file names are the label the user actually controls.
        let track = map_tag(
            Path::new("C:/m/07 - Track Seven.mp3"),
            1,
            tagged(Some("Real Title")).as_ref(),
            10.0,
        );
        assert_eq!(track.title, "07 - Track Seven");
    }

    #[test]
    fn map_tag_repairs_mojibake_text_fields() {
        // "晴天" and "周杰伦" encoded as GBK, then misread as Latin-1 -
        // exactly what an ID3v2.3 tag written by legacy CN taggers yields.
        let gbk = |text: &str| {
            let (bytes, _, _) = encoding_rs::GBK.encode(text);
            bytes.iter().map(|b| *b as char).collect::<String>()
        };
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_title(gbk("晴天"));
        tag.set_artist(gbk("周杰伦"));
        tag.set_album(gbk("叶惠美"));

        let track = map_tag(Path::new("C:/m/song.mp3"), 1, Some(&tag), 10.0);
        // Title from the file stem; artist/album repaired from tags.
        assert_eq!(track.title, "song");
        assert_eq!(track.artist.as_deref(), Some("周杰伦"));
        assert_eq!(track.album.as_deref(), Some("叶惠美"));
    }

    #[test]
    fn map_tag_keeps_well_encoded_western_tags() {
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_title("Café Del Mar".to_string());
        tag.set_artist("Björk".to_string());
        let track = map_tag(Path::new("C:/m/Café Del Mar.mp3"), 1, Some(&tag), 10.0);
        assert_eq!(track.title, "Café Del Mar"); // stem happens to match
        assert_eq!(track.artist.as_deref(), Some("Björk"));
    }

    #[test]
    fn read_track_of_untagged_wav_falls_back_to_stem() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("Noise Bed.wav");
        // Write a real (tiny) WAV via hound so lofty parses a valid file.
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 8_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        {
            let mut writer = hound::WavWriter::create(&path, spec).unwrap();
            for i in 0..800 {
                writer.write_sample((i % 100) as i16).unwrap();
            }
            writer.finalize().unwrap();
        }

        let track = LoftyMetadataReader.read_track(&path).unwrap();
        assert_eq!(track.title, "Noise Bed");
        assert_eq!(track.duration_secs, Some(0.1)); // 800 frames @ 8 kHz
        assert_eq!(track.id, path.to_string_lossy().into_owned());
    }

    #[test]
    fn read_track_fails_for_missing_file() {
        let err = LoftyMetadataReader
            .read_track(Path::new("Z:/nope/missing.mp3"))
            .unwrap_err();
        assert!(matches!(err, MetadataError::Io(_)));
    }
}
