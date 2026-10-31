//! System tray: native menu with playback controls + window toggle.
//!
//! The tray is an OS surface, so the backend owns the icon/menu. Every
//! user-visible string however is *pushed* from the frontend's i18n
//! catalogue (`tray_set_labels` command, see `useTraySync`) - the same
//! "canonical data in the backend, localized labels at the display layer"
//! split used for auto playlist names.

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, MenuEvent, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use super::commands::emit_state;
use super::dto::{PlaybackStatus, PlayerStateDto};
use super::service::{PlayerError, PlayerService};
use super::state::SharedService;
use super::tray_icons::{menu_icon, toggle_glyph, Glyph};
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

/// Cap for the now-playing text. Native menus size themselves to the
/// widest item and track titles come from file name stems (frequently very
/// long), so one long title would stretch the whole menu across the
/// screen. The same bound keeps the hover tooltip compact.
const MAX_TRACK_LABEL_CHARS: usize = 10;

/// `Title — Artist` (artist omitted when unknown); shared by the menu entry
/// and the tooltip.
fn track_display(track: &Track) -> String {
    let full = match track.artist.as_deref() {
        Some(artist) if !artist.is_empty() => format!("{} — {}", track.title, artist),
        _ => track.title.clone(),
    };
    clamp_label(&full, MAX_TRACK_LABEL_CHARS)
}

/// Clamps to `max` characters, marking the cut with an ellipsis. Counts
/// `char`s (not bytes) so CJK titles truncate on a character boundary
/// instead of mid-codepoint.
fn clamp_label(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut clamped: String = text.chars().take(max.saturating_sub(1)).collect();
    clamped.push('…');
    clamped
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
/// Items are icon menu items so every row carries a glyph (drawn in
/// `tray_icons`, no binary assets).
pub struct TrayController {
    tray: TrayIcon<Wry>,
    now_playing: IconMenuItem<Wry>,
    previous: IconMenuItem<Wry>,
    toggle: IconMenuItem<Wry>,
    next: IconMenuItem<Wry>,
    show: IconMenuItem<Wry>,
    quit: IconMenuItem<Wry>,
    labels: TrayLabels,
    state: PlayerStateDto,
    /// Pre-rasterized glyphs; the toggle row swaps between play and pause.
    icon_toggle_on: Image<'static>,
    icon_toggle_off: Image<'static>,
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
        // The icon argument precedes the accelerator in IconMenuItem::with_id.
        let icon = |glyph: Glyph| Some(menu_icon(glyph));
        let now_playing = IconMenuItem::with_id(
            app,
            MENU_NOW_PLAYING,
            "",
            false,
            icon(Glyph::Note),
            None::<&str>,
        )?;
        let previous = IconMenuItem::with_id(
            app,
            MENU_PREVIOUS,
            &labels.previous,
            true,
            icon(Glyph::Previous),
            None::<&str>,
        )?;
        let toggle = IconMenuItem::with_id(
            app,
            MENU_TOGGLE,
            toggle_label(&labels, state.status),
            true,
            Some(menu_icon(toggle_glyph(state.status == PlaybackStatus::Playing))),
            None::<&str>,
        )?;
        let next = IconMenuItem::with_id(
            app,
            MENU_NEXT,
            &labels.next,
            true,
            icon(Glyph::Next),
            None::<&str>,
        )?;
        let show = IconMenuItem::with_id(
            app,
            MENU_SHOW,
            &labels.show,
            true,
            icon(Glyph::Show),
            None::<&str>,
        )?;
        let quit = IconMenuItem::with_id(
            app,
            MENU_QUIT,
            &labels.quit,
            true,
            icon(Glyph::Quit),
            None::<&str>,
        )?;
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
            icon_toggle_on: menu_icon(Glyph::Pause),
            icon_toggle_off: menu_icon(Glyph::Play),
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

    /// Re-applies every text and the toggle glyph. Failures are cosmetic (a
    /// stale label until the next refresh) and native set_text/set_icon
    /// have no actionable error handling, so they are logged at most for
    /// the tooltip and ignored otherwise.
    fn refresh(&self) {
        let _ = self.now_playing.set_text(now_playing_label(&self.labels, &self.state));
        let _ = self.previous.set_text(self.labels.previous.clone());
        let _ = self.toggle.set_text(toggle_label(&self.labels, self.state.status));
        let playing = self.state.status == PlaybackStatus::Playing;
        let _ = self.toggle.set_icon(Some(if playing {
            // Image is a cheap 1KB Cow clone; state changes are rare.
            self.icon_toggle_on.clone()
        } else {
            self.icon_toggle_off.clone()
        }));
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

    /// Samples stay far below any clamp budget: these tests pin the
    /// *formatting* (separator, fallback, status glyph), not the clamp -
    /// see the clamp tests for that behavior.
    fn track(artist: Option<&str>) -> Track {
        Track {
            id: "C:/lib/a.mp3".into(),
            title: "A".into(),
            artist: artist.map(|a| a.to_uppercase()),
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
        let with_artist = state(PlaybackStatus::Playing, Some(track(Some("n"))));
        assert_eq!(now_playing_label(&labels, &with_artist), "A — N");

        let no_artist = state(PlaybackStatus::Playing, Some(track(None)));
        assert_eq!(now_playing_label(&labels, &no_artist), "A");

        let idle = state(PlaybackStatus::Stopped, None);
        assert_eq!(now_playing_label(&labels, &idle), "Nothing playing");
    }

    #[test]
    fn tooltip_reflects_playback_status() {
        let playing = state(PlaybackStatus::Playing, Some(track(Some("n"))));
        assert_eq!(tooltip_text(&playing), "▶ A — N");

        let paused = state(PlaybackStatus::Paused, Some(track(None)));
        assert_eq!(tooltip_text(&paused), "⏸ A");

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

    #[test]
    fn long_track_labels_are_clamped_for_menu_and_tooltip() {
        // A file-stem title far beyond the cap must not stretch the native
        // menu: exactly MAX chars, cut marked with an ellipsis.
        let mut long = track(None);
        long.title = "A".repeat(120);
        let label = now_playing_label(&TrayLabels::default(), &state(PlaybackStatus::Playing, Some(long)));
        assert_eq!(label.chars().count(), MAX_TRACK_LABEL_CHARS);
        assert!(label.ends_with('…'));

        // The tooltip adds a status glyph, so the label part stays capped.
        let mut long = track(None);
        long.title = "A".repeat(120);
        let tip = tooltip_text(&state(PlaybackStatus::Playing, Some(long)));
        assert!(tip.starts_with("▶ "));
        assert_eq!(tip.chars().count(), MAX_TRACK_LABEL_CHARS + 2);
    }

    #[test]
    fn clamp_label_truncates_cjk_on_character_boundaries() {
        // Byte-based slicing would split a multi-byte char and panic.
        let cjk = "夜".repeat(60);
        let clamped = clamp_label(&cjk, MAX_TRACK_LABEL_CHARS);
        assert_eq!(clamped.chars().count(), MAX_TRACK_LABEL_CHARS);
        assert!(clamped.ends_with('…'));
        assert!(cjk.starts_with(clamped.trim_end_matches('…')));

        // Short and exactly-at-cap strings pass through untouched.
        assert_eq!(clamp_label("Alpha", MAX_TRACK_LABEL_CHARS), "Alpha");
        let exact: String = "b".repeat(MAX_TRACK_LABEL_CHARS);
        assert_eq!(clamp_label(&exact, MAX_TRACK_LABEL_CHARS), exact);
    }
}
