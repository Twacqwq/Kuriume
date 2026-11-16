//! WebDAV sync: configuration, credentials, transport and the merge engine.
//!
//! Records are always merged by timestamp in both directions; `settings` follow
//! the direction the user picked. The transport (WebDAV) never interprets the
//! document; it only moves bytes.

pub mod backup;
pub mod config;
pub mod credentials;
pub mod engine;
pub mod lifecycle;
pub mod webdav;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;

/// Keyring service name; the account name is `credential_key`.
pub const KEYRING_SERVICE: &str = "kuriume-webdav";
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const MANUAL_BUDGET: Duration = Duration::from_secs(60);
pub const OPEN_BUDGET: Duration = Duration::from_secs(45);
pub const CLOSE_BUDGET: Duration = Duration::from_secs(8);
pub const BACKGROUND_BUDGET: Duration = Duration::from_secs(5);
pub const CONFLICT_RETRIES: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    ConfigMissing,
    NeedPassword,
    NotHttps,
    InvalidUrl,
    InvalidPath,
    Auth,
    Forbidden,
    NotFound,
    MkcolFailed,
    Conflict,
    TooLarge,
    Corrupt,
    SchemaTooNew,
    InsufficientStorage,
    Redirect,
    Tls,
    Timeout,
    Busy,
    UnsupportedPlatform,
    Keyring,
    Server,
    Network,
    Internal,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ConfigMissing => "config_missing",
            Self::NeedPassword => "need_password",
            Self::NotHttps => "not_https",
            Self::InvalidUrl => "invalid_url",
            Self::InvalidPath => "invalid_path",
            Self::Auth => "auth",
            Self::Forbidden => "forbidden",
            Self::NotFound => "not_found",
            Self::MkcolFailed => "mkcol_failed",
            Self::Conflict => "conflict",
            Self::TooLarge => "too_large",
            Self::Corrupt => "corrupt",
            Self::SchemaTooNew => "schema_too_new",
            Self::InsufficientStorage => "insufficient_storage",
            Self::Redirect => "redirect",
            Self::Tls => "tls",
            Self::Timeout => "timeout",
            Self::Busy => "busy",
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::Keyring => "keyring",
            Self::Server => "server",
            Self::Network => "network",
            Self::Internal => "internal",
        }
    }

    /// English fallback text. The UI localizes by `code`.
    pub fn message(self) -> &'static str {
        match self {
            Self::ConfigMissing => "No sync server is configured yet.",
            Self::NeedPassword => "Enter the password again to unlock the saved sync server.",
            Self::NotHttps => "Only HTTPS addresses are supported.",
            Self::InvalidUrl => "The server address is not a valid URL.",
            Self::InvalidPath => "The remote path must start with / and must not contain .. or //.",
            Self::Auth => "The username or password was rejected (401).",
            Self::Forbidden => "The server refused access (403).",
            Self::NotFound => "The remote file does not exist (404).",
            Self::MkcolFailed => "The remote folder could not be created.",
            Self::Conflict => "The file changed on another device; retry after syncing.",
            Self::TooLarge => "The remote file is larger than 32 MB.",
            Self::Corrupt => "The remote file is not a Kuriume records file; nothing was changed.",
            Self::SchemaTooNew => "The remote file comes from a newer version of Kuriume.",
            Self::InsufficientStorage => "The server is out of space (507).",
            Self::Redirect => "The server returned a redirect; check the address.",
            Self::Tls => "The TLS certificate was rejected.",
            Self::Timeout => "The sync did not finish in time.",
            Self::Busy => "A sync is already running.",
            Self::UnsupportedPlatform => "Sync is not supported on this platform yet.",
            Self::Keyring => "The system credential store is unavailable.",
            Self::Server => "The server returned an error.",
            Self::Network => "The server could not be reached.",
            Self::Internal => "The sync failed unexpectedly.",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Config,
    Mkcol,
    Head,
    Get,
    Parse,
    Backup,
    Merge,
    Export,
    Put,
}

#[derive(Debug, Clone)]
pub struct SyncError {
    pub code: Code,
    pub phase: Phase,
    pub detail: Option<String>,
}

impl SyncError {
    pub fn new(code: Code, phase: Phase) -> Self {
        Self {
            code,
            phase,
            detail: None,
        }
    }

    pub fn detail(code: Code, phase: Phase, detail: impl Into<String>) -> Self {
        Self {
            code,
            phase,
            detail: Some(detail.into()),
        }
    }

    pub fn payload(&self) -> SyncErrorPayload {
        SyncErrorPayload {
            code: self.code.as_str(),
            message: self.to_string(),
            phase: self.phase,
        }
    }
}

impl fmt::Display for SyncError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code.message())?;
        if let Some(detail) = &self.detail {
            write!(formatter, " ({detail})")?;
        }
        Ok(())
    }
}

impl std::error::Error for SyncError {}

#[derive(Debug, Clone, Serialize)]
pub struct SyncErrorPayload {
    pub code: &'static str,
    pub message: String,
    pub phase: Phase,
}

/// One-key guard so a manual run and a background run never overlap.
#[derive(Default)]
pub struct SyncGate {
    running: AtomicBool,
}

impl SyncGate {
    /// Returns `None` when another sync is already running.
    pub fn try_start(&self) -> Option<SyncGuard<'_>> {
        self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| SyncGuard { gate: self })
    }
}

pub struct SyncGuard<'a> {
    gate: &'a SyncGate,
}

impl Drop for SyncGuard<'_> {
    fn drop(&mut self) {
        self.gate.running.store(false, Ordering::Release);
    }
}
