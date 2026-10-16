//! Shared utilities for the VidGlyph commands layer.
//!
//! ## Contents
//!
//! | Item | Type | Description |
//! |------|------|-------------|
//! | [`TempFileGuard`] | struct | RAII temp-file auto-cleanup |
//! | [`uuid_v4()`] | fn | Cryptographically random UUID v4 string |
//! | [`run_command_with_timeout()`] | async fn | Execute a command with a hard timeout |
//!
//! FFmpeg / ffprobe output parsing lives in [`super::ffmpeg`].

pub mod shared;
pub mod shared_core;

use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

// ─── Temp file guard ─────────────────────────────────────────────────────────

/// RAII guard: automatically removes a temp file when dropped.
pub struct TempFileGuard(PathBuf);

impl TempFileGuard {
    pub fn new(path: PathBuf) -> Self {
        Self(path)
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_file(&self.0) {
            tracing::warn!("Failed to remove temp file {:?}: {}", self.0, e);
        }
    }
}

// ─── UUID ────────────────────────────────────────────────────────────────────

/// Generate a cryptographically random UUID v4 string.
pub fn uuid_v4() -> String {
    Uuid::new_v4().to_string()
}

// ─── Command execution ────────────────────────────────────────────────────────

/// Execute a command with a timeout, returning the output or a timeout error.
///
/// # Arguments
/// * `cmd` - Command name
/// * `args` - Command arguments
/// * `timeout_duration` - Maximum duration to wait
///
/// # Returns
/// * `Ok(Output)` if command succeeds within timeout
/// * `Err(String)` if command fails or times out
pub async fn run_command_with_timeout(
    cmd: &str,
    args: &[&str],
    timeout_duration: Duration,
) -> Result<std::process::Output, String> {
    let output = timeout(timeout_duration, Command::new(cmd).args(args).output())
        .await
        .map_err(|_| format!("Command '{}' timed out after {:?}", cmd, timeout_duration))?
        .map_err(|e| format!("Failed to execute '{}': {}", cmd, e))?;

    Ok(output)
}
