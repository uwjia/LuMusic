//! Infrastructure layer: IO adapters behind traits so the app layer can be
//! tested with mocks (see `crate::app::service::tests`).

pub mod audio;
pub mod fs_scan;
pub mod lyrics;
pub mod metadata;
pub mod persistence;
