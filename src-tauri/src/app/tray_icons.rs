//! Tray menu icons, drawn from per-pixel predicates into RGBA buffers.
//!
//! Menu icons must be `tauri::Image` (RGBA). Rather than shipping binary
//! PNG assets - or enabling Tauri's image-decoding feature for six tiny
//! glyphs - each icon is expressed as a pure "is (x, y) filled" predicate
//! and rasterized at startup. That keeps the dependency footprint at zero
//! and makes the shapes unit-testable (symmetry, coverage, bounds).

use tauri::image::Image;

/// Icon canvas: Windows small menu icons are 16x16 device pixels.
pub const ICON_SIZE: u32 = 16;

/// Icon ink color. Mid gray (the app's `--fg-2` token) reads on both the
/// light and dark native menu surfaces Windows may render.
const INK: [u8; 3] = [0x6b, 0x73, 0x85];

/// The glyphs used by the tray menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glyph {
    /// Eighth note for the now-playing row.
    Note,
    Previous,
    Play,
    Pause,
    Next,
    /// Window outline for "show main window".
    Show,
    /// Power symbol for "quit".
    Quit,
}

impl Glyph {
    /// Whether pixel (x, y) of the 16x16 canvas is inked. Coordinates are
    /// integers in `0..16`, x pointing right, y pointing down.
    pub fn filled(self, x: i32, y: i32) -> bool {
        match self {
            Glyph::Note => note(x, y),
            Glyph::Previous => next(15 - x, y), // mirror of Next
            Glyph::Play => play(x, y),
            Glyph::Pause => pause(x, y),
            Glyph::Next => next(x, y),
            Glyph::Show => show(x, y),
            Glyph::Quit => quit(x, y),
        }
    }
}

/// The play/pause entry offers the *opposite* of the current status, icon
/// included - same rule as the text label.
pub fn toggle_glyph(playing: bool) -> Glyph {
    if playing {
        Glyph::Pause
    } else {
        Glyph::Play
    }
}

// ----- glyph shapes (16x16) -----
//
// Design rules that keep the set coherent instead of a mixed-bag look:
// - transport glyphs (play/pause/previous/next) share the vertical band
//   y in 3..=12, so they read as one cluster at the same scale;
// - every stroke is at least ~2px thick (1px hairlines vanish at 16x16);
// - previous is the pixel mirror of next; next reuses the play triangle.

/// The shared transport band: all transport glyphs span exactly these rows.
const BAND_TOP: i32 = 3;
const BAND_BOTTOM: i32 = 12;

fn in_band(y: i32) -> bool {
    (BAND_TOP..=BAND_BOTTOM).contains(&y)
}

/// Right-pointing triangle: full-height base at the left edge (`base`),
/// apex at the right (`base + span`) with a ~2px stub so the tip reads at
/// 16x16 (a single-pixel spike disappears).
fn tri_right(x: i32, y: i32, base: i32, span: i32) -> bool {
    let half = (base + span - x) as f32 * 5.0 / span as f32 + 1.0;
    (base..=base + span).contains(&x) && in_band(y) && ((y as f32 - 7.5).abs() <= half)
}

fn play(x: i32, y: i32) -> bool {
    tri_right(x, y, 3, 9)
}

/// Skip-to-end: a (smaller) play triangle pointing at the 2px bar on its
/// right, flush with the triangle's full-height base.
fn next(x: i32, y: i32) -> bool {
    tri_right(x, y, 3, 7) || ((12..=13).contains(&x) && in_band(y))
}

/// Two 3px bars, same band height as the play triangle.
fn pause(x: i32, y: i32) -> bool {
    ((4..=6).contains(&x) || (9..=11).contains(&x)) && in_band(y)
}

/// Window: 2px border with the top edge doubling as the title bar.
fn show(x: i32, y: i32) -> bool {
    let in_outer = (2..=13).contains(&x) && (4..=13).contains(&y);
    in_outer && (x <= 3 || x >= 12 || y <= 5 || y >= 12)
}

/// Power symbol: thick ring with a gap at the top plus the vertical stem.
fn quit(x: i32, y: i32) -> bool {
    let dx = x as f32 - 8.0;
    let dy = y as f32 - 8.5;
    let dist = (dx * dx + dy * dy).sqrt();
    // ~2.4px ring thickness, in the same weight class as the bars above.
    let ring = (3.9..=6.3).contains(&dist);
    // The gap straddles the stem (~2 columns on each side), like ⏻.
    let gap = dx.abs() <= 2.9 && (y as f32) < 8.5;
    let stem = (7..=8).contains(&x) && (2..=7).contains(&y);
    (ring && !gap) || stem
}

/// Eighth note: 2px stem, note head at its foot, flag at its top.
fn note(x: i32, y: i32) -> bool {
    let stem = (9..=10).contains(&x) && (3..=12).contains(&y);
    let head = (6..=10).contains(&x) && (11..=13).contains(&y);
    let flag = (11..=13).contains(&x) && (4 + (x - 11)..=6 + (x - 11)).contains(&y);
    stem || head || flag
}

// ----- rasterization -----

/// Renders a glyph into an owned RGBA image (straight alpha; empty pixels
/// are fully transparent so the native menu background shows through).
pub fn menu_icon(glyph: Glyph) -> Image<'static> {
    let mut rgba = Vec::with_capacity((ICON_SIZE * ICON_SIZE * 4) as usize);
    for y in 0..ICON_SIZE as i32 {
        for x in 0..ICON_SIZE as i32 {
            if glyph.filled(x, y) {
                rgba.extend_from_slice(&INK);
                rgba.push(255);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixels(glyph: Glyph) -> Vec<(i32, i32)> {
        let mut filled = Vec::new();
        for y in 0..16 {
            for x in 0..16 {
                if glyph.filled(x, y) {
                    filled.push((x, y));
                }
            }
        }
        filled
    }

    #[test]
    fn every_glyph_inks_a_sane_share_of_the_canvas() {
        // Too few pixels = an invisible icon; too many = a blob.
        for glyph in [
            Glyph::Note,
            Glyph::Previous,
            Glyph::Play,
            Glyph::Pause,
            Glyph::Next,
            Glyph::Show,
            Glyph::Quit,
        ] {
            let count = pixels(glyph).len();
            assert!(
                (12..=140).contains(&count),
                "{glyph:?} has {count} pixels, outside a recognizable range"
            );
            // Ink stays inside the canvas with a 1px margin: menu icons must
            // not touch the edge or they look clipped.
            assert!(
                pixels(glyph).iter().all(|&(x, y)| (0..16).contains(&x) && (0..16).contains(&y)),
                "{glyph:?} draws outside the canvas"
            );
        }
    }

    #[test]
    fn shapes_hit_their_expected_pixels() {
        // Play points RIGHT: full-height base column at the left, apex stub
        // at the right only near the vertical center. (These pins exist
        // because the first draft drew the triangle mirrored.)
        assert!(Glyph::Play.filled(3, 3) && Glyph::Play.filled(3, 12));
        assert!(Glyph::Play.filled(12, 8) && !Glyph::Play.filled(12, 4));
        // Next points at its bar on the right; Previous (its mirror) keeps
        // the bar on the left.
        assert!(Glyph::Next.filled(13, 3) && Glyph::Next.filled(13, 12));
        assert!(Glyph::Previous.filled(2, 3) && Glyph::Previous.filled(2, 12));
        // Pause: two bars with a gap between them.
        assert!(Glyph::Pause.filled(5, 8) && Glyph::Pause.filled(10, 8));
        assert!(!Glyph::Pause.filled(8, 8));
        // Window: filled title bar, hollow body.
        assert!(Glyph::Show.filled(7, 4));
        assert!(Glyph::Show.filled(2, 8));
        assert!(!Glyph::Show.filled(7, 8));
        // Power: ring pixel on the left, stem at the top, gap beside the
        // stem (outside it the ring is present again).
        assert!(Glyph::Quit.filled(3, 9));
        assert!(Glyph::Quit.filled(8, 3));
        assert!(!Glyph::Quit.filled(9, 3));
        assert!(Glyph::Quit.filled(12, 5));
        // Note: stem, head, flag.
        assert!(Glyph::Note.filled(9, 8) && Glyph::Note.filled(8, 12) && Glyph::Note.filled(12, 5));
    }

    #[test]
    fn previous_is_the_mirror_of_next() {
        for y in 0..16 {
            for x in 0..16 {
                assert_eq!(
                    Glyph::Previous.filled(x, y),
                    Glyph::Next.filled(15 - x, y),
                    "mirror broken at ({x}, {y})"
                );
            }
        }
    }

    #[test]
    fn transport_glyphs_share_one_band_and_scale() {
        // The transport cluster must read as one family: identical vertical
        // band, widths within 2px. Mixed scales are what made the first
        // icon set look incoherent.
        let bounds = |glyph: Glyph| {
            let pts = pixels(glyph);
            let xs: Vec<i32> = pts.iter().map(|&(x, _)| x).collect();
            let ys: Vec<i32> = pts.iter().map(|&(_, y)| y).collect();
            (*xs.iter().min().unwrap(), *xs.iter().max().unwrap(), *ys.iter().min().unwrap(), *ys.iter().max().unwrap())
        };
        let expected = [(Glyph::Play, 3, 12), (Glyph::Pause, 4, 11), (Glyph::Next, 3, 13), (Glyph::Previous, 2, 12)];
        for &(glyph, min_x, max_x) in &expected {
            let (x0, x1, y0, y1) = bounds(glyph);
            assert_eq!((x0, x1, y0, y1), (min_x, max_x, BAND_TOP, BAND_BOTTOM), "{glyph:?} breaks the shared band");
        }
    }

    #[test]
    fn toggle_glyph_matches_the_toggle_label_rule() {
        assert_eq!(toggle_glyph(true), Glyph::Pause);
        assert_eq!(toggle_glyph(false), Glyph::Play);
    }

    #[test]
    fn menu_icon_rasterizes_to_transparent_and_opaque_pixels() {
        let icon = menu_icon(Glyph::Play);
        assert_eq!(icon.width(), ICON_SIZE);
        assert_eq!(icon.height(), ICON_SIZE);
        let rgba = icon.rgba();
        assert_eq!(rgba.len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
        let px = |x: u32, y: u32| {
            let i = ((y * ICON_SIZE + x) * 4) as usize;
            (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])
        };
        // Inked pixel: opaque with the ink color.
        assert_eq!(px(11, 8), (INK[0], INK[1], INK[2], 255));
        // Empty corner: fully transparent.
        assert_eq!(px(0, 0), (0, 0, 0, 0));
    }
}
