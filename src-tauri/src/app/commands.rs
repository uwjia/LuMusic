//! Thin Tauri commands. They only translate to/from the service layer so the
//! behavior itself stays unit-testable without a WebView.

use serde_json::Value;

/// Returns build metadata for the frontend (about dialog / diagnostics).
#[tauri::command]
pub fn app_info() -> Value {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
    })
}
