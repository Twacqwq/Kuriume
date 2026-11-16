//! Password storage. Desktop uses the platform credential store through the
//! `keyring` crate; Android and iOS use the native bridge (Keystore-encrypted
//! preferences and the Keychain) so the password never enters SQLite.

use super::{Code, Phase, SyncError};

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod platform {
    use super::super::KEYRING_SERVICE;
    use super::{Code, Phase, SyncError};

    fn entry(account: &str) -> Result<keyring::Entry, SyncError> {
        keyring::Entry::new(KEYRING_SERVICE, account)
            .map_err(|_| SyncError::new(Code::Keyring, Phase::Config))
    }

    pub fn has_password(_app: &tauri::AppHandle, account: &str) -> bool {
        if account.is_empty() {
            return false;
        }
        entry(account)
            .and_then(|entry| {
                entry
                    .get_password()
                    .map_err(|_| SyncError::new(Code::Keyring, Phase::Config))
            })
            .is_ok()
    }

    pub fn load(_app: &tauri::AppHandle, account: &str) -> Result<String, SyncError> {
        if account.is_empty() {
            return Err(SyncError::new(Code::NeedPassword, Phase::Config));
        }
        match entry(account)?.get_password() {
            Ok(password) if !password.is_empty() => Ok(password),
            Ok(_) => Err(SyncError::new(Code::NeedPassword, Phase::Config)),
            Err(keyring::Error::NoEntry) => Err(SyncError::new(Code::NeedPassword, Phase::Config)),
            Err(_) => Err(SyncError::new(Code::Keyring, Phase::Config)),
        }
    }

    pub fn save(_app: &tauri::AppHandle, account: &str, password: &str) -> Result<(), SyncError> {
        if account.is_empty() || password.is_empty() {
            return Err(SyncError::new(Code::NeedPassword, Phase::Config));
        }
        entry(account)?
            .set_password(password)
            .map_err(|_| SyncError::new(Code::Keyring, Phase::Config))
    }

    pub fn clear(_app: &tauri::AppHandle, account: &str) {
        if account.is_empty() {
            return;
        }
        if let Ok(entry) = entry(account) {
            let _ = entry.delete_credential();
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod platform {
    use super::{Code, Phase, SyncError};
    use tauri::AppHandle;

    fn bridge(error: String) -> SyncError {
        SyncError::detail(Code::Keyring, Phase::Config, error)
    }

    fn checked(account: &str) -> Result<&str, SyncError> {
        if account.is_empty() {
            return Err(SyncError::new(Code::NeedPassword, Phase::Config));
        }
        Ok(account)
    }

    pub fn has_password(app: &AppHandle, account: &str) -> bool {
        load(app, account).is_ok()
    }

    pub fn load(app: &AppHandle, account: &str) -> Result<String, SyncError> {
        let account = checked(account)?;
        match tauri_plugin_mobile::password_get(app, account) {
            Ok(Some(password)) if !password.is_empty() => Ok(password),
            Ok(_) => Err(SyncError::new(Code::NeedPassword, Phase::Config)),
            Err(error) => Err(bridge(error)),
        }
    }

    pub fn save(app: &AppHandle, account: &str, password: &str) -> Result<(), SyncError> {
        let account = checked(account)?;
        if password.is_empty() {
            return Err(SyncError::new(Code::NeedPassword, Phase::Config));
        }
        tauri_plugin_mobile::password_set(app, account, password).map_err(bridge)
    }

    pub fn clear(app: &AppHandle, account: &str) {
        if !account.is_empty() {
            let _ = tauri_plugin_mobile::password_clear(app, account);
        }
    }
}

// Linux has no native backend yet; the platform check rejects it before use.
#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "android",
    target_os = "ios"
)))]
mod platform {
    use super::{Code, Phase, SyncError};

    pub fn has_password(_app: &tauri::AppHandle, _account: &str) -> bool {
        false
    }

    pub fn load(_app: &tauri::AppHandle, _account: &str) -> Result<String, SyncError> {
        Err(SyncError::new(Code::UnsupportedPlatform, Phase::Config))
    }

    pub fn save(_app: &tauri::AppHandle, _account: &str, _password: &str) -> Result<(), SyncError> {
        Err(SyncError::new(Code::UnsupportedPlatform, Phase::Config))
    }

    pub fn clear(_app: &tauri::AppHandle, _account: &str) {}
}

pub use platform::{clear, has_password, load, save};

/// Kept so callers can report the platform limitation consistently.
pub fn platform_supported() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "android",
        target_os = "ios"
    ))
}

pub fn unsupported() -> SyncError {
    SyncError::new(Code::UnsupportedPlatform, Phase::Config)
}
