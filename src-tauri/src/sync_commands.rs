//! Tauri surface for WebDAV sync: configuration, credential probing, manual
//! runs and the automatic open/background triggers.

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, State};

use kuriume_store::SyncConfig;

use crate::store_commands::StoreState;
use crate::sync::engine::{self, SettingsAuthority, SyncOutcome, SyncRequest, Trigger};
use crate::sync::webdav::{Credentials, Deadline, WebDav};
use crate::sync::{
    config, credentials, Code, Phase, SyncError, SyncErrorPayload, SyncGate, MANUAL_BUDGET,
};

pub(crate) type SyncResult<T> = Result<T, SyncErrorPayload>;

#[derive(Serialize)]
pub(crate) struct SyncConfigView {
    pub server_url: String,
    pub username: String,
    pub remote_path: String,
    pub auto_sync: bool,
    pub sync_settings: bool,
    pub settings_authority: String,
    pub device_id: String,
    pub last_synced_at: Option<String>,
    pub last_etag: Option<String>,
    pub last_status: String,
    pub last_error: Option<String>,
    pub has_password: bool,
}

impl SyncConfigView {
    fn from_config(app: &AppHandle, config: &SyncConfig) -> Self {
        Self {
            server_url: config.server_url.clone(),
            username: config.username.clone(),
            remote_path: config.remote_path.clone(),
            auto_sync: config.auto_sync,
            sync_settings: config.sync_settings,
            settings_authority: config.settings_authority.clone(),
            device_id: config.device_id.clone(),
            last_synced_at: config.last_synced_at.clone(),
            last_etag: config.last_etag.clone(),
            last_status: config.last_status.clone(),
            last_error: config.last_error.clone(),
            has_password: !config.credential_key.is_empty()
                && credentials::has_password(app, &config.credential_key),
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct SyncConfigInput {
    pub server_url: String,
    pub username: String,
    pub remote_path: String,
    pub auto_sync: bool,
    pub sync_settings: bool,
    pub settings_authority: String,
    pub password: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct SyncTestResult {
    pub exists: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub length: Option<u64>,
}

fn internal(phase: Phase) -> SyncErrorPayload {
    SyncError::new(Code::Internal, phase).payload()
}

fn load_config(app: &AppHandle, state: &StoreState) -> SyncResult<SyncConfig> {
    state
        .with_store(app, |store| {
            store.sync_config().map_err(|error| error.to_string())
        })
        .map_err(|_| internal(Phase::Config))
}

#[command]
pub(crate) fn sync_config_get(
    app: AppHandle,
    state: State<'_, StoreState>,
) -> SyncResult<SyncConfigView> {
    let config = load_config(&app, &state)?;
    Ok(SyncConfigView::from_config(&app, &config))
}

#[command]
pub(crate) fn sync_config_save(
    app: AppHandle,
    state: State<'_, StoreState>,
    config: SyncConfigInput,
) -> SyncResult<SyncConfigView> {
    let current = load_config(&app, &state)?;
    let server_url = config.server_url.trim().to_string();

    if server_url.is_empty() {
        if !current.credential_key.is_empty() {
            credentials::clear(&app, &current.credential_key);
        }
        let cleared = SyncConfig {
            server_url: String::new(),
            username: String::new(),
            remote_path: "/kuriume/records.json".to_string(),
            credential_key: String::new(),
            auto_sync: false,
            sync_settings: false,
            settings_authority: "cloud".to_string(),
            device_id: current.device_id,
            last_synced_at: None,
            last_etag: None,
            last_status: "never".to_string(),
            last_error: None,
        };
        state
            .with_store_mut(&app, |store| {
                store
                    .save_sync_config(&cleared)
                    .map_err(|error| error.to_string())
            })
            .map_err(|_| internal(Phase::Config))?;
        return Ok(SyncConfigView::from_config(&app, &cleared));
    }

    let server_url = config::normalize_server_url(&server_url).map_err(|error| error.payload())?;
    config::validate_remote_path(&config.remote_path).map_err(|error| error.payload())?;
    if !matches!(config.settings_authority.as_str(), "cloud" | "local") {
        return Err(
            SyncError::detail(Code::InvalidUrl, Phase::Config, "settings_authority").payload(),
        );
    }
    let username = config.username.trim().to_string();
    let key = config::credential_key(&server_url, &username).map_err(|error| error.payload())?;
    let password = config.password.unwrap_or_default();
    let key_changed = key != current.credential_key;

    if key_changed && password.is_empty() {
        return Err(need_password());
    }
    if !password.is_empty() {
        credentials::save(&app, &key, &password).map_err(|error| error.payload())?;
    }
    if key_changed && !current.credential_key.is_empty() {
        credentials::clear(&app, &current.credential_key);
    }
    if !credentials::has_password(&app, &key) {
        return Err(need_password());
    }

    let mut updated = SyncConfig {
        server_url,
        username,
        remote_path: config.remote_path,
        credential_key: key,
        auto_sync: config.auto_sync,
        sync_settings: config.sync_settings,
        settings_authority: config.settings_authority,
        device_id: current.device_id,
        last_synced_at: current.last_synced_at,
        last_etag: current.last_etag,
        last_status: current.last_status,
        last_error: current.last_error,
    };
    state
        .with_store_mut(&app, |store| {
            if updated.device_id.is_empty() {
                updated.device_id = store.device_id().map_err(|error| error.to_string())?;
            }
            store
                .save_sync_config(&updated)
                .map_err(|error| error.to_string())
        })
        .map_err(|_| internal(Phase::Config))?;
    Ok(SyncConfigView::from_config(&app, &updated))
}

fn need_password() -> SyncErrorPayload {
    SyncError::new(Code::NeedPassword, Phase::Config).payload()
}

#[command]
pub(crate) async fn sync_test_connection(
    app: AppHandle,
    state: State<'_, StoreState>,
) -> SyncResult<SyncTestResult> {
    let config = load_config(&app, &state)?;
    if config.server_url.trim().is_empty() {
        return Err(SyncError::new(Code::ConfigMissing, Phase::Config).payload());
    }
    let password =
        credentials::load(&app, &config.credential_key).map_err(|error| error.payload())?;
    let endpoint = config::endpoint(&config.server_url, &config.remote_path)
        .map_err(|error| error.payload())?;
    let dav = WebDav::new(
        endpoint,
        Credentials {
            username: config.username.clone(),
            password,
        },
        Deadline::new(MANUAL_BUDGET),
    )
    .map_err(|error| error.payload())?;
    let meta = dav.probe().await.map_err(|error| error.payload())?;
    Ok(match meta {
        Some(meta) => SyncTestResult {
            exists: true,
            etag: meta.etag,
            last_modified: meta.last_modified,
            length: meta.length,
        },
        None => SyncTestResult {
            exists: false,
            etag: None,
            last_modified: None,
            length: None,
        },
    })
}

#[command]
pub(crate) async fn sync_now(
    app: AppHandle,
    state: State<'_, StoreState>,
    gate: State<'_, SyncGate>,
    authority: Option<String>,
    remember: Option<bool>,
    include_settings: Option<bool>,
) -> SyncResult<SyncOutcome> {
    let authority = authority.as_deref().map(|value| match value {
        "local" => SettingsAuthority::Local,
        _ => SettingsAuthority::Cloud,
    });
    engine::run(
        &app,
        &state,
        &gate,
        SyncRequest::manual(authority, remember.unwrap_or(false), include_settings),
    )
    .await
    .map_err(|error| error.payload())
}

#[command]
pub(crate) async fn sync_on_open(
    app: AppHandle,
    state: State<'_, StoreState>,
    gate: State<'_, SyncGate>,
) -> SyncResult<SyncOutcome> {
    engine::run(&app, &state, &gate, SyncRequest::automatic(Trigger::Open))
        .await
        .map_err(|error| error.payload())
}

#[command]
pub(crate) async fn sync_background_push(
    app: AppHandle,
    state: State<'_, StoreState>,
    gate: State<'_, SyncGate>,
) -> SyncResult<SyncOutcome> {
    engine::run(
        &app,
        &state,
        &gate,
        SyncRequest::automatic(Trigger::Background),
    )
    .await
    .map_err(|error| error.payload())
}

#[command]
pub(crate) fn sync_status(
    app: AppHandle,
    state: State<'_, StoreState>,
) -> SyncResult<SyncConfigView> {
    let config = load_config(&app, &state)?;
    Ok(SyncConfigView::from_config(&app, &config))
}
