//! Window geometry persistence: remembers size / position / maximized
//! across restarts (the behavior of `tauri-plugin-window-state`, kept
//! in-tree to honor the zero-extra-dependency rule and reuse the JSON
//! persistence layer).
//!
//! Restore happens in `setup` while the window is still hidden
//! (`visible: false` in tauri.conf.json), so the configured 1100x720
//! never flashes before the saved geometry is applied. Saving is driven
//! by `Resized` / `Moved` window events and debounced — an interactive
//! drag emits dozens of events per second, but only one disk write
//! happens after the movement stays quiet for `SAVE_QUIET`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow, Wry};

use crate::domain::window::WindowGeometry;
use crate::infra::persistence::Persistence;

/// How long the window must stay quiet before the queued geometry is
/// written; also the poll cadence of the saver thread.
const SAVE_QUIET: Duration = Duration::from_millis(500);

/// Latest sampled geometry plus the "write me" flag shared with the
/// saver thread.
struct Tracked {
    geometry: WindowGeometry,
    dirty: bool,
    last_change: Instant,
}

impl Default for Tracked {
    fn default() -> Self {
        Self {
            geometry: WindowGeometry::default(),
            dirty: false,
            last_change: Instant::now(),
        }
    }
}

/// Samples the main window and persists its geometry (debounced).
/// Managed as Tauri state so the window-event hook and the exit path
/// share one instance.
pub struct WindowStateSaver {
    tracked: Arc<Mutex<Tracked>>,
    persistence: Arc<dyn Persistence>,
}

impl WindowStateSaver {
    /// Starts the background saver thread. Call [`Self::record`] once
    /// right after startup so the tracker holds the real (restored)
    /// geometry — a flush without any recorded sample would otherwise
    /// overwrite the persisted state with the placeholder default.
    pub fn start(persistence: Arc<dyn Persistence>) -> Self {
        let tracked: Arc<Mutex<Tracked>> = Arc::new(Mutex::new(Tracked::default()));
        let thread_tracked = tracked.clone();
        let thread_persistence = persistence.clone();
        std::thread::Builder::new()
            .name("lumusic-window-state".into())
            .spawn(move || loop {
                std::thread::sleep(SAVE_QUIET);
                // Write only when a change has settled: `dirty` keeps
                // flipping during an interactive drag, and the write
                // happens once the movement stayed quiet.
                let due = {
                    let Ok(mut guard) = thread_tracked.lock() else {
                        return; // poisoned: stop the thread
                    };
                    if !guard.dirty || guard.last_change.elapsed() < SAVE_QUIET {
                        continue;
                    }
                    guard.dirty = false;
                    guard.geometry
                };
                if let Err(err) = thread_persistence.save_window(&due) {
                    tracing::warn!("failed to persist window geometry: {err}");
                }
            })
            .expect("window-state thread starts");
        Self {
            tracked,
            persistence,
        }
    }

    /// Samples the window and marks the geometry pending. Maximized
    /// snapshots only refresh the flag: the OS reports the maximized
    /// bounds, and overwriting width/height with them would lose the
    /// geometry a restore-down should return to.
    pub fn record(&self, window: &WebviewWindow<Wry>) {
        // A failing query (rare) keeps the previous sample: skipping one
        // event is harmless, recording garbage is not.
        let (Ok(size), Ok(position), Ok(maximized)) =
            (window.inner_size(), window.outer_position(), window.is_maximized())
        else {
            return;
        };
        let mut guard = self.tracked.lock().expect("window-state lock");
        guard.geometry.maximized = maximized;
        if !maximized {
            guard.geometry.width = size.width;
            guard.geometry.height = size.height;
            guard.geometry.x = position.x;
            guard.geometry.y = position.y;
        }
        guard.dirty = true;
        guard.last_change = Instant::now();
    }

    /// Synchronous final save for every exit path (window close, quit
    /// from the tray, OS shutdown) — the debounced thread may not get
    /// another tick before the process ends.
    pub fn flush(&self) {
        let geometry = self.tracked.lock().expect("window-state lock").geometry;
        if let Err(err) = self.persistence.save_window(&geometry) {
            tracing::warn!("failed to persist window geometry: {err}");
        }
    }
}

/// Applies the persisted geometry to the window, if one exists and is
/// usable. Positions from a monitor layout that no longer exists (e.g.
/// an unplugged second screen) are dropped so the window never restores
/// out of sight; the size still applies.
pub fn restore(window: &WebviewWindow<Wry>, persistence: &dyn Persistence) {
    let saved = match persistence.load_window() {
        Ok(Some(geometry)) => geometry,
        Ok(None) => return,
        Err(err) => {
            // A broken window.json costs at most the geometry convenience.
            tracing::warn!("ignoring unreadable window geometry: {err}");
            return;
        }
    };
    let Some(saved) = saved.sanitized() else {
        return;
    };
    if position_is_visible(window, &saved) {
        let _ = window.set_position(tauri::PhysicalPosition::new(saved.x, saved.y));
    }
    let _ = window.set_size(tauri::PhysicalSize::new(saved.width, saved.height));
    if saved.maximized {
        let _ = window.maximize();
    }
}

/// Whether the saved top-left corner lands on any connected monitor.
fn position_is_visible(window: &WebviewWindow<Wry>, geometry: &WindowGeometry) -> bool {
    match window.available_monitors() {
        Ok(monitors) => monitors.iter().any(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            geometry.x >= position.x
                && geometry.y >= position.y
                && geometry.x < position.x + size.width as i32
                && geometry.y < position.y + size.height as i32
        }),
        // Cannot query the layout: keep the saved position rather than
        // silently discarding it.
        Err(_) => true,
    }
}

/// Flush hook for `RunEvent::Exit` (next to the session flush).
pub fn flush(app: &AppHandle<Wry>) {
    if let Some(saver) = app.try_state::<WindowStateSaver>() {
        saver.flush();
    }
}
