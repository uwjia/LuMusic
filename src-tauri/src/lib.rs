//! LuMusic backend crate root.
//!
//! Layering (dependencies point downwards only):
//!
//! ```text
//! app    - Tauri commands + service orchestration + app state
//! infra  - IO adapters (filesystem, tags, audio engine, persistence)
//! domain - pure business logic (no IO, fully unit-tested)
//! ```

pub mod app;
pub mod domain;
pub mod events;
pub mod infra;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, Wry};

use app::commands::emit_state;
use app::dto::ProgressDto;
use app::service::PollOutcome;
use app::state::SharedService;
use app::tray::{self, TrayController, TrayLabels};
use events as ev;

/// Boots the Tauri application: state, tray, command handlers, poller thread.
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lumusic_lib=info,tauri=warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app::commands::app_info,
            app::commands::scan_library,
            app::commands::get_tracks,
            app::commands::player_state,
            app::commands::player_load,
            app::commands::player_toggle,
            app::commands::player_pause,
            app::commands::player_resume,
            app::commands::player_stop,
            app::commands::player_next,
            app::commands::player_prev,
            app::commands::player_seek,
            app::commands::player_set_volume,
            app::commands::player_set_mode,
            app::commands::playlist_list,
            app::commands::playlist_create,
            app::commands::playlist_rename,
            app::commands::playlist_delete,
            app::commands::playlist_add_track,
            app::commands::playlist_remove_track,
            app::commands::playlist_move_track,
            app::commands::playlist_get_tracks,
            app::commands::settings_get,
            app::commands::settings_set,
            app::commands::tray_set_labels,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir is resolvable");
            let service = app::state::build(&data_dir).expect("service builds");
            app.manage(service);

            let poller_service = app.state::<SharedService>().inner().clone();

            // Tray: seeded from the restored session so the menu is correct
            // before the first IPC; labels start English and are localized
            // by the frontend right after mount (useTraySync).
            let initial_state = poller_service
                .lock()
                .expect("fresh service is not poisoned")
                .state();
            let controller =
                TrayController::build(app.handle(), TrayLabels::default(), initial_state)
                    .expect("tray builds");
            app.manage(Mutex::new(controller));
            app.on_menu_event(tray::handle_menu_event);
            app.on_tray_icon_event(tray::handle_tray_icon_event);

            let poller_app: tauri::AppHandle<Wry> = app.handle().clone();
            std::thread::Builder::new()
                .name("lumusic-poller".into())
                .spawn(move || poll_loop(poller_app, poller_service))
                .expect("poller thread starts");

            tracing::info!("LuMusic backend started");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Last-chance flush on quit: the periodic poller save may be
                // up to SESSION_SAVE_INTERVAL stale at this point.
                let close_to_tray = {
                    let service = window.state::<SharedService>();
                    let Ok(mut guard) = service.lock() else {
                        return;
                    };
                    guard.save_playback_session();
                    guard.settings().close_to_tray
                };
                if close_to_tray {
                    // Hide to the tray instead of exiting: playback keeps
                    // running and the tray restores the window.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // `code == None` means the last window closed (close-to-tray
            // off). Only the setting keeps the process alive in the tray.
            tauri::RunEvent::ExitRequested { code: None, api, .. } => {
                // The State guard must outlive the MutexGuard borrow.
                let close_to_tray = app
                    .try_state::<SharedService>()
                    .map(|service| {
                        service
                            .lock()
                            .map(|guard| guard.settings().close_to_tray)
                            .unwrap_or(false)
                    })
                    .unwrap_or(false);
                if close_to_tray {
                    api.prevent_exit();
                }
            }
            // Final flush for every exit path (quit from tray, plain exit).
            tauri::RunEvent::Exit => tray::flush_session(app),
            _ => {}
        });
}

/// Background tick (~10 Hz): auto-advance finished tracks, emit a state event
/// on changes and a throttled progress event (~4 Hz) while playing.
fn poll_loop(app: tauri::AppHandle<Wry>, service: SharedService) {
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    loop {
        std::thread::sleep(Duration::from_millis(100));

        let outcome = {
            let mut guard = match service.lock() {
                Ok(guard) => guard,
                Err(_) => return, // poisoned: stop the thread
            };
            guard.poll()
        };

        match outcome {
            PollOutcome::Unchanged => {}
            PollOutcome::Advanced | PollOutcome::Stopped | PollOutcome::Failed(_) => {
                if let Ok(guard) = service.lock() {
                    emit_state(&app, &guard);
                }
            }
        }

        if last_progress.elapsed() >= Duration::from_millis(250) {
            last_progress = Instant::now();
            if let Ok(guard) = service.lock() {
                let state = guard.state();
                if state.status == app::dto::PlaybackStatus::Playing {
                    let progress = ProgressDto {
                        position_secs: state.position_secs,
                        duration_secs: state.duration_secs,
                    };
                    let _ = app.emit(ev::EVENT_PLAYER_PROGRESS, progress);
                }
            }
        }
    }
}
