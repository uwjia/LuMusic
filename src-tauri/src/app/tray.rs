//! System tray: native menu with playback controls + window toggle.
//!
//! The tray is an OS surface, so the backend owns the icon/menu. Every
//! user-visible string however is *pushed* from the frontend's i18n
//! catalogue (`tray_set_labels` command, see `useTraySync`) - the same
//! "canonical data in the backend, localized labels at the display layer"
//! split used for auto playlist names.

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use super::commands::emit_state;
use super::dto::{PlaybackStatus, PlayerStateDto};
use super::service::{PlayerError, PlayerService};
use super::state::SharedService;
use crate::domain::track::Track;

/// Main window label (tauri.conf.json `app.windows[0].label`).
const MAIN_WINDOW: &str = "main";

/// Menu item ids - the routing keys for `handle_menu_event`.
const MENU_NOW_PLAYING: &str = "now-playing";
const MENU_PREVIOUS: &str = "previous";
const MENU_TOGGLE: &str = "toggle";
const MENU_NEXT: &str = "next";
const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";

/// Localized menu strings. The frontend replaces them from its i18n
/// dictionary on mount and on every locale switch; `Default` is the English
/// fallback shown only during the first moments after launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayLabels {
    pub play: String,
    pub pause: String,
    pub previous: String,
    pub next: String,
    pub show: String,
    pub quit: String,
    pub nothing_playing: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            play: "Play".into(),
            pause: "Pause".into(),
            previous: "Previous".into(),
            next: "Next".into(),
            show: "Show LuMusic".into(),
            quit: "Quit".into(),
            nothing_playing: "Nothing playing".into(),
        }
    }
}

/// `Title — Artist` (artist omitted when unknown); shared by the menu entry
/// and the tooltip.
fn track_display(track: &Track) -> String {
    match track.artist.as_deref() {
        Some(artist) if !artist.is_empty() => format!("{} — {}", track.title, artist),
        _ => track.title.clone(),
    }
}

/// The play/pause entry offers the *opposite* of the current status.
fn toggle_label(labels: &TrayLabels, status: PlaybackStatus) -> &str {
    match status {
        PlaybackStatus::Playing => labels.pause.as_str(),
        PlaybackStatus::Paused | PlaybackStatus::Stopped => labels.play.as_str(),
    }
}

/// Text of the disabled now-playing entry at the top of the menu.
fn now_playing_label(labels: &TrayLabels, state: &PlayerStateDto) -> String {
    match state.current_track.as_ref() {
        Some(track) => track_display(track),
        None => labels.nothing_playing.clone(),
    }
}

/// Tray tooltip: a status glyph plus the current track, or just the app
/// name when nothing is loaded.
fn tooltip_text(state: &PlayerStateDto) -> String {
    let Some(track) = state.current_track.as_ref() else {
        return "LuMusic".to_string();
    };
    let label = track_display(track);
    match state.status {
        PlaybackStatus::Playing => format!("▶ {label}"),
        PlaybackStatus::Paused => format!("⏸ {label}"),
        PlaybackStatus::Stopped => label,
    }
}

/// Owns the tray icon and menu item handles, mirroring the last applied
/// player state and labels so either can change independently (state from
/// `emit_state`, labels from `tray_set_labels`) and re-render the menu.
pub struct TrayController {
    tray: TrayIcon<Wry>,
    now_playing: MenuItem<Wry>,
    previous: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    next: MenuItem<Wry>,
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    labels: TrayLabels,
    state: PlayerStateDto,
}

impl TrayController {
    /// Builds the tray icon + menu. `state` seeds the dynamic entries (the
    /// persisted session is restored before this runs, so the menu is
    /// meaningful before the first IPC).
    pub fn build(
        app: &AppHandle<Wry>,
        labels: TrayLabels,
        state: PlayerStateDto,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let now_playing = MenuItem::with_id(app, MENU_NOW_PLAYING, "", false, None::<&str>)?;
        let previous = MenuItem::with_id(app, MENU_PREVIOUS, &labels.previous, true, None::<&str>)?;
        let toggle =
            MenuItem::with_id(app, MENU_TOGGLE, toggle_label(&labels, state.status), true, None::<&str>)?;
        let next = MenuItem::with_id(app, MENU_NEXT, &labels.next, true, None::<&str>)?;
        let show = MenuItem::with_id(app, MENU_SHOW, &labels.show, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, MENU_QUIT, &labels.quit, true, None::<&str>)?;
        let separator_a = PredefinedMenuItem::separator(app)?;
        let separator_b = PredefinedMenuItem::separator(app)?;
        let separator_c = PredefinedMenuItem::separator(app)?;

        let menu = Menu::with_items(
            app,
            &[
                &now_playing,
                &separator_a,
                &previous,
                &toggle,
                &next,
                &separator_b,
                &show,
                &separator_c,
                &quit,
            ],
        )?;

        let icon = app
            .default_window_icon()
            .cloned()
            .ok_or("default window icon is missing")?;
        let tray = TrayIconBuilder::with_id("lumusic-tray")
            .icon(icon)
            .menu(&menu)
            .tooltip(tooltip_text(&state))
            // Right click opens the menu; left click is our toggle handler.
            .show_menu_on_left_click(false)
            .build(app)?;

        let controller = Self {
            tray,
            now_playing,
            previous,
            toggle,
            next,
            show,
            quit,
            labels,
            state,
        };
        controller.refresh();
        Ok(controller)
    }

    /// Called from `emit_state` on every playback change.
    pub fn update_player_state(&mut self, state: &PlayerStateDto) {
        self.state = state.clone();
        self.refresh();
    }

    /// Called when the frontend pushes a new language.
    pub fn set_labels(&mut self, labels: TrayLabels) {
        self.labels = labels;
        self.refresh();
    }

    /// Re-applies every text. Failures are cosmetic (a stale label until the
    /// next refresh) and native set_text has no actionable error handling,
    /// so they are logged at most for the tooltip and ignored otherwise.
    fn refresh(&self) {
        let _ = self.now_playing.set_text(now_playing_label(&self.labels, &self.state));
        let _ = self.previous.set_text(self.labels.previous.clone());
        let _ = self.toggle.set_text(toggle_label(&self.labels, self.state.status));
        let _ = self.next.set_text(self.labels.next.clone());
        let _ = self.show.set_text(self.labels.show.clone());
        let _ = self.quit.set_text(self.labels.quit.clone());
        if let Err(err) = self.tray.set_tooltip(Some(tooltip_text(&self.state))) {
            tracing::warn!("failed to update tray tooltip: {err}");
        }
    }
}

/// Runs the playback action behind a tray menu id (`Ok(())` for unknown ids
/// keeps the matcher exhaustive without unreachable arms).
fn apply_playback_action(service: &mut PlayerService, id: &str) -> Result<(), PlayerError> {
    match id {
        MENU_PREVIOUS => service.previous(),
        MENU_TOGGLE => service.toggle(),
        MENU_NEXT => service.next(),
        _ => Ok(()),
    }
}

/// Routes tray menu clicks: playback actions go through the same service
/// methods as the UI (identical rules and state events), Show/Quit manage
/// the window / process lifetime.
pub fn handle_menu_event(app: &AppHandle<Wry>, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_PREVIOUS | MENU_TOGGLE | MENU_NEXT => {
            let Some(service) = app.try_state::<SharedService>() else {
                return;
            };
            let Ok(mut guard) = service.lock() else {
                return;
            };
            if let Err(err) = apply_playback_action(&mut guard, event.id().as_ref()) {
                // E.g. Play with an empty queue - nothing to do, stay quiet.
                tracing::debug!("tray playback action skipped: {err}");
            }
            emit_state(app, &guard);
        }
        MENU_SHOW => show_main_window(app),
        MENU_QUIT => quit_app(app),
        _ => {}
    }
}

/// Left click toggles the main window; the menu opens on right click.
pub fn handle_tray_icon_event(app: &AppHandle<Wry>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            // `is_visible` failing is treated as visible: hiding a visible
            // window is recoverable, quitting a hidden one is not.
            if window.is_visible().unwrap_or(true) {
                let _ = window.hide();
            } else {
                show_main_window(app);
            }
        }
    }
}

pub fn show_main_window(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Flushes the playback session to disk. Shared by the quit path and the
/// run-event exit hook (which is the only chance after a hidden window).
pub fn flush_session(app: &AppHandle<Wry>) {
    if let Some(service) = app.try_state::<SharedService>() {
        if let Ok(mut guard) = service.lock() {
            guard.save_playback_session();
        }
    }
}

fn quit_app(app: &AppHandle<Wry>) {
    flush_session(app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::queue::RepeatMode;
    use crate::domain::track::Track;

    fn state(status: PlaybackStatus, track: Option<Track>) -> PlayerStateDto {
        PlayerStateDto {
            status,
            current_track: track,
            queue_position: None,
            queue_len: 0,
            position_secs: 0.0,
            duration_secs: None,
            volume: 0.8,
            shuffle: false,
            repeat: RepeatMode::Off,
        }
    }

    fn track(artist: Option<&str>) -> Track {
        Track {
            id: "C:/lib/a.mp3".into(),
            title: "Alpha".into(),
            artist: artist.map(Into::into),
            ..Track::from_stem(std::path::Path::new("C:/lib/a.mp3"), 1)
        }
    }

    #[test]
    fn toggle_label_offers_the_opposite_action() {
        let labels = TrayLabels::default();
        assert_eq!(toggle_label(&labels, PlaybackStatus::Stopped), "Play");
        assert_eq!(toggle_label(&labels, PlaybackStatus::Paused), "Play");
        assert_eq!(toggle_label(&labels, PlaybackStatus::Playing), "Pause");
    }

    #[test]
    fn now_playing_label_formats_track_and_falls_back() {
        let labels = TrayLabels::default();
        let with_artist = state(PlaybackStatus::Playing, Some(track(Some("Nova"))));
        assert_eq!(now_playing_label(&labels, &with_artist), "Alpha — Nova");

        let no_artist = state(PlaybackStatus::Playing, Some(track(None)));
        assert_eq!(now_playing_label(&labels, &no_artist), "Alpha");

        let idle = state(PlaybackStatus::Stopped, None);
        assert_eq!(now_playing_label(&labels, &idle), "Nothing playing");
    }

    #[test]
    fn tooltip_reflects_playback_status() {
        let playing = state(PlaybackStatus::Playing, Some(track(Some("Nova"))));
        assert_eq!(tooltip_text(&playing), "▶ Alpha — Nova");

        let paused = state(PlaybackStatus::Paused, Some(track(None)));
        assert_eq!(tooltip_text(&paused), "⏸ Alpha");

        let idle = state(PlaybackStatus::Stopped, None);
        assert_eq!(tooltip_text(&idle), "LuMusic");
    }

    #[test]
    fn labels_round_trip_through_camel_case_json() {
        // The frontend sends `{ play, pause, previous, next, show, quit,
        // nothingPlaying }`; partial payloads must fall back to defaults.
        let parsed: TrayLabels =
            serde_json::from_str(r#"{ "play": "播放", "nothingPlaying": "暂无播放" }"#).unwrap();
        assert_eq!(parsed.play, "播放");
        assert_eq!(parsed.nothing_playing, "暂无播放");
        assert_eq!(parsed.quit, "Quit");
    }
}
