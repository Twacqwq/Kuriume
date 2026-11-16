//! Record import and export. Files travel as user-chosen paths so the renderer
//! never needs filesystem permissions; every read is size-limited and every
//! overwrite is preceded by a database snapshot.

use crate::store_commands::StoreState;
use kuriume_store::{
    preview_import, ImportMode, ImportPreview, ImportSummary, RecordCounts, RecordDocument,
    MAX_IMPORT_BYTES,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager, State};

const BACKUP_LIMIT: usize = 5;

#[derive(Serialize)]
pub(crate) struct ExportOutcome {
    pub counts: RecordCounts,
    pub bytes: usize,
}

#[derive(Serialize)]
pub(crate) struct ImportOutcome {
    pub summary: ImportSummary,
    pub backup: Option<String>,
}

#[command]
pub(crate) fn records_export(
    app: AppHandle,
    state: State<'_, StoreState>,
    path: String,
    include_records: bool,
    include_settings: bool,
) -> Result<ExportOutcome, String> {
    let (document, bytes) = build_export(&app, &state, include_records, include_settings)?;
    write_file(Path::new(&path), &bytes)?;
    Ok(ExportOutcome {
        counts: document.counts,
        bytes: bytes.len(),
    })
}

/// Builds the export document and its compact JSON encoding.
fn build_export(
    app: &AppHandle,
    state: &State<'_, StoreState>,
    include_records: bool,
    include_settings: bool,
) -> Result<(RecordDocument, Vec<u8>), String> {
    if !include_records && !include_settings {
        return Err("Choose at least one section to export".into());
    }
    let version = app.package_info().version.to_string();
    let document = state.with_store_mut(app, |store| {
        let device_id = store.device_id().map_err(|error| error.to_string())?;
        store
            .export_records(&version, &device_id, include_records, include_settings)
            .map_err(|error| error.to_string())
    })?;
    let bytes = serde_json::to_vec(&document)
        .map_err(|error| format!("Could not encode the export: {error}"))?;
    Ok((document, bytes))
}

/// Mobile export writes into the app cache and opens the system share sheet;
/// the renderer never supplies the path.
#[command]
pub(crate) async fn records_export_share(
    app: AppHandle,
    state: State<'_, StoreState>,
    include_records: bool,
    include_settings: bool,
) -> Result<ExportOutcome, String> {
    let (document, bytes) = build_export(&app, &state, include_records, include_settings)?;
    let stamp = state.with_store(&app, |store| {
        store.timestamp_now().map_err(|error| error.to_string())
    })?;
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("records");
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    if let Ok(entries) = fs::read_dir(&folder) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }
    let target = folder.join(format!("kuriume-records-{stamp}.json"));
    write_file(&target, &bytes)?;
    #[cfg(mobile)]
    tauri_plugin_mobile::share_record_file(app.clone(), target.to_string_lossy().into_owned())
        .await?;
    Ok(ExportOutcome {
        counts: document.counts,
        bytes: bytes.len(),
    })
}

/// Copies a document picked through the system file picker into the app cache.
#[command]
pub(crate) async fn records_copy_import(app: AppHandle, uri: String) -> Result<String, String> {
    #[cfg(mobile)]
    {
        tauri_plugin_mobile::copy_record_uri(app, uri).await
    }
    #[cfg(not(mobile))]
    {
        let _ = (app, uri);
        Err("File import is only available in the mobile app".into())
    }
}

#[command]
pub(crate) fn records_import_preview(path: String) -> Result<ImportPreview, String> {
    let document = read_document(&path)?;
    preview_import(&document).map_err(|error| error.to_string())
}

#[command]
pub(crate) fn records_import(
    app: AppHandle,
    state: State<'_, StoreState>,
    path: String,
    mode: String,
) -> Result<ImportOutcome, String> {
    let mode = ImportMode::parse(&mode).ok_or_else(|| format!("Unknown import mode: {mode}"))?;
    let document = read_document(&path)?;
    preview_import(&document).map_err(|error| error.to_string())?;
    let backup =
        if mode == ImportMode::Overwrite && document.sections.iter().any(|s| s == "records") {
            Some(backup_before_overwrite(&app, &state)?)
        } else {
            None
        };
    let summary = state.with_store_mut(&app, |store| {
        store
            .import_records(&document, mode)
            .map_err(|error| error.to_string())
    })?;
    Ok(ImportOutcome {
        summary,
        backup: backup.map(|path| path.to_string_lossy().into_owned()),
    })
}

fn backup_before_overwrite(
    app: &AppHandle,
    state: &State<'_, StoreState>,
) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("backups");
    let stamp = state.with_store(app, |store| {
        store.timestamp_now().map_err(|error| error.to_string())
    })?;
    let target = directory.join(format!("kuriume-{stamp}.db"));
    state.with_store(app, |store| {
        store
            .backup_database(&target)
            .map_err(|error| error.to_string())
    })?;
    prune_backups(&directory)?;
    Ok(target)
}

fn prune_backups(directory: &Path) -> Result<(), String> {
    let mut backups: Vec<PathBuf> = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("kuriume-") && name.ends_with(".db"))
        })
        .collect();
    backups.sort();
    while backups.len() > BACKUP_LIMIT {
        let oldest = backups.remove(0);
        fs::remove_file(&oldest).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_document(path: &str) -> Result<RecordDocument, String> {
    let path = Path::new(path);
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not open the file: {error}"))?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "The file is {} MB; imports are limited to {} MB",
            metadata.len() / (1024 * 1024),
            MAX_IMPORT_BYTES / (1024 * 1024)
        ));
    }
    let bytes = fs::read(path).map_err(|error| format!("Could not read the file: {error}"))?;
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err(format!(
            "The file is {} MB; imports are limited to {} MB",
            bytes.len() / (1024 * 1024),
            MAX_IMPORT_BYTES / (1024 * 1024)
        ));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("This is not a Kuriume records file: {error}"))
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    fs::write(path, bytes).map_err(|error| format!("Could not write the file: {error}"))
}
