//! Managed application state: builds the real service wiring.

use std::path::Path;
use std::sync::{Arc, Mutex};

use super::service::{PlayerError, PlayerService};
use crate::infra::audio::engine::{AudioEngine, NullEngine, RodioEngine};
use crate::infra::fs_scan::WalkdirScanner;
use crate::infra::metadata::LoftyMetadataReader;
use crate::infra::persistence::JsonPersistence;

/// Shared service handle managed by Tauri and the poller thread.
pub type SharedService = Arc<Mutex<PlayerService>>;

/// Assembles the production service. Falls back to a silent `NullEngine`
/// when no output device is available so the library still works.
pub fn build(data_dir: &Path) -> Result<SharedService, PlayerError> {
    let engine: Box<dyn AudioEngine> = match RodioEngine::new() {
        Ok(engine) => Box::new(engine),
        Err(err) => {
            tracing::warn!("no audio device ({err}); continuing without sound");
            Box::new(NullEngine::default())
        }
    };
    let service = PlayerService::new(
        engine,
        Arc::new(WalkdirScanner),
        Arc::new(LoftyMetadataReader),
        Arc::new(JsonPersistence::new(data_dir)),
    )?;
    Ok(Arc::new(Mutex::new(service)))
}
