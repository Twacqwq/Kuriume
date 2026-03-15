use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session,
    SessionOptions, api::TorrentIdOrHash,
};
use serde::Serialize;
use tokio::sync::RwLock;
use tracing::info;

use crate::error::{Result, TorrentError};
use crate::server;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Information about a file inside a torrent.
#[derive(Debug, Clone, Serialize)]
pub struct TorrentFileInfo {
    /// File index within the torrent (used to start streaming).
    pub index: usize,
    /// Relative file path (e.g. `"video/episode01.mkv"`).
    pub path: String,
    /// File size in bytes.
    pub length: u64,
}

/// Snapshot of torrent download status.
#[derive(Debug, Clone, Serialize)]
pub struct TorrentStatus {
    pub state: String,
    /// Overall progress 0.0 – 1.0.
    pub progress: f64,
    /// Download speed in bytes/s.
    pub download_speed: u64,
    /// Upload speed in bytes/s.
    pub upload_speed: u64,
    /// Total bytes downloaded so far.
    pub downloaded_bytes: u64,
    /// Total bytes of selected files.
    pub total_bytes: u64,
    /// Number of connected peers.
    pub peers: u32,
}

// ---------------------------------------------------------------------------
// Shared state (engine ↔ streaming server)
// ---------------------------------------------------------------------------

pub(crate) struct SharedState {
    pub session: Arc<Session>,
    pub handles: RwLock<HashMap<usize, Arc<ManagedTorrent>>>,
}

// ---------------------------------------------------------------------------
// TorrentEngine
// ---------------------------------------------------------------------------

/// High-level torrent engine that manages downloads and provides streaming
/// URLs playable by mpv.
pub struct TorrentEngine {
    pub(crate) state: Arc<SharedState>,
    /// TCP port the local streaming server is listening on.
    server_port: u16,
    /// Handle to the background server task.
    _server_handle: tokio::task::JoinHandle<()>,
}

impl TorrentEngine {
    /// Create a new engine.
    ///
    /// - `download_dir`: directory where torrent data is stored.
    pub async fn new(download_dir: PathBuf) -> Result<Self> {
        // Ensure download directory exists
        tokio::fs::create_dir_all(&download_dir).await?;

        let opts = SessionOptions {
            persistence: None, // no persistence across restarts
            ..Default::default()
        };

        let session = Session::new_with_opts(download_dir, opts)
            .await
            .context("failed to create librqbit session")?;

        let shared = Arc::new(SharedState {
            session,
            handles: RwLock::new(HashMap::new()),
        });

        let (port, handle) = server::start(shared.clone()).await?;

        info!(port, "torrent streaming server started");

        Ok(Self {
            state: shared,
            server_port: port,
            _server_handle: handle,
        })
    }

    /// Add a torrent from a magnet URI, HTTP URL, or raw `.torrent` bytes.
    ///
    /// Returns the torrent ID assigned by the session.
    pub async fn add_torrent(&self, source: &str) -> Result<usize> {
        let add_torrent = AddTorrent::from_url(source);

        let opts = Some(AddTorrentOptions {
            overwrite: true,
            ..Default::default()
        });

        let response = self
            .state
            .session
            .add_torrent(add_torrent, opts)
            .await
            .context("failed to add torrent")?;

        let (id, handle) = match response {
            AddTorrentResponse::Added(id, handle) => (id, handle),
            AddTorrentResponse::AlreadyManaged(id, handle) => (id, handle),
            AddTorrentResponse::ListOnly(_) => {
                return Err(TorrentError::Engine(anyhow::anyhow!(
                    "torrent added in list-only mode"
                )));
            }
        };

        // Wait until metadata is resolved (important for magnet links)
        handle
            .wait_until_initialized()
            .await
            .context("torrent metadata resolution failed")?;

        self.state.handles.write().await.insert(id, handle);

        info!(id, "torrent added and initialized");
        Ok(id)
    }

    /// List files in a torrent (metadata must be resolved).
    pub async fn list_files(&self, torrent_id: usize) -> Result<Vec<TorrentFileInfo>> {
        let handles = self.state.handles.read().await;
        let torrent = handles
            .get(&torrent_id)
            .ok_or(TorrentError::NotFound(torrent_id))?;

        let files = torrent
            .with_metadata(|meta| {
                meta.file_infos
                    .iter()
                    .enumerate()
                    .map(|(idx, fi)| TorrentFileInfo {
                        index: idx,
                        path: fi.relative_filename.to_string_lossy().into_owned(),
                        length: fi.len,
                    })
                    .collect::<Vec<_>>()
            })
            .map_err(|_| TorrentError::MetadataNotReady(torrent_id))?;

        Ok(files)
    }

    /// Get the HTTP streaming URL for a specific file in a torrent.
    ///
    /// mpv can play this URL directly (supports Range requests / seeking).
    pub fn stream_url(&self, torrent_id: usize, file_id: usize) -> String {
        format!(
            "http://127.0.0.1:{}/stream/{}/{}",
            self.server_port, torrent_id, file_id
        )
    }

    /// Get current download status for a torrent.
    pub async fn stats(&self, torrent_id: usize) -> Result<TorrentStatus> {
        let handles = self.state.handles.read().await;
        let torrent = handles
            .get(&torrent_id)
            .ok_or(TorrentError::NotFound(torrent_id))?;

        let stats = torrent.stats();

        let progress = if stats.total_bytes > 0 {
            stats.progress_bytes as f64 / stats.total_bytes as f64
        } else {
            0.0
        };

        Ok(TorrentStatus {
            state: format!("{}", stats.state),
            progress,
            download_speed: stats.live.as_ref().map_or(0, |l| {
                // mbps is MiB/s, convert to bytes/s
                (l.download_speed.mbps * 1_048_576.0) as u64
            }),
            upload_speed: stats.live.as_ref().map_or(0, |l| {
                (l.upload_speed.mbps * 1_048_576.0) as u64
            }),
            downloaded_bytes: stats.progress_bytes,
            total_bytes: stats.total_bytes,
            peers: stats.live.as_ref().map_or(0, |l| l.snapshot.peer_stats.live as u32),
        })
    }

    /// Remove a torrent and delete its data.
    pub async fn remove(&self, torrent_id: usize) -> Result<()> {
        self.state.handles.write().await.remove(&torrent_id);
        self.state
            .session
            .delete(TorrentIdOrHash::Id(torrent_id), true)
            .await
            .context("failed to delete torrent")?;

        info!(torrent_id, "torrent removed");
        Ok(())
    }

    /// Get the streaming server port.
    pub fn port(&self) -> u16 {
        self.server_port
    }
}
