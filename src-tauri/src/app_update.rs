//! In-app updates.
//!
//! - Desktop: Tauri's updater reads `latest.json` from the latest published
//!   release, verifies the bundle against the updater public key in
//!   tauri.conf.json, installs it and asks for a restart.
//! - Android: the release APK is downloaded, checked against GitHub's SHA-256
//!   and handed to the system package installer, which also requires it to be
//!   signed with the installed app's key.
//! - iOS cannot install packages itself; the frontend opens the release page.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};

/// Progress sent to the frontend while an update downloads.
#[derive(Clone, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum UpdateProgress {
    /// Bytes so far, and the size when the server reports it.
    #[serde(rename_all = "camelCase")]
    Downloading { downloaded: u64, total: Option<u64> },
    /// Downloaded and verified; installing (desktop) or opening the system
    /// installer (Android).
    Installing,
}

/// How an update finished.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateOutcome {
    /// Installed; takes effect after `update_restart`. (Windows installers
    /// close the app themselves before this is returned.)
    #[cfg_attr(not(desktop), allow(dead_code))]
    Restart,
    /// The system installer is showing; it replaces the app when confirmed.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    Installer,
}

/// The platform package from the GitHub release (Android only).
#[derive(Deserialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[serde(rename_all = "camelCase")]
pub struct UpdatePackage {
    url: String,
    /// GitHub's asset digest, `sha256:<hex>`, when the release has one.
    sha256: Option<String>,
}

/// Errors the frontend recognises (see src/lib/update-installer.ts).
pub const UNAVAILABLE: &str = "UPDATE_UNAVAILABLE";
#[cfg(target_os = "android")]
pub const INSTALL_PERMISSION: &str = "INSTALL_PERMISSION_REQUIRED";

/// Only report progress every this many bytes, plus the final chunk.
#[cfg(any(desktop, target_os = "android"))]
const PROGRESS_STEP: u64 = 256 * 1024;

/// Downloads and installs `version`, reporting progress on `on_progress`.
#[tauri::command]
pub async fn update_install<R: Runtime>(
    app: AppHandle<R>,
    version: String,
    package: Option<UpdatePackage>,
    on_progress: Channel<UpdateProgress>,
) -> Result<UpdateOutcome, String> {
    if !is_release_version(&version) {
        return Err("Invalid version".into());
    }
    install(app, version, package, on_progress).await
}

/// Restarts into the installed update.
#[tauri::command]
pub fn update_restart<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

fn is_release_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 32
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

#[cfg(desktop)]
async fn install<R: Runtime>(
    app: AppHandle<R>,
    version: String,
    _package: Option<UpdatePackage>,
    progress: Channel<UpdateProgress>,
) -> Result<UpdateOutcome, String> {
    use tauri_plugin_updater::UpdaterExt;

    if !updater_configured(&app) {
        return Err(UNAVAILABLE.into());
    }
    // A release built without the updater key has no latest.json (HTTP 404).
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| format!("{UNAVAILABLE}: {error}"))?
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    if update.version.trim_start_matches('v') != version {
        return Err(format!(
            "The update server offers v{}, not v{version}",
            update.version
        ));
    }
    let reporter = progress.clone();
    let mut downloaded: u64 = 0;
    let mut reported: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                if downloaded - reported >= PROGRESS_STEP || Some(downloaded) == total {
                    reported = downloaded;
                    let _ = reporter.send(UpdateProgress::Downloading { downloaded, total });
                }
            },
            move || {
                let _ = progress.send(UpdateProgress::Installing);
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(UpdateOutcome::Restart)
}

/// Builds without a real updater public key cannot verify any bundle.
#[cfg(desktop)]
fn updater_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| key.len() > 32 && key != "KURIUME_UPDATER_PUBLIC_KEY")
}

#[cfg(target_os = "android")]
async fn install<R: Runtime>(
    app: AppHandle<R>,
    version: String,
    package: Option<UpdatePackage>,
    progress: Channel<UpdateProgress>,
) -> Result<UpdateOutcome, String> {
    let package = package.ok_or_else(|| UNAVAILABLE.to_string())?;
    if !is_release_apk(&package.url) {
        return Err("Updates are only downloaded from Kuriume's releases".into());
    }
    let expected = package.sha256.as_deref().map(parse_sha256).transpose()?;
    // Asks for "install unknown apps" before spending a download on it.
    let dir = tauri_plugin_mobile::update_dir(app.clone())
        .await
        .map_err(permission_error)?;
    let path = std::path::Path::new(&dir).join(format!("Kuriume-{version}.apk"));
    download(&package.url, &path, expected.as_deref(), &progress).await?;
    let _ = progress.send(UpdateProgress::Installing);
    tauri_plugin_mobile::install_package(app, path.to_string_lossy().into_owned())
        .await
        .map_err(permission_error)?;
    Ok(UpdateOutcome::Installer)
}

#[cfg(target_os = "android")]
fn permission_error(error: String) -> String {
    if error.contains(INSTALL_PERMISSION) {
        INSTALL_PERMISSION.to_string()
    } else {
        error
    }
}

#[cfg(not(any(desktop, target_os = "android")))]
async fn install<R: Runtime>(
    _app: AppHandle<R>,
    _version: String,
    _package: Option<UpdatePackage>,
    _progress: Channel<UpdateProgress>,
) -> Result<UpdateOutcome, String> {
    Err(UNAVAILABLE.into())
}

/// Release APKs, as named by scripts/package-artifacts.mjs. GitHub redirects
/// the download to its asset storage.
#[cfg(any(test, target_os = "android"))]
fn is_release_apk(url: &str) -> bool {
    let prefix = format!("{}/releases/download/", crate::app_commands::PROJECT_URL);
    url.strip_prefix(&prefix).is_some_and(|rest| {
        let mut parts = rest.split('/');
        matches!(
            (parts.next(), parts.next(), parts.next()),
            (Some(tag), Some(name), None)
                if tag.starts_with('v')
                    && name.starts_with("Kuriume-")
                    && name.ends_with("-android-arm64.apk")
                    && rest.chars().all(|c| c.is_ascii_alphanumeric() || "/-._".contains(c))
        )
    })
}

/// `sha256:<64 hex>` (GitHub's asset digest) to lowercase hex.
#[cfg(any(test, target_os = "android"))]
fn parse_sha256(digest: &str) -> Result<String, String> {
    let hex = digest
        .strip_prefix("sha256:")
        .unwrap_or(digest)
        .to_ascii_lowercase();
    if hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hex)
    } else {
        Err("Unrecognised package checksum".into())
    }
}

#[cfg(any(test, target_os = "android"))]
fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// Release APKs are tens of megabytes; refuse anything absurd.
#[cfg(target_os = "android")]
const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;

#[cfg(target_os = "android")]
async fn download(
    url: &str,
    path: &std::path::Path,
    expected: Option<&str>,
    progress: &Channel<UpdateProgress>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .user_agent(concat!("Kuriume/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?;
    let total = response.content_length();
    if total.is_some_and(|total| total > MAX_PACKAGE_BYTES) {
        return Err("The update package is too large".into());
    }
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|error| error.to_string())?;
    let mut hash = ring::digest::Context::new(&ring::digest::SHA256);
    let mut downloaded: u64 = 0;
    let mut reported: u64 = 0;
    let _ = progress.send(UpdateProgress::Downloading { downloaded, total });
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        downloaded += chunk.len() as u64;
        if downloaded > MAX_PACKAGE_BYTES {
            return Err("The update package is too large".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        if downloaded - reported >= PROGRESS_STEP || Some(downloaded) == total {
            reported = downloaded;
            let _ = progress.send(UpdateProgress::Downloading { downloaded, total });
        }
    }
    file.sync_all().await.map_err(|error| error.to_string())?;
    drop(file);
    if let Some(expected) = expected {
        if to_hex(hash.finish().as_ref()) != expected {
            let _ = tokio::fs::remove_file(path).await;
            return Err("The downloaded package is damaged (checksum mismatch)".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_release_apks_are_downloaded() {
        let base = "https://github.com/Twacqwq/Kuriume/releases/download";
        assert!(is_release_apk(&format!(
            "{base}/v0.3.0/Kuriume-0.3.0-android-arm64.apk"
        )));
        assert!(is_release_apk(&format!(
            "{base}/v0.3.0-beta.1/Kuriume-0.3.0-beta.1-android-arm64.apk"
        )));
        for url in [
            "https://evil.example/Kuriume-0.3.0-android-arm64.apk".to_string(),
            format!("{base}/v0.3.0/Kuriume-0.3.0-windows-x64.exe"),
            format!("{base}/v0.3.0/../x/Kuriume-0.3.0-android-arm64.apk"),
            format!("{base}/v0.3.0/Kuriume-0.3.0-android-arm64.apk?x=1"),
            format!("{base}/0.3.0/Kuriume-0.3.0-android-arm64.apk"),
        ] {
            assert!(!is_release_apk(&url), "{url}");
        }
    }

    #[test]
    fn digests_are_github_sha256() {
        let hex = "ab".repeat(32);
        assert_eq!(
            parse_sha256(&format!("sha256:{}", hex.to_uppercase())),
            Ok(hex.clone())
        );
        assert_eq!(parse_sha256(&hex), Ok(hex));
        assert!(parse_sha256("sha256:abc").is_err());
        assert_eq!(to_hex(&[0, 15, 255]), "000fff");
    }

    #[test]
    fn versions_are_plain_release_versions() {
        assert!(is_release_version("0.3.0"));
        assert!(is_release_version("0.3.0-beta.1"));
        assert!(!is_release_version("v0.3.0"));
        assert!(!is_release_version("../0.3.0"));
        assert!(!is_release_version(""));
    }
}
