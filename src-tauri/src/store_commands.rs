use kuriume_store::{
    CatalogMediaInput, ExternalIdentity, LibraryEntry, LibraryStatus, Settings, SourceBinding,
    Store, StoredMedia, WatchHistoryEntry,
};
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};

pub struct StoreState {
    inner: Mutex<Option<Store>>,
}

impl StoreState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn with_store<F, R>(&self, app: &AppHandle, operation: F) -> Result<R, String>
    where
        F: FnOnce(&Store) -> Result<R, String>,
    {
        let mut guard = self.inner.lock().map_err(|error| error.to_string())?;
        if guard.is_none() {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("kuriume-v1.db");
            *guard = Some(Store::open(path).map_err(|error| error.to_string())?);
        }
        operation(guard.as_ref().expect("store initialized"))
    }
}

impl Default for StoreState {
    fn default() -> Self {
        Self::new()
    }
}

#[command]
pub(crate) fn get_settings(
    state: State<'_, StoreState>,
    app: AppHandle,
) -> Result<Settings, String> {
    state.with_store(&app, |store| {
        store.get_settings().map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn set_default_volume(
    state: State<'_, StoreState>,
    app: AppHandle,
    volume: f64,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .set_default_volume(volume)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn set_default_speed(
    state: State<'_, StoreState>,
    app: AppHandle,
    speed: f64,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .set_default_speed(speed)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn set_auto_next(
    state: State<'_, StoreState>,
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .set_auto_next(enabled)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn set_display_language(
    state: State<'_, StoreState>,
    app: AppHandle,
    language: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .set_display_language(language)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn media_ensure(
    state: State<'_, StoreState>,
    app: AppHandle,
    input: CatalogMediaInput,
) -> Result<StoredMedia, String> {
    state.with_store(&app, |store| {
        store
            .ensure_media(&input)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn external_identity_list(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
) -> Result<Vec<ExternalIdentity>, String> {
    state.with_store(&app, |store| {
        store
            .external_identity_list(media_id)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn external_identity_upsert(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    provider: &str,
    external_id: &str,
    scope: &str,
    confidence: f64,
) -> Result<ExternalIdentity, String> {
    if !matches!(provider, "tmdb_tv" | "tmdb_movie") {
        return Err("Only confirmed TMDB identities can be added here".into());
    }
    state.with_store(&app, |store| {
        store
            .external_identity_upsert(media_id, provider, external_id, scope, confidence)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn external_identity_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    provider: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .external_identity_remove(media_id, provider)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn library_add(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    status: &str,
) -> Result<LibraryEntry, String> {
    let status = LibraryStatus::parse(status).map_err(|error| error.to_string())?;
    state.with_store(&app, |store| {
        store
            .library_add(media_id, status)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn library_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .library_remove(media_id)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn library_get(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
) -> Result<Option<LibraryEntry>, String> {
    state.with_store(&app, |store| {
        store
            .library_get(media_id)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn library_set_status(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    status: &str,
) -> Result<(), String> {
    let status = LibraryStatus::parse(status).map_err(|error| error.to_string())?;
    state.with_store(&app, |store| {
        store
            .library_set_status(media_id, status)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn library_list(
    state: State<'_, StoreState>,
    app: AppHandle,
    status: Option<&str>,
) -> Result<Vec<LibraryEntry>, String> {
    state.with_store(&app, |store| {
        store
            .library_list(status)
            .map_err(|error| error.to_string())
    })
}

#[command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn history_upsert(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    episode: i32,
    episode_title: &str,
    position: f64,
    duration: f64,
    source_id: Option<&str>,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .history_upsert(
                media_id,
                episode,
                episode_title,
                position,
                duration,
                source_id,
            )
            .map_err(|error| error.to_string())
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
        store
            .history_list(limit, offset)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn history_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    episode: Option<i32>,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .history_remove(media_id, episode)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn history_clear(state: State<'_, StoreState>, app: AppHandle) -> Result<(), String> {
    state.with_store(&app, |store| {
        store.history_clear().map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn source_binding_get(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    source_id: &str,
) -> Result<Option<SourceBinding>, String> {
    state.with_store(&app, |store| {
        store
            .source_binding_get(media_id, source_id)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn source_binding_list(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
) -> Result<Vec<SourceBinding>, String> {
    state.with_store(&app, |store| {
        store
            .source_binding_list(media_id)
            .map_err(|error| error.to_string())
    })
}

#[command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn source_binding_upsert(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    source_id: &str,
    remote_media_url: &str,
    remote_title: &str,
    road_index: i32,
) -> Result<SourceBinding, String> {
    state.with_store(&app, |store| {
        store
            .source_binding_upsert(
                media_id,
                source_id,
                remote_media_url,
                remote_title,
                road_index,
            )
            .map_err(|error| error.to_string())
    })
}

#[command]
pub(crate) fn source_binding_remove(
    state: State<'_, StoreState>,
    app: AppHandle,
    media_id: &str,
    source_id: &str,
) -> Result<(), String> {
    state.with_store(&app, |store| {
        store
            .source_binding_remove(media_id, source_id)
            .map_err(|error| error.to_string())
    })
}
