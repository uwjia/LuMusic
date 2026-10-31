//! Domain layer: pure business logic with zero IO.
//!
//! Everything in this module must be deterministically unit-testable; adapters
//! live in `crate::infra` and orchestration in `crate::app`.

pub mod encoding;
pub mod equalizer;
pub mod library;
pub mod lyrics;
pub mod playlist;
pub mod queue;
pub mod scan;
pub mod session;
pub mod settings;
pub mod track;
