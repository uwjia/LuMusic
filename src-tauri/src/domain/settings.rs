//! User settings persisted across restarts.

use serde::{Deserialize, Serialize};

/// Application settings. `volume` is stored linear (0.0 - 1.0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub volume: f32,
    /// Last scanned library folder, so the app can restore it on start.
    pub last_folder: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            volume: 0.8,
            last_folder: None,
        }
    }
}

impl Settings {
    /// Clamps an arbitrary volume request into the valid range.
    /// NaN degrades to silence (0.0); infinities clamp to the nearest bound.
    pub fn clamp_volume(volume: f32) -> f32 {
        if volume.is_nan() {
            return 0.0;
        }
        volume.clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_volume_bounds_and_sanitizes() {
        assert_eq!(Settings::clamp_volume(0.5), 0.5);
        assert_eq!(Settings::clamp_volume(-1.0), 0.0);
        assert_eq!(Settings::clamp_volume(2.0), 1.0);
        assert_eq!(Settings::clamp_volume(f32::NAN), 0.0);
        assert_eq!(Settings::clamp_volume(f32::INFINITY), 1.0);
    }

    #[test]
    fn default_settings_are_sensible() {
        let s = Settings::default();
        assert!((0.0..=1.0).contains(&s.volume));
        assert_eq!(s.last_folder, None);
    }
}
