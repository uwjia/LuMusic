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
pub mod events;

/// Boots the Tauri application: plugins, state, command handlers.
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lumusic_lib=info,tauri=warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![app::commands::app_info])
        .setup(|_app| {
            tracing::info!("LuMusic backend started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
