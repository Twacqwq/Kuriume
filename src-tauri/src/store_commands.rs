use kuriume_store::{episode_path, MediaEntry, Settings, Store, WatchHistoryEntry, WatchStatus, WatchlistEntry};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};

/// Tauri-managed wrapper around the SQLite store.
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

/// Change cache directory and optionally migrate existing files.
#[command]
pub(crate) fn cache_migrate_dir(
    state: State<'_, StoreState>,
    app: AppHandle,
    new_dir: &str,
    migrate: bool,
) -> Result<(), String> {
    let old_dir = state.with_store(&app, |store| {
        let settings = store
            .get_settings(&default_cache_dir(&app))
            .map_err(|e| e.to_string())?;
        Ok(settings.cache_dir)
    })?;

    if migrate && old_dir != new_dir {
        let old_path = Path::new(&old_dir);
        let new_path = Path::new(new_dir);

        state.with_store(&app, |store| {
            let entries = store.list_all_entries().map_err(|e| e.to_string())?;
            for entry in &entries {
                let file = Path::new(&entry.file_path);
                // Only migrate files that live under the old cache dir
                if let Ok(rel) = file.strip_prefix(old_path) {
                    let dest = new_path.join(rel);
                    if let Some(parent) = dest.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    // Try rename first (fast, same filesystem), fall back to copy
                    if std::fs::rename(file, &dest).is_ok()
                        || std::fs::copy(file, &dest)
                            .map(|_| { let _ = std::fs::remove_file(file); })
                            .is_ok()
                    {
                        let _ = store.update_file_path(
                            entry.id,
                            &dest.to_string_lossy(),
                        );
                    }
                }
            }
            Ok(())
        })?;

        // Clean up empty directories in old cache
        if old_path.exists() {
            let _ = std::fs::remove_dir_all(old_path);
        }
    }

    // Update the setting
    state.with_store(&app, |store| {
        store.set_cache_dir(new_dir).map_err(|e| e.to_string())
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

#[command]
pub(crate) fn set_hwdec(
    state: State<'_, StoreState>,
    app: AppHandle,
    mode: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.set_hwdec(mode).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn set_default_volume(
    state: State<'_, StoreState>,
    app: AppHandle,
    volume: i64,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.set_default_volume(volume).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn set_default_speed(
    state: State<'_, StoreState>,
    app: AppHandle,
    speed: f64,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.set_default_speed(speed).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn set_buffer_size(
    state: State<'_, StoreState>,
    app: AppHandle,
    size: i64,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.set_buffer_size(size).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn set_auto_next(
    state: State<'_, StoreState>,
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.set_auto_next(enabled).map_err(|e| e.to_string())
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

#[command]
pub(crate) fn cache_total_size(
    state: State<'_, StoreState>,
    app: AppHandle,
) -> Result<i64, String> {
    state.with_store(&app, |store| {
        store.total_cache_size().map_err(|e| e.to_string())
    })
}

/// Clear all cache entries and files.
#[command]
pub(crate) fn cache_clear_all(
    state: State<'_, StoreState>,
    app: AppHandle,
    include_temp: Option<bool>,
) -> Result<(), String> {
    // Get cache dir before clearing DB
    let cache_dir = state.with_store(&app, |store| {
        let settings = store
            .get_settings(&default_cache_dir(&app))
            .map_err(|e| e.to_string())?;
        let _ = store.clear_all().map_err(|e| e.to_string())?;
        Ok(PathBuf::from(settings.cache_dir))
    })?;

    // Remove entire cache directory and recreate
    if cache_dir.exists() {
        let _ = std::fs::remove_dir_all(&cache_dir);
        let _ = std::fs::create_dir_all(&cache_dir);
    }

    // Clear torrent temp directory if requested
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

/// Move a file to the organized cache directory and register it in the database.
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

// ── Watchlist commands ───────────────────────────────────────────

#[command]
pub(crate) fn watchlist_add(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
    anime_title: &str,
    cover: Option<&str>,
    total_episodes: i32,
) -> Result<WatchlistEntry, String> {
    state.with_store(&app, |store| {
        store
            .watchlist_add(bgm_id, anime_title, cover, total_episodes)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn watchlist_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.watchlist_remove(bgm_id).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn watchlist_get(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
) -> Result<Option<WatchlistEntry>, String> {
    state.with_store(&app, |store| {
        store.watchlist_get(bgm_id).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn watchlist_set_status(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
    status: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .watchlist_set_status(bgm_id, WatchStatus::from_str(status))
            .map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn watchlist_list(
    state: State<'_, StoreState>,
    app: AppHandle,
    status: Option<&str>,
) -> Result<Vec<WatchlistEntry>, String> {
    state.with_store(&app, |store| {
        store.watchlist_list(status).map_err(|e| e.to_string())
    })
}

// ── Watch History commands ───────────────────────────────────────

#[command]
pub(crate) fn history_upsert(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
    episode: i32,
    anime_title: &str,
    episode_title: &str,
    cover: Option<&str>,
    position: f64,
    duration: f64,
    group_id: Option<&str>,
    resolution: Option<&str>,
    subtitle: Option<&str>,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .history_upsert(
                bgm_id, episode, anime_title, episode_title, cover,
                position, duration, group_id, resolution, subtitle,
            )
            .map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn history_list(
    state: State<'_, StoreState>,
    app: AppHandle,
    limit: i32,
    offset: i32,
) -> Result<Vec<WatchHistoryEntry>, String> {
    state.with_store(&app, |store| {
        store.history_list(limit, offset).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn history_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    bgm_id: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.history_remove(bgm_id).map_err(|e| e.to_string())
    })
}

#[command]
pub(crate) fn history_clear(
    state: State<'_, StoreState>,
    app: AppHandle,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.history_clear().map_err(|e| e.to_string())
    })
}
