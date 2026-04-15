use crate::store_commands::StoreState;
use kuriume_torrent::{TorrentEngine, TorrentFileInfo, TorrentStatus};
use std::sync::Arc;
use tauri::{command, AppHandle, Manager, State};
use tokio::sync::OnceCell;

/// Shared torrent engine state, lazily initialized via `OnceCell`.
pub struct TorrentState {
    engine: OnceCell<Arc<TorrentEngine>>,
}

impl TorrentState {
    pub fn new() -> Self {
        Self {
            engine: OnceCell::new(),
        }
    }

    /// Get or initialize the engine (lazy async init).
    async fn engine(&self, app: &AppHandle) -> Result<&Arc<TorrentEngine>, String> {
        self.engine
            .get_or_try_init(|| async {
                let data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| e.to_string())?
                    .join("torrents");

                // Read user-configured trackers from store (empty = use built-in defaults)
                let trackers = app
                    .state::<StoreState>()
                    .with_store(app, |store| {
                        let default_dir = app
                            .path()
                            .download_dir()
                            .map(|p| p.join("Kuriume"))
                            .unwrap_or_else(|_| std::path::PathBuf::from("~/Downloads/Kuriume"))
                            .to_string_lossy()
                            .into_owned();
                        let settings = store
                            .get_settings(&default_dir)
                            .map_err(|e| e.to_string())?;
                        Ok(settings.tracker_list)
                    })
                    .unwrap_or_default();

                let engine = TorrentEngine::new(data_dir, trackers)
                    .await
                    .map_err(|e| e.to_string())?;

                Ok(Arc::new(engine))
            })
            .await
    }
}

impl Default for TorrentState {
    fn default() -> Self {
        Self::new()
    }
}

/// Add a torrent from a magnet URI or `.torrent` URL. Returns the torrent ID.
#[command]
pub(crate) async fn torrent_add(
    state: State<'_, TorrentState>,
    app: AppHandle,
    source: &str,
) -> Result<usize, String> {
    let engine = state.engine(&app).await?;
    engine.add_torrent(source).await.map_err(|e| e.to_string())
}

/// List all files inside a torrent.
#[command]
pub(crate) async fn torrent_list_files(
    state: State<'_, TorrentState>,
    app: AppHandle,
    torrent_id: usize,
) -> Result<Vec<TorrentFileInfo>, String> {
    let engine = state.engine(&app).await?;
    engine
        .list_files(torrent_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get a local HTTP streaming URL for a file in a torrent.
#[command]
pub(crate) async fn torrent_stream_url(
    state: State<'_, TorrentState>,
    app: AppHandle,
    torrent_id: usize,
    file_id: usize,
) -> Result<String, String> {
    let engine = state.engine(&app).await?;
    Ok(engine.stream_url(torrent_id, file_id))
}

/// Get download status for a torrent.
#[command]
pub(crate) async fn torrent_stats(
    state: State<'_, TorrentState>,
    app: AppHandle,
    torrent_id: usize,
) -> Result<TorrentStatus, String> {
    let engine = state.engine(&app).await?;
    engine.stats(torrent_id).await.map_err(|e| e.to_string())
}

/// Remove a torrent and optionally delete its downloaded data.
#[command]
pub(crate) async fn torrent_remove(
    state: State<'_, TorrentState>,
    app: AppHandle,
    torrent_id: usize,
    #[allow(unused)] delete_data: Option<bool>,
) -> Result<(), String> {
    let engine = state.engine(&app).await?;
    engine
        .remove(torrent_id, delete_data.unwrap_or(true))
        .await
        .map_err(|e| e.to_string())
}

/// Get the absolute on-disk path for a file within a torrent.
#[command]
pub(crate) async fn torrent_file_path(
    state: State<'_, TorrentState>,
    app: AppHandle,
    torrent_id: usize,
    file_id: usize,
) -> Result<String, String> {
    let engine = state.engine(&app).await?;
    let path = engine
        .file_path(torrent_id, file_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
