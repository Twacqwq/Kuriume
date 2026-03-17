use kuriume_store::{episode_path, MediaEntry, Settings, Store};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};

/// Tauri-managed wrapper around the SQLite store.
///
/// `rusqlite::Connection` is `!Send` on some platforms, so we protect it
/// with a `std::sync::Mutex` and run DB operations on the current thread.
/// All Tauri commands already run on a worker thread, so blocking is fine.
pub struct StoreState {
    inner: Mutex<Option<Store>>,
}

impl StoreState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Get or lazily initialise the store.
    fn with_store<F, R>(&self, app: &AppHandle, f: F) -> Result<R, String>
    where
        F: FnOnce(&Store) -> Result<R, String>,
    {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let db_path = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("kuriume.db");
            let store = Store::open(&db_path).map_err(|e| e.to_string())?;
            *guard = Some(store);
        }
        f(guard.as_ref().unwrap())
    }
}

impl Default for StoreState {
    fn default() -> Self {
        Self::new()
    }
}

/// Default cache directory: `{download_dir}/Kuriume`
fn default_cache_dir(app: &AppHandle) -> String {
    app.path()
        .download_dir()
        .map(|p| p.join("Kuriume"))
        .unwrap_or_else(|_| PathBuf::from("~/Downloads/Kuriume"))
        .to_string_lossy()
        .into_owned()
}

// ── Settings commands ────────────────────────────────────────────

#[command]
pub(crate) fn get_settings(
    state: State<'_, StoreState>,
    app: AppHandle,
) -> Result<Settings, String> {
    let default_dir = default_cache_dir(&app);
    state.with_store(&app, |store| {
        store.get_settings(&default_dir).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn set_cache_dir(
    state: State<'_, StoreState>,
    app: AppHandle,
    dir: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.set_cache_dir(dir).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn set_cache_enabled(
    state: State<'_, StoreState>,
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .set_cache_enabled(enabled)
            .map_err(|e| e.to_string())
    })
}

// ── Cache lookup / management commands ───────────────────────────

#[command]
pub(crate) fn cache_lookup(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
    episode: i32,
    group_name: Option<&str>,
    resolution: Option<&str>,
) -> Result<Option<MediaEntry>, String> {
    state.with_store(&app, |store| {
        let entry = store
            .lookup(bgm_id, episode, group_name, resolution)
            .map_err(|e| e.to_string())?;
        // Verify the file still exists on disk
        if let Some(ref e) = entry {
            if !std::path::Path::new(&e.file_path).exists() {
                // Stale entry — remove from DB
                eprintln!("[store] cached file missing, removing entry id={} path={}", e.id, e.file_path);
                let _ = store.remove_entry(e.id);
                return Ok(None);
            }
        }
        Ok(entry)
    })
}

/// Register a downloaded file into the cache.
///
/// Called by the torrent engine after a complete download.
#[command]
pub(crate) fn cache_register(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
    episode: i32,
    anime_title: &str,
    group_name: &str,
    resolution: &str,
    file_path: &str,
    file_size: i64,
    torrent_source: &str,
) -> Result<i64, String> {
    state.with_store(&app, |store| {
        store
            .upsert_entry(
                bgm_id,
                episode,
                anime_title,
                group_name,
                resolution,
                file_path,
                file_size,
                torrent_source,
            )
            .map_err(|e| e.to_string())
    })
}

/// Remove a single cache entry and delete the file.
#[command]
pub(crate) fn cache_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    id: i64,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        if let Some(path) = store.remove_entry(id).map_err(|e| e.to_string())? {
            let _ = std::fs::remove_file(&path);
        }
        Ok(())
    })
}

/// List all cached entries for an anime.
#[command]
pub(crate) fn cache_list(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
) -> Result<Vec<MediaEntry>, String> {
    state.with_store(&app, |store| {
        store
            .list_anime_entries(bgm_id)
            .map_err(|e| e.to_string())
    })
}

/// Get total cache size in bytes.
#[command]
pub(crate) fn cache_total_size(
    state: State<'_, StoreState>,
    app: AppHandle,
) -> Result<i64, String> {
    state.with_store(&app, |store| {
        store.total_cache_size().map_err(|e| e.to_string())
    })
}

/// Clear all cache entries and delete all cached files.
/// Optionally also clears torrent temp files.
#[command]
pub(crate) fn cache_clear_all(
    state: State<'_, StoreState>,
    app: AppHandle,
    include_temp: Option<bool>,
) -> Result<(), String> {
    // Get the cache directory before clearing DB entries
    let cache_dir = state.with_store(&app, |store| {
        let settings = store
            .get_settings(&default_cache_dir(&app))
            .map_err(|e| e.to_string())?;
        let _ = store.clear_all().map_err(|e| e.to_string())?;
        Ok(PathBuf::from(settings.cache_dir))
    })?;

    // Remove the entire cache directory and recreate it —
    // this ensures no orphaned files or empty folders remain.
    if cache_dir.exists() {
        let _ = std::fs::remove_dir_all(&cache_dir);
        let _ = std::fs::create_dir_all(&cache_dir);
    }

    // Also clear torrent temp directory if requested
    if include_temp.unwrap_or(false) {
        let temp_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("torrents");
        if temp_dir.exists() {
            let _ = std::fs::remove_dir_all(&temp_dir);
            let _ = std::fs::create_dir_all(&temp_dir);
        }
    }

    Ok(())
}

/// Move a downloaded file from the torrent temp dir into the organized cache directory,
/// register it in the database, and return the new path + entry id.
///
/// Target layout: `{cache_dir}/{anime_title}/{anime_title} - S01E{ep:02} [{group}] [{resolution}].ext`
#[command]
pub(crate) fn cache_organize(
    state: State<'_, StoreState>,
    app: AppHandle,
    source_path: &str,
    bgm_id: &str,
    episode: i32,
    anime_title: &str,
    group_name: &str,
    resolution: &str,
    torrent_source: &str,
) -> Result<MediaEntry, String> {
    state.with_store(&app, |store| {
        let settings = store
            .get_settings(&default_cache_dir(&app))
            .map_err(|e| e.to_string())?;

        if !settings.cache_enabled {
            return Err("cache is disabled".into());
        }

        let src = Path::new(source_path);
        if !src.exists() {
            return Err(format!("source file not found: {source_path}"));
        }

        let original_filename = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("video.mkv");

        let dest = episode_path(
            Path::new(&settings.cache_dir),
            anime_title,
            episode,
            group_name,
            resolution,
            original_filename,
        );

        // Create parent directories
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create cache dir: {e}"))?;
        }

        // Move (rename) or copy+delete
        if std::fs::rename(src, &dest).is_err() {
            std::fs::copy(src, &dest)
                .map_err(|e| format!("failed to copy to cache: {e}"))?;
            let _ = std::fs::remove_file(src);
        }

        let file_size = std::fs::metadata(&dest)
            .map(|m| m.len() as i64)
            .unwrap_or(0);

        let dest_str = dest.to_string_lossy();
        let id = store
            .upsert_entry(
                bgm_id,
                episode,
                anime_title,
                group_name,
                resolution,
                &dest_str,
                file_size,
                torrent_source,
            )
            .map_err(|e| e.to_string())?;

        Ok(MediaEntry {
            id,
            bgm_id: bgm_id.to_string(),
            episode,
            anime_title: anime_title.to_string(),
            group_name: group_name.to_string(),
            resolution: resolution.to_string(),
            file_path: dest_str.into_owned(),
            file_size,
            torrent_source: torrent_source.to_string(),
            cached_at: String::new(),
        })
    })
}
