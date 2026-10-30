//! Domain layer: pure business logic with zero IO.
//!
//! Everything in this module must be deterministically unit-testable; adapters
//! live in `crate::infra` and orchestration in `crate::app`.

pub mod library;
pub mod playlist;
pub mod queue;
pub mod scan;
pub mod track;
