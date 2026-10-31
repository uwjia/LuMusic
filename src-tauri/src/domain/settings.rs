//! User settings persisted across restarts.

use serde::{Deserialize, Serialize};

use super::equalizer::EqSettings;

/// Application settings. `volume` is stored linear (0.0 - 1.0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub volume: f32,
    /// Last scanned library folder, so the app can restore it on start.
    pub last_folder: Option<String>,
    /// Keep running in the tray (music keeps playing) when the window is
    /// closed instead of exiting the app.
    pub close_to_tray: bool,
    /// Equalizer configuration (see `domain::equalizer`).
    pub eq: EqSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            volume: 0.8,
            last_folder: None,
            // A music player with a tray should keep playing in the
            // background by default; users who dislike it can opt out in
            // the settings page.
            close_to_tray: true,
            eq: EqSettings::default(),
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
        assert!(s.close_to_tray);
        assert_eq!(s.eq, EqSettings::default());
    }

    #[test]
    fn legacy_settings_file_without_close_to_tray_backfills_default() {
        // settings.json written by an older build lacks `closeToTray`;
        // container-level `default` must keep it parseable and opt-in.
        let parsed: Settings =
            serde_json::from_str(r#"{ "volume": 0.5, "lastFolder": "C:/Music" }"#).unwrap();
        assert_eq!(parsed.volume, 0.5);
        assert_eq!(parsed.last_folder.as_deref(), Some("C:/Music"));
        assert!(parsed.close_to_tray);
    }

    #[test]
    fn legacy_settings_file_without_eq_backfills_flat_default() {
        // settings.json written before the equalizer existed lacks `eq`;
        // it must parse to the disabled/flat default, never fail startup.
        let parsed: Settings = serde_json::from_str(
            r#"{ "volume": 0.5, "lastFolder": "C:/Music", "closeToTray": false }"#,
        )
        .unwrap();
        assert_eq!(parsed.eq, EqSettings::default());
        assert!(!parsed.eq.enabled);
    }

    #[test]
    fn eq_settings_round_trip_through_camel_case_json() {
        let settings = Settings {
            eq: EqSettings {
                enabled: true,
                preamp_db: -3.5,
                gains_db: vec![4.0, 2.0, 0.0, -1.0, 0.0, 0.0, 1.0, 2.0, 3.0, 5.0],
            },
            ..Settings::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains(r#""eq""#));
        assert!(json.contains(r#""preampDb":-3.5"#));
        assert!(json.contains(r#""enabled":true"#));
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, settings);
    }
}
