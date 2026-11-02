//! OS shell integration: opening the system file manager at a folder.

use std::io;
use std::path::Path;

/// Reveals a folder in the OS file manager (Explorer / Finder / xdg-open).
/// A trait so the service layer can be tested without spawning processes.
pub trait FolderRevealer: Send + Sync {
    fn reveal(&self, path: &Path) -> io::Result<()>;
}

/// Real implementation: spawns the platform file manager and detaches.
/// Success only means "launched", never "window shown" — Explorer exits
/// whenever it feels like it, so the child process is never waited on.
pub struct SystemRevealer;

impl FolderRevealer for SystemRevealer {
    fn reveal(&self, path: &Path) -> io::Result<()> {
        #[cfg(windows)]
        const PROGRAM: &str = "explorer";
        #[cfg(target_os = "macos")]
        const PROGRAM: &str = "open";
        #[cfg(all(unix, not(target_os = "macos")))]
        const PROGRAM: &str = "xdg-open";
        std::process::Command::new(PROGRAM)
            .arg(path)
            .spawn()
            .map(|_| ())
    }
}
