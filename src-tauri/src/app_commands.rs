//! App-level commands: opening the project's own GitHub pages outside the app.

/// The project's GitHub home; releases and downloads live underneath it.
pub const PROJECT_URL: &str = "https://github.com/Twacqwq/Kuriume";

/// Only the project page and paths below it (releases, release assets) may be
/// opened, so a compromised page cannot launch arbitrary URLs or programs.
fn is_project_url(url: &str) -> bool {
    match url.strip_prefix(PROJECT_URL) {
        Some("") => true,
        Some(rest) => {
            rest.starts_with('/')
                && rest.len() <= 512
                && rest
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "/-._~%+?=&#".contains(c))
        }
        None => false,
    }
}

/// Opens a project URL in the system browser.
#[tauri::command]
pub async fn open_external<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    url: String,
) -> Result<(), String> {
    if !is_project_url(&url) {
        return Err("Only Kuriume's project pages can be opened".into());
    }
    #[cfg(mobile)]
    {
        tauri_plugin_mobile::open_url(app, url).await
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        open_on_desktop(&url)
    }
}

#[cfg(not(mobile))]
fn open_on_desktop(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not open the browser: {error}"))?;
    // Reap the launcher so it does not linger as a zombie process.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_project_url;

    #[test]
    fn only_project_pages_can_be_opened() {
        assert!(is_project_url("https://github.com/Twacqwq/Kuriume"));
        assert!(is_project_url(
            "https://github.com/Twacqwq/Kuriume/releases/tag/v0.2.0"
        ));
        assert!(is_project_url(
            "https://github.com/Twacqwq/Kuriume/releases/download/v0.2.0/Kuriume-0.2.0-12-android-arm64.apk"
        ));
        assert!(!is_project_url("https://github.com/Twacqwq/KuriumeEvil"));
        assert!(!is_project_url("https://github.com/other/repo"));
        assert!(!is_project_url("http://github.com/Twacqwq/Kuriume"));
        assert!(!is_project_url("https://github.com/Twacqwq/Kuriume/\"evil"));
        assert!(!is_project_url("https://github.com/Twacqwq/Kuriume/ x"));
        assert!(!is_project_url("file:///etc/passwd"));
    }
}

/// The player's system fullscreen on macOS: simple fullscreen, without a new
/// Space or its animation, so the video (and Anime4K) resize once instead of
/// on every animation frame. The menu bar and Dock hide; the traffic lights,
/// which simple fullscreen keeps, are hidden too. Other platforms use their
/// ordinary (already instant) fullscreen.
#[cfg(desktop)]
#[tauri::command]
pub fn player_simple_fullscreen(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::fullscreen_macos::set_window_buttons_hidden(&window, enabled)
        .map_err(|error| error.to_string())?;
    window
        .set_simple_fullscreen(enabled)
        .map_err(|error| error.to_string())
}

#[cfg(mobile)]
#[tauri::command]
pub fn player_simple_fullscreen(enabled: bool) -> Result<(), String> {
    let _ = enabled;
    Err("Simple fullscreen is a desktop feature".into())
}
