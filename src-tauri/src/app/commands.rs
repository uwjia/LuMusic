//! Thin Tauri commands: lock the service, call one method, map errors,
//! emit state events. No business logic lives here.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use super::dto::{LyricsDto, PlayerStateDto, ScanProgressDto};
use super::service::{PlayerError, PlayerService};
use super::state::SharedService;
use super::tray::{TrayController, TrayLabels};
use crate::domain::library::TrackQuery;
use crate::domain::playlist::Playlist;
use crate::domain::queue::RepeatMode;
use crate::domain::scan::ScanSummary;
use crate::domain::settings::Settings;
use crate::domain::track::{Track, TrackId};
use crate::events as ev;

/// Returns build metadata for the frontend (about dialog / diagnostics).
#[tauri::command]
pub fn app_info() -> Value {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// Emits the current player state to all windows and refreshes the tray
/// menu/tooltip in the same step, so every surface stays consistent.
pub fn emit_state(app: &AppHandle, service: &PlayerService) {
    let state = service.state();
    if let Some(tray) = app.try_state::<Mutex<TrayController>>() {
        if let Ok(mut controller) = tray.lock() {
            controller.update_player_state(&state);
        }
    }
    if let Err(err) = app.emit(ev::EVENT_PLAYER_STATE, &state) {
        tracing::warn!("failed to emit player state: {err}");
    }
}

fn map<T>(result: Result<T, PlayerError>) -> Result<T, String> {
    result.map_err(|e| e.to_string())
}

// ----- library -----

/// Scans `root` and merges the result into the library.
///
/// Phase 1 (filesystem walk + tag reading) runs on a blocking thread *without*
/// holding the service lock, so playback commands stay responsive and progress
/// events flow. Phase 2 locks briefly to merge + persist.
#[tauri::command]
pub async fn scan_library(
    app: AppHandle,
    state: State<'_, SharedService>,
    root: String,
) -> Result<ScanSummary, String> {
    let (scanner, metadata) = {
        let service = state.lock().map_err(|_| "service poisoned")?;
        service.adapters()
    };
    let service = state.inner().clone();
    let app_handle = app.clone();
    let root_path = PathBuf::from(root);

    let summary = tauri::async_runtime::spawn_blocking(move || -> Result<ScanSummary, String> {
        let scanned = scanner.scan(&root_path);
        let total = scanned.files.len();
        let emit_progress = |count: usize| {
            let _ = app_handle.emit(
                ev::EVENT_LIBRARY_SCAN_PROGRESS,
                ScanProgressDto { scanned: count, total },
            );
        };

        let mut tracks = Vec::with_capacity(total);
        let mut warnings = scanned.warnings;
        for (index, path) in scanned.files.iter().enumerate() {
            match metadata.read_track(path) {
                Ok(track) => tracks.push(track),
                Err(err) => {
                    if warnings.len() < 100 {
                        warnings.push(format!("skipped '{}': {err}", path.display()));
                    }
                }
            }
            if index % 20 == 0 {
                emit_progress(index + 1);
            }
        }
        emit_progress(total);

        let mut service = service.lock().map_err(|_| "service poisoned".to_string())?;
        Ok(service.apply_scan(&root_path, total, tracks, warnings))
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = app.emit(ev::EVENT_LIBRARY_UPDATED, &summary);
    Ok(summary)
}

/// Lists tracks matching the query.
#[tauri::command]
pub fn get_tracks(
    state: State<'_, SharedService>,
    query: Option<TrackQuery>,
) -> Result<Vec<Track>, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    Ok(service.query_tracks(&query.unwrap_or_default()))
}

/// Lyrics associated with a track (sibling `.lrc` file, parsed).
/// `null` = no lyric file exists for this track.
#[tauri::command]
pub fn lyrics_get(
    state: State<'_, SharedService>,
    track_id: TrackId,
) -> Result<Option<LyricsDto>, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    map(service.lyrics_for_track(&track_id))
}

// ----- playback -----

#[tauri::command]
pub fn player_state(state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    Ok(service.state())
}

#[tauri::command]
pub fn player_load(
    app: AppHandle,
    state: State<'_, SharedService>,
    ids: Vec<TrackId>,
    start_index: Option<usize>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.play_queue(ids, start_index))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_toggle(app: AppHandle, state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.toggle())?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_pause(app: AppHandle, state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    service.pause();
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_resume(app: AppHandle, state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    service.resume();
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_stop(app: AppHandle, state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    service.stop();
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_next(app: AppHandle, state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.next())?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_prev(app: AppHandle, state: State<'_, SharedService>) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.previous())?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_seek(
    app: AppHandle,
    state: State<'_, SharedService>,
    secs: f64,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.seek(secs))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_set_volume(
    app: AppHandle,
    state: State<'_, SharedService>,
    volume: f32,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.set_volume(volume))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_set_mode(
    app: AppHandle,
    state: State<'_, SharedService>,
    shuffle: Option<bool>,
    repeat: Option<RepeatMode>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    if let Some(on) = shuffle {
        service.set_shuffle(on);
    }
    if let Some(mode) = repeat {
        service.set_repeat(mode);
    }
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

// ----- playlists -----

#[tauri::command]
pub fn playlist_list(state: State<'_, SharedService>) -> Result<Vec<Playlist>, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    Ok(service.playlists())
}

#[tauri::command]
pub fn playlist_create(
    state: State<'_, SharedService>,
    name: String,
) -> Result<Playlist, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.create_playlist(&name))
}

#[tauri::command]
pub fn playlist_rename(
    state: State<'_, SharedService>,
    id: String,
    new_name: String,
) -> Result<(), String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.rename_playlist(&id, &new_name))
}

#[tauri::command]
pub fn playlist_delete(state: State<'_, SharedService>, id: String) -> Result<(), String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.delete_playlist(&id))
}

#[tauri::command]
pub fn playlist_add_track(
    state: State<'_, SharedService>,
    id: String,
    track_id: TrackId,
) -> Result<bool, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.add_track_to_playlist(&id, track_id))
}

#[tauri::command]
pub fn playlist_remove_track(
    state: State<'_, SharedService>,
    id: String,
    track_id: String,
) -> Result<(), String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.remove_track_from_playlist(&id, &track_id))
}

#[tauri::command]
pub fn playlist_move_track(
    state: State<'_, SharedService>,
    id: String,
    from: usize,
    to: usize,
) -> Result<(), String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.move_track_in_playlist(&id, from, to))
}

#[tauri::command]
pub fn playlist_get_tracks(
    state: State<'_, SharedService>,
    id: String,
) -> Result<Vec<Track>, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    service
        .playlist_tracks(&id)
        .ok_or_else(|| "playlist not found".to_string())
}

// ----- settings -----

#[tauri::command]
pub fn settings_get(state: State<'_, SharedService>) -> Result<Settings, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    Ok(service.settings())
}

/// Partial settings update (the `player_set_mode` pattern: only provided
/// fields change). Currently `close_to_tray` is the only mutable field.
#[tauri::command]
pub fn settings_set(
    state: State<'_, SharedService>,
    close_to_tray: Option<bool>,
) -> Result<Settings, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    if let Some(on) = close_to_tray {
        service.set_close_to_tray(on);
    }
    Ok(service.settings())
}

// ----- tray -----

/// Pushes localized menu strings from the frontend i18n catalogue into the
/// native tray menu (display-layer translation; see `app::tray`).
#[tauri::command]
pub fn tray_set_labels(
    state: State<'_, Mutex<TrayController>>,
    labels: TrayLabels,
) -> Result<(), String> {
    let mut tray = state.lock().map_err(|_| "tray poisoned")?;
    tray.set_labels(labels);
    Ok(())
}
