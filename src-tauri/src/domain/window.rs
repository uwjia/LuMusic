//! Window geometry persistence rules (pure, no IO).
//!
//! The values originate from Tauri window events (physical pixels) and are
//! written to `window.json` by the infra layer; this module only decides
//! whether a persisted geometry is usable at all, so a stale or corrupted
//! file degrades to the configured default window instead of a broken one.

use serde::{Deserialize, Serialize};

/// Minimum window size. Must stay in sync with `minWidth`/`minHeight` in
/// tauri.conf.json (the config enforces it during interactive resizing;
/// this guards the restore path against garbage persisted values).
pub const MIN_WIDTH: u32 = 840;
pub const MIN_HEIGHT: u32 = 560;

/// Upper bound for either extent. Monitors far beyond this do not exist;
/// values past it indicate a corrupted file, not a real window.
pub const MAX_EXTENT: u32 = 16_384;

/// Restorable window geometry in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Maximized windows remember the flag *and* their last normal size,
    /// so a restore-down returns to the geometry the user chose.
    pub maximized: bool,
}

impl Default for WindowGeometry {
    fn default() -> Self {
        // Mirrors tauri.conf.json defaults; only used before the first
        // real sample replaces it.
        Self {
            x: 100,
            y: 100,
            width: 1100,
            height: 720,
            maximized: false,
        }
    }
}

impl WindowGeometry {
    /// Valid geometry, or `None` when the sizes are unusable (below the
    /// minimum, or absurdly large). The position is left unchecked here:
    /// monitor layouts differ between sessions and are validated against
    /// the live monitor list at restore time (app layer).
    pub fn sanitized(self) -> Option<Self> {
        let too_small = self.width < MIN_WIDTH || self.height < MIN_HEIGHT;
        let absurd = self.width > MAX_EXTENT || self.height > MAX_EXTENT;
        if too_small || absurd {
            None
        } else {
            Some(self)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_mirrors_the_configured_startup_window() {
        let g = WindowGeometry::default();
        assert_eq!((g.width, g.height), (1100, 720));
        assert!(!g.maximized);
        // The default must itself survive sanitizing.
        assert_eq!(g.sanitized(), Some(g));
    }

    #[test]
    fn valid_geometry_survives_sanitizing() {
        let g = WindowGeometry {
            x: -1920, // second monitor left of the primary is legitimate
            y: 40,
            width: 960,
            height: 600,
            maximized: true,
        };
        assert_eq!(g.sanitized(), Some(g));
    }

    #[test]
    fn sizes_below_the_minimum_are_rejected() {
        // Below minWidth.
        let narrow = WindowGeometry {
            width: 800,
            ..WindowGeometry::default()
        };
        assert_eq!(narrow.sanitized(), None);
        // Below minHeight.
        let flat = WindowGeometry {
            height: 500,
            ..WindowGeometry::default()
        };
        assert_eq!(flat.sanitized(), None);
        // Zero (e.g. a minimized snapshot).
        let zero = WindowGeometry {
            width: 0,
            height: 0,
            ..WindowGeometry::default()
        };
        assert_eq!(zero.sanitized(), None);
    }

    #[test]
    fn absurd_extents_are_rejected() {
        let huge = WindowGeometry {
            width: 20_000,
            ..WindowGeometry::default()
        };
        assert_eq!(huge.sanitized(), None);
    }

    #[test]
    fn geometry_round_trips_through_camel_case_json() {
        let g = WindowGeometry {
            x: 12,
            y: -8,
            width: 1280,
            height: 800,
            maximized: true,
        };
        let json = serde_json::to_string(&g).unwrap();
        assert!(json.contains(r#""maximized":true"#));
        let parsed: WindowGeometry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, g);
    }

    #[test]
    fn legacy_file_without_maximized_field_fails_closed() {
        // window.json predating the maximized flag lacks the key; strict
        // parsing (no serde default) drops the whole geometry so the app
        // falls back to the configured window instead of guessing.
        let parsed: Result<WindowGeometry, _> =
            serde_json::from_str(r#"{ "x": 0, "y": 0, "width": 900, "height": 600 }"#);
        assert!(parsed.is_err());
    }
}
