//! Thin Tauri commands: lock the service, call one method, map errors,
//! emit state events. No business logic lives here.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use super::dto::{LyricsDto, PlayerStateDto, QueueDto, ScanProgressDto};
use super::service::{PlayerError, PlayerService};
use super::state::SharedService;
use super::tray::{TrayController, TrayLabels};
use crate::domain::equalizer::EqSettings;
use crate::domain::library::{ImportSummary, TrackQuery};
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
/// menu/tooltip and the OS media session in the same step, so every
/// surface stays consistent.
pub fn emit_state(app: &AppHandle, service: &PlayerService) {
    let state = service.state();
    if let Some(tray) = app.try_state::<Mutex<TrayController>>() {
        if let Ok(mut controller) = tray.lock() {
            controller.update_player_state(&state);
        }
    }
    super::media::publish(app, &state);
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
    // The blocking closure owns its copy; `root_path` stays for the
    // watcher retarget below.
    let scan_root = root_path.clone();

    let summary = tauri::async_runtime::spawn_blocking(move || -> Result<ScanSummary, String> {
        let scanned = scanner.scan(&scan_root);
        let total = scanned.files.len();
        let emit_progress = |count: usize| {
            let _ = app_handle.emit(
                ev::EVENT_LIBRARY_SCAN_PROGRESS,
                ScanProgressDto {
                    scanned: count,
                    total,
                },
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
        Ok(service.apply_scan(&scan_root, total, tracks, warnings))
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = app.emit(ev::EVENT_LIBRARY_UPDATED, &summary);
    // The scan defines what "the library folder" means: retarget the
    // watcher so subsequent disk changes merge silently.
    if let Some(watch) = app.try_state::<super::watch::LibraryWatch>() {
        watch.set_root(&root_path);
    }
    Ok(summary)
}

/// Imports files dropped onto the window (drag-and-drop from the file
/// manager) into the library, optionally appending them to a playlist.
///
/// Same two-phase shape as `scan_library`: metadata reads (potentially
/// slow disk IO) run on a blocking thread without the service lock, the
/// merge step locks briefly. No event is emitted — the command's response
/// drives the caller's refresh.
#[tauri::command]
pub async fn import_files(
    state: State<'_, SharedService>,
    paths: Vec<String>,
    playlist_id: Option<String>,
) -> Result<ImportSummary, String> {
    let (_scanner, metadata) = {
        let service = state.lock().map_err(|_| "service poisoned")?;
        service.adapters()
    };
    let service = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportSummary, String> {
        let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let (tracks, warnings) = PlayerService::read_import_files(metadata.as_ref(), &path_bufs);
        let mut service = service.lock().map_err(|_| "service poisoned".to_string())?;
        service.apply_import(tracks, warnings, playlist_id.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
    source_playlist_id: Option<String>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.play_queue(ids, start_index, source_playlist_id))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_toggle(
    app: AppHandle,
    state: State<'_, SharedService>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.toggle())?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_pause(
    app: AppHandle,
    state: State<'_, SharedService>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    service.pause();
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_resume(
    app: AppHandle,
    state: State<'_, SharedService>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    service.resume();
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_stop(
    app: AppHandle,
    state: State<'_, SharedService>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    service.stop();
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_next(
    app: AppHandle,
    state: State<'_, SharedService>,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.next())?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

#[tauri::command]
pub fn player_prev(
    app: AppHandle,
    state: State<'_, SharedService>,
) -> Result<PlayerStateDto, String> {
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

// ----- queue editing (queue panel / track context menu) -----

/// Queue contents for the play-queue panel.
#[tauri::command]
pub fn player_queue_get(state: State<'_, SharedService>) -> Result<QueueDto, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    Ok(service.queue_tracks())
}

/// Queues a track to play right after the current one (starts playback
/// when the queue is empty).
#[tauri::command]
pub fn player_queue_insert_next(
    app: AppHandle,
    state: State<'_, SharedService>,
    track_id: TrackId,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.queue_insert_next(track_id))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

/// Appends a track to the end of the queue.
#[tauri::command]
pub fn player_queue_append(
    app: AppHandle,
    state: State<'_, SharedService>,
    track_id: TrackId,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.queue_append(track_id))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

/// Removes an upcoming queue item (the playing row is rejected).
#[tauri::command]
pub fn player_queue_remove(
    app: AppHandle,
    state: State<'_, SharedService>,
    index: usize,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.queue_remove(index))?;
    let dto = service.state();
    emit_state(&app, &service);
    Ok(dto)
}

/// Jumps playback to a queue row.
#[tauri::command]
pub fn player_queue_jump(
    app: AppHandle,
    state: State<'_, SharedService>,
    index: usize,
) -> Result<PlayerStateDto, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    map(service.queue_jump(index))?;
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
pub fn playlist_create(state: State<'_, SharedService>, name: String) -> Result<Playlist, String> {
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

/// Reveals the folder an auto playlist maps to in the OS file manager.
/// The backend re-derives the path from the playlist id (the UI's offer of
/// the action is a convenience, never a trusted input).
#[tauri::command]
pub fn playlist_reveal_folder(
    state: State<'_, SharedService>,
    id: String,
) -> Result<(), String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    map(service.reveal_playlist_folder(&id))
}

// ----- settings -----

#[tauri::command]
pub fn settings_get(state: State<'_, SharedService>) -> Result<Settings, String> {
    let service = state.lock().map_err(|_| "service poisoned")?;
    Ok(service.settings())
}

/// Partial settings update (the `player_set_mode` pattern: only provided
/// fields change). `eq` carries the full equalizer configuration because a
/// curve is meaningless without all its bands.
#[tauri::command]
pub fn settings_set(
    state: State<'_, SharedService>,
    close_to_tray: Option<bool>,
    eq: Option<EqSettings>,
) -> Result<Settings, String> {
    let mut service = state.lock().map_err(|_| "service poisoned")?;
    if let Some(on) = close_to_tray {
        service.set_close_to_tray(on);
    }
    if let Some(eq) = eq {
        service.set_eq(eq);
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
