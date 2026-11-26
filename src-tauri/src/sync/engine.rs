//! Orchestrates one sync run: network work happens without holding the store
//! mutex, and every database step re-reads the local state.

use std::path::PathBuf;
use std::time::Duration;

use kuriume_store::{
    preview_import, ImportMode, ImportSummary, RecordDocument, SyncConfig, CURRENT_SCHEMA_VERSION,
    MAX_IMPORT_BYTES, RECORDS_FORMAT,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::store_commands::StoreState;

use super::backup;
use super::config;
use super::credentials;
use super::webdav::{is_strong_etag, Credentials, Deadline, Precondition, WebDav};
use super::{
    Code, Phase, SyncError, SyncGate, BACKGROUND_BUDGET, CLOSE_BUDGET, CONFLICT_RETRIES,
    MANUAL_BUDGET, OPEN_BUDGET,
};

const OPEN_THROTTLE_SECONDS: i64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    Manual,
    Open,
    Close,
    Background,
}

impl Trigger {
    pub fn budget(self) -> Duration {
        match self {
            Trigger::Manual => MANUAL_BUDGET,
            Trigger::Open => OPEN_BUDGET,
            Trigger::Close => CLOSE_BUDGET,
            Trigger::Background => BACKGROUND_BUDGET,
        }
    }

    fn is_push(self) -> bool {
        matches!(self, Trigger::Close | Trigger::Background)
    }

    fn is_automatic(self) -> bool {
        !matches!(self, Trigger::Manual)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsAuthority {
    Cloud,
    Local,
}

impl SettingsAuthority {
    fn parse(value: &str) -> Self {
        match value {
            "local" => SettingsAuthority::Local,
            _ => SettingsAuthority::Cloud,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SettingsAuthority::Cloud => "cloud",
            SettingsAuthority::Local => "local",
        }
    }
}

pub struct SyncRequest {
    pub trigger: Trigger,
    /// Manual dialog override; other triggers follow the saved authority.
    pub authority: Option<SettingsAuthority>,
    pub persist_authority: bool,
    /// Manual dialog toggle; automatic runs follow `sync_settings`.
    pub include_settings: Option<bool>,
}

impl SyncRequest {
    pub fn manual(
        authority: Option<SettingsAuthority>,
        persist_authority: bool,
        include_settings: Option<bool>,
    ) -> Self {
        Self {
            trigger: Trigger::Manual,
            authority,
            persist_authority,
            include_settings,
        }
    }

    pub fn automatic(trigger: Trigger) -> Self {
        Self {
            trigger,
            authority: None,
            persist_authority: false,
            include_settings: None,
        }
    }
}

#[derive(Serialize, Debug, Default, Clone)]
pub struct SyncOutcome {
    pub written: usize,
    pub skipped: usize,
    pub skipped_no_identity: usize,
    pub fixed_timestamps: usize,
    pub merged_items: usize,
    pub unknown_sources: usize,
    pub uploaded: bool,
    pub skipped_download: bool,
    pub note: Option<String>,
    pub backup: Option<String>,
    pub etag: Option<String>,
}

impl SyncOutcome {
    fn skipped(note: &str) -> Self {
        Self {
            note: Some(note.to_string()),
            ..Self::default()
        }
    }

    fn with_summary(mut self, summary: &ImportSummary) -> Self {
        self.written = summary.written;
        self.skipped = summary.skipped;
        self.skipped_no_identity = summary.skipped_no_identity;
        self.fixed_timestamps = summary.fixed_timestamps;
        self.merged_items = summary.merged_items;
        self.unknown_sources = summary.unknown_sources;
        self
    }
}

struct Prepared {
    config: SyncConfig,
    device_id: String,
    authority: SettingsAuthority,
    include_settings: bool,
    app_version: String,
    backups_dir: PathBuf,
}

struct Session<'a> {
    app: &'a AppHandle,
    state: &'a StoreState,
    dav: WebDav,
    prepared: Prepared,
    trigger: Trigger,
}

fn internal(phase: Phase) -> SyncError {
    SyncError::new(Code::Internal, phase)
}

fn corrupt() -> SyncError {
    SyncError::new(Code::Corrupt, Phase::Parse)
}

impl Prepared {
    fn include_settings_for(&self, authority: SettingsAuthority) -> bool {
        self.include_settings && authority == SettingsAuthority::Local
    }
}

/// Entry point used by every command and lifecycle hook. The gate is claimed
/// before any work so concurrent runs fail fast with `busy`.
pub async fn run(
    app: &AppHandle,
    state: &StoreState,
    gate: &SyncGate,
    request: SyncRequest,
) -> Result<SyncOutcome, SyncError> {
    let guard = gate
        .try_start()
        .ok_or_else(|| SyncError::new(Code::Busy, Phase::Config))?;

    if !credentials::platform_supported() {
        let error = credentials::unsupported();
        record_status(app, state, &error);
        return Err(error);
    }

    let config = read_config(app, state)?;

    if request.trigger.is_automatic() && !config.auto_sync {
        return Ok(SyncOutcome::skipped("auto_disabled"));
    }
    if request.trigger == Trigger::Open && synced_recently(app, state)? {
        return Ok(SyncOutcome::skipped("recent"));
    }
    if config.server_url.trim().is_empty() {
        let error = SyncError::new(Code::ConfigMissing, Phase::Config);
        record_status(app, state, &error);
        return Err(error);
    }

    let authority = request
        .authority
        .unwrap_or_else(|| SettingsAuthority::parse(&config.settings_authority));
    let include_settings = request.include_settings.unwrap_or(config.sync_settings);
    let backups_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| internal(Phase::Backup))?
        .join("backups");
    let password = credentials::load(app, &config.credential_key).inspect_err(|error| {
        record_status(app, state, error);
    })?;
    let device_id = state
        .with_store_mut(app, |store| {
            store.device_id().map_err(|error| error.to_string())
        })
        .map_err(|_| internal(Phase::Config))?;

    let endpoint = config::endpoint(&config.server_url, &config.remote_path)?;
    let dav = WebDav::new(
        endpoint,
        Credentials {
            username: config.username.clone(),
            password,
        },
        Deadline::new(request.trigger.budget()),
    )
    .inspect_err(|error| record_status(app, state, error))?;

    let prepared = Prepared {
        config,
        device_id,
        authority,
        include_settings,
        app_version: app.package_info().version.to_string(),
        backups_dir,
    };
    let session = Session {
        app,
        state,
        dav,
        prepared,
        trigger: request.trigger,
    };

    let result = match session.run_with_retries().await {
        Ok(outcome) => {
            if request.persist_authority {
                let _ = state.with_store_mut(app, |store| {
                    store
                        .set_sync_authority(authority.as_str())
                        .map_err(|error| error.to_string())
                });
            }
            let _ = app.emit("sync:applied", &outcome);
            record_success(app, state, &outcome);
            Ok(outcome)
        }
        Err(error) => {
            record_status(app, state, &error);
            Err(error)
        }
    };
    drop(guard);
    result
}

impl Session<'_> {
    async fn run_with_retries(&self) -> Result<SyncOutcome, SyncError> {
        let mut last = None;
        for attempt in 0..=CONFLICT_RETRIES {
            match self.attempt(attempt > 0).await {
                Ok(outcome) => return Ok(outcome),
                Err(error) if error.code == Code::Conflict => {
                    last = Some(error);
                }
                Err(error) => return Err(error),
            }
        }
        Err(last.unwrap_or_else(|| SyncError::new(Code::Conflict, Phase::Put)))
    }

    async fn attempt(&self, force_fetch: bool) -> Result<SyncOutcome, SyncError> {
        self.dav.ensure_parents().await?;
        let head = self.dav.head().await?;

        let Some(meta) = head else {
            return self.upload_fresh().await;
        };

        let strong = meta
            .etag
            .as_deref()
            .filter(|etag| is_strong_etag(etag))
            .map(str::to_string);
        let push_skip = !force_fetch
            && self.trigger.is_push()
            && strong.is_some()
            && strong.as_deref() == self.prepared.config.last_etag.as_deref();

        if !push_skip
            && self.trigger.is_push()
            && meta.etag.is_none()
            && meta.last_modified.is_none()
        {
            return Ok(SyncOutcome::skipped("no_etag"));
        }

        let note = if meta.etag.is_none() && meta.last_modified.is_none() {
            Some("no_etag".to_string())
        } else if meta
            .etag
            .as_deref()
            .is_some_and(|etag| !is_strong_etag(etag))
        {
            Some("weak_etag".to_string())
        } else {
            None
        };

        if push_skip {
            let include_settings = self.prepared.include_settings_for(self.prepared.authority);
            let document = self.export(include_settings)?;
            let (backup_path, bytes) = self.snapshot(&document)?;
            let precondition = match strong {
                Some(etag) => Precondition::IfMatch(etag),
                None => Precondition::None,
            };
            let put = self.dav.put(&bytes, &precondition).await?;
            return Ok(SyncOutcome {
                uploaded: true,
                skipped_download: true,
                note,
                backup: Some(backup_path),
                etag: put.etag.or_else(|| meta.etag.clone()),
                ..SyncOutcome::default()
            });
        }

        let fetched = self.dav.get(MAX_IMPORT_BYTES).await?;
        let Some(file) = fetched else {
            return self.upload_fresh().await;
        };

        let etag = file
            .etag
            .clone()
            .filter(|value| is_strong_etag(value))
            .or(strong);

        self.dav.deadline().check(Phase::Parse)?;
        let document: RecordDocument = serde_json::from_slice(&file.body).map_err(|_| corrupt())?;
        if document.format != RECORDS_FORMAT {
            return Err(corrupt());
        }
        if document.schema_version > CURRENT_SCHEMA_VERSION {
            return Err(SyncError::new(Code::SchemaTooNew, Phase::Parse));
        }
        preview_import(&document).map_err(|_| corrupt())?;

        // Back up before touching local data.
        self.state
            .with_store(self.app, |store| {
                backup::database(store, &self.prepared.backups_dir)
                    .map_err(|error| error.to_string())
            })
            .map_err(|_| internal(Phase::Backup))?;

        let apply_settings = if self.prepared.include_settings
            && self.prepared.authority == SettingsAuthority::Cloud
        {
            document.settings.clone()
        } else {
            None
        };

        let summary = self
            .state
            .with_store_mut(self.app, |store| {
                let summary = store
                    .import_records(&document, ImportMode::Merge)
                    .map_err(|error| error.to_string())?;
                if let Some(settings) = apply_settings.as_ref() {
                    store
                        .write_settings(settings)
                        .map_err(|error| error.to_string())?;
                }
                Ok(summary)
            })
            .map_err(|_| internal(Phase::Merge))?;

        let mut merged = self.export(self.prepared.include_settings)?;
        // Turning settings sync off must not erase the settings another device
        // already stored: keep the fetched section in the file untouched.
        if !self.prepared.include_settings {
            if let Some(settings) = document.settings.clone() {
                merged.settings = Some(settings);
                if !merged.sections.iter().any(|section| section == "settings") {
                    merged.sections.push("settings".to_string());
                }
            }
        }
        let (backup_path, bytes) = self.snapshot(&merged)?;
        let precondition = match etag.clone() {
            Some(value) => Precondition::IfMatch(value),
            None => Precondition::None,
        };
        let put = self.dav.put(&bytes, &precondition).await?;

        Ok(SyncOutcome {
            uploaded: true,
            skipped_download: false,
            note,
            backup: Some(backup_path),
            etag: put.etag.or(etag),
            ..SyncOutcome::default()
        }
        .with_summary(&summary))
    }

    async fn upload_fresh(&self) -> Result<SyncOutcome, SyncError> {
        let document = self.export(self.prepared.include_settings)?;
        let (backup_path, bytes) = self.snapshot(&document)?;
        let put = self.dav.put(&bytes, &Precondition::IfNoneMatch).await?;
        Ok(SyncOutcome {
            uploaded: true,
            skipped_download: false,
            backup: Some(backup_path),
            etag: put.etag,
            ..SyncOutcome::default()
        })
    }

    fn export(&self, include_settings: bool) -> Result<RecordDocument, SyncError> {
        self.dav.deadline().check(Phase::Export)?;
        self.state
            .with_store(self.app, |store| {
                store
                    .export_records(
                        &self.prepared.app_version,
                        &self.prepared.device_id,
                        true,
                        include_settings,
                    )
                    .map_err(|error| error.to_string())
            })
            .map_err(|_| internal(Phase::Export))
    }

    fn snapshot(&self, document: &RecordDocument) -> Result<(String, Vec<u8>), SyncError> {
        let bytes = serde_json::to_vec(document).map_err(|_| internal(Phase::Export))?;
        let stamp = self
            .state
            .with_store(self.app, |store| {
                store.timestamp_now().map_err(|error| error.to_string())
            })
            .map_err(|_| internal(Phase::Backup))?;
        let path = backup::records_snapshot(&bytes, &self.prepared.backups_dir, &stamp)
            .map_err(|_| internal(Phase::Backup))?;
        Ok((path.display().to_string(), bytes))
    }
}

fn read_config(app: &AppHandle, state: &StoreState) -> Result<SyncConfig, SyncError> {
    state
        .with_store(app, |store| {
            store.sync_config().map_err(|error| error.to_string())
        })
        .map_err(|_| internal(Phase::Config))
}

fn synced_recently(app: &AppHandle, state: &StoreState) -> Result<bool, SyncError> {
    state
        .with_store(app, |store| {
            store
                .synced_within(OPEN_THROTTLE_SECONDS)
                .map_err(|error| error.to_string())
        })
        .map_err(|_| internal(Phase::Config))
}

fn record_success(app: &AppHandle, state: &StoreState, outcome: &SyncOutcome) {
    let _ = state.with_store_mut(app, |store| {
        store
            .record_sync_status("ok", None, outcome.etag.as_deref())
            .map_err(|error| error.to_string())
    });
}

fn record_status(app: &AppHandle, state: &StoreState, error: &SyncError) {
    let status = match error.code {
        Code::Corrupt | Code::SchemaTooNew => "corrupt",
        Code::NeedPassword | Code::Keyring => "need_password",
        Code::Busy => "busy",
        _ => "failed",
    };
    let text = format!("{}: {error}", error.code.as_str());
    let _ = state.with_store_mut(app, |store| {
        store
            .record_sync_status(status, Some(&text), None)
            .map_err(|error| error.to_string())
    });
}
