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

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, Wry};

use app::commands::emit_state;
use app::dto::ProgressDto;
use app::service::PollOutcome;
use app::state::SharedService;
use app::tray::{self, TrayController, TrayLabels};
use domain::scan::ScanSummary;
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
            app::commands::import_files,
            app::commands::get_tracks,
            app::commands::lyrics_get,
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
            app::commands::player_queue_get,
            app::commands::player_queue_insert_next,
            app::commands::player_queue_append,
            app::commands::player_queue_remove,
            app::commands::player_queue_jump,
            app::commands::playlist_list,
            app::commands::playlist_create,
            app::commands::playlist_rename,
            app::commands::playlist_delete,
            app::commands::playlist_add_track,
            app::commands::playlist_remove_track,
            app::commands::playlist_move_track,
            app::commands::playlist_get_tracks,
            app::commands::playlist_reveal_folder,
            app::commands::settings_get,
            app::commands::settings_set,
            app::commands::tray_set_labels,
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir is resolvable");
            let service = app::state::build(&data_dir).expect("service builds");
            app.manage(service);

            // Window geometry: restore while the window is still hidden
            // (`visible: false` in tauri.conf.json) so the configured
            // 1100x720 never flashes; the tracker is seeded with the
            // applied geometry and kept fresh by the window events below.
            let window = app
                .get_webview_window("main")
                .expect("main window is configured");
            let window_persistence: std::sync::Arc<dyn infra::persistence::Persistence> =
                std::sync::Arc::new(infra::persistence::JsonPersistence::new(&data_dir));
            app::window_state::restore(&window, window_persistence.as_ref());
            let saver = app::window_state::WindowStateSaver::start(window_persistence);
            saver.record(&window);
            app.manage(saver);
            let _ = window.show();

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

            // OS media session (SMTC/MPRIS): hardware media keys, lock
            // screen and headphone controls. Windows needs the native
            // window handle; other platforms pass None. Failures degrade
            // to "no OS integration", never a broken startup.
            #[cfg(windows)]
            let hwnd = window.hwnd().ok().map(|handle| handle.0 as *mut std::ffi::c_void);
            #[cfg(not(windows))]
            let hwnd = None;
            let initial_state = poller_service
                .lock()
                .expect("fresh service is not poisoned")
                .state();
            let media = app::media::MediaController::build(app.handle(), hwnd, &initial_state);
            app.manage(Mutex::new(media));

            // Library folder watcher: silent incremental merges (adds,
            // renames/moves, deletes) so the library never keeps dead
            // entries and new files appear without a manual rescan.
            // Seeded from the restored last folder; every later scan
            // switches the watched root.
            let watch = {
                let metadata = poller_service
                    .lock()
                    .expect("fresh service is not poisoned")
                    .adapters()
                    .1;
                let emit_app: tauri::AppHandle<Wry> = app.handle().clone();
                let emitter: std::sync::Arc<dyn Fn(&ScanSummary) + Send + Sync> =
                    std::sync::Arc::new(move |summary: &ScanSummary| {
                        // The existing event already reloads the library
                        // and playlists in the frontend (usePlayerEvents).
                        let _ = emit_app.emit(ev::EVENT_LIBRARY_UPDATED, summary);
                    });
                app::watch::LibraryWatch::start(metadata, poller_service.clone(), emitter)
            };
            if let Some(folder) = poller_service
                .lock()
                .expect("fresh service is not poisoned")
                .settings()
                .last_folder
            {
                let folder = PathBuf::from(&folder);
                if folder.is_dir() {
                    watch.set_root(&folder);
                }
            }
            app.manage(watch);

            let poller_app: tauri::AppHandle<Wry> = app.handle().clone();
            std::thread::Builder::new()
                .name("lumusic-poller".into())
                .spawn(move || poll_loop(poller_app, poller_service))
                .expect("poller thread starts");

            tracing::info!("LuMusic backend started");
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
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
                // Interactive resizing emits these continuously; the saver
                // coalesces them into one debounced disk write.
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    if let (Some(saver), Some(main)) = (
                        window.try_state::<app::window_state::WindowStateSaver>(),
                        window.app_handle().get_webview_window("main"),
                    ) {
                        saver.record(&main);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // `code == None` means the last window closed (close-to-tray
            // off). Only the setting keeps the process alive in the tray.
            tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } => {
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
            tauri::RunEvent::Exit => {
                tray::flush_session(app);
                app::window_state::flush(app);
            }
            _ => {}
        });
}

/// Background tick (~20 Hz base): auto-advance finished tracks, emit a
/// state event on changes, a throttled progress event (~4 Hz) and spectrum
/// frames (~20 Hz) while playing. The base tick exists for the spectrum;
/// playback polling keeps its original ~10 Hz cadence via tick division.
fn poll_loop(app: tauri::AppHandle<Wry>, service: SharedService) {
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let mut tick: u32 = 0;
    loop {
        std::thread::sleep(Duration::from_millis(50));
        tick = tick.wrapping_add(1);

        // Playback rules every 2 ticks (~10 Hz, unchanged behavior).
        if tick % 2 == 0 {
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
        }

        // Progress every 5 ticks (~4 Hz).
        if last_progress.elapsed() >= Duration::from_millis(250) {
            last_progress = Instant::now();
            if let Ok(guard) = service.lock() {
                let state = guard.state();
                if state.status == app::dto::PlaybackStatus::Playing {
                    let _ = app.emit(ev::EVENT_PLAYER_PROGRESS, ProgressDto::of(&state));
                    // Keeps the OS flyout timeline honest between
                    // transitions (seeks/track changes go through
                    // emit_state anyway).
                    app::media::publish(&app, &state);
                }
            }
        }

        // Spectrum every tick (~20 Hz), playing tracks only: paused or
        // stopped sessions emit nothing and the UI fades its bars to zero.
        if let Ok(mut guard) = service.lock() {
            if guard.status() == app::dto::PlaybackStatus::Playing {
                if let Some(frame) = guard.spectrum() {
                    let _ = app.emit(ev::EVENT_SPECTRUM, frame);
                }
            }
        }
    }
}
