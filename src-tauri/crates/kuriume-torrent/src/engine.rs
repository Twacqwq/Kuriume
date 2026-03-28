use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent,
    PeerConnectionOptions, Session, SessionOptions, api::TorrentIdOrHash,
};
use serde::Serialize;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::error::{Result, TorrentError};
use crate::server;

// ---------------------------------------------------------------------------
// Tracker list (defaults)
// ---------------------------------------------------------------------------

const DEFAULT_TRACKER_LIST: &[&str] = &[
    // Anime / ACG ecosystem
    "http://t.nyaatracker.com/announce",
    "http://opentracker.acgnx.se/announce",
    "http://anidex.moe:6969/announce",
    "http://t.acg.rip:6699/announce",
    "https://tr.bangumi.moe:9696/announce",
    "http://tr.bangumi.moe:6969/announce",
    // High-uptime public trackers
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.moeking.me:6969/announce",
    "http://nyaa.tracker.wf:7777/announce",
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct TorrentFileInfo {
    pub index: usize,
    pub path: String,
    pub length: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TorrentStatus {
    pub state: String,
    pub progress: f64,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
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
    download_dir: PathBuf,
    server_port: u16,
    _server_handle: tokio::task::JoinHandle<()>,
    /// Effective tracker list used for every torrent.
    trackers: Vec<String>,
    /// HTTP client for downloading .torrent files (with proper User-Agent).
    http_client: reqwest::Client,
}

impl TorrentEngine {
    /// Create a new engine. If `custom_trackers` is empty, the built-in defaults are used.
    pub async fn new(download_dir: PathBuf, custom_trackers: Vec<String>) -> Result<Self> {
        tokio::fs::create_dir_all(&download_dir).await?;

        let effective: Vec<String> = if custom_trackers.is_empty() {
            DEFAULT_TRACKER_LIST.iter().map(|s| s.to_string()).collect()
        } else {
            custom_trackers
        };

        let session_trackers: HashSet<url::Url> = effective
            .iter()
            .filter_map(|s| url::Url::parse(s).ok())
            .collect();

        let opts = SessionOptions {
            persistence: None,
            trackers: session_trackers,
            listen_port_range: Some(6881..6890),
            enable_upnp_port_forwarding: true,
            peer_opts: Some(PeerConnectionOptions {
                connect_timeout: Some(Duration::from_secs(10)),
                read_write_timeout: Some(Duration::from_secs(15)),
                ..Default::default()
            }),
            ..Default::default()
        };

        let session = Session::new_with_opts(download_dir.clone(), opts)
            .await
            .context("failed to create librqbit session")?;

        let shared = Arc::new(SharedState {
            session,
            handles: RwLock::new(HashMap::new()),
        });

        let (port, handle) = server::start(shared.clone()).await?;

        info!(port, "torrent streaming server started");

        let http_client = reqwest::Client::builder()
            .user_agent("Kuriume/0.1 (https://github.com/Kuriume/Kuriume)")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");

        Ok(Self {
            state: shared,
            download_dir,
            server_port: port,
            _server_handle: handle,
            trackers: effective,
            http_client,
        })
    }

    /// Add a torrent. Returns the torrent ID.
    const INIT_TIMEOUT_SECS: u64 = 60;

    pub async fn add_torrent(&self, source: &str) -> Result<usize> {
        // For HTTP(S) URLs (.torrent files), download with our own client
        // (proper User-Agent) to avoid being blocked by Cloudflare, then pass
        // the raw bytes to librqbit. Magnet URIs go through directly.
        let add_torrent = if source.starts_with("http://") || source.starts_with("https://") {
            let resp = self
                .http_client
                .get(source)
                .send()
                .await
                .map_err(|e| TorrentError::Engine(anyhow::anyhow!("download .torrent failed: {e}")))?;
            if !resp.status().is_success() {
                return Err(TorrentError::Engine(anyhow::anyhow!(
                    "download .torrent returned {}",
                    resp.status()
                )));
            }
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| TorrentError::Engine(anyhow::anyhow!("read .torrent body failed: {e}")))?;
            AddTorrent::from_bytes(bytes)
        } else {
            AddTorrent::from_url(source)
        };

        let extra_trackers: Vec<String> = self.trackers.clone();

        let opts = Some(AddTorrentOptions {
            overwrite: true,
            trackers: Some(extra_trackers),
            // Re-announce every 60s
            force_tracker_interval: Some(Duration::from_secs(60)),
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

        // Wait for metadata with a timeout
        let timeout_dur = Duration::from_secs(Self::INIT_TIMEOUT_SECS);
        match tokio::time::timeout(timeout_dur, handle.wait_until_initialized()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                warn!(id, error = %e, "torrent initialization failed");
                // Try to clean up the failed torrent
                let _ = self
                    .state
                    .session
                    .delete(TorrentIdOrHash::Id(id), true)
                    .await;
                return Err(TorrentError::Engine(
                    anyhow::anyhow!("torrent metadata resolution failed: {e}"),
                ));
            }
            Err(_elapsed) => {
                // Timed out — no peers / metadata not available
                warn!(id, timeout_secs = Self::INIT_TIMEOUT_SECS, "torrent metadata resolution timed out");
                // Clean up the stale torrent so it doesn't linger
                let _ = self
                    .state
                    .session
                    .delete(TorrentIdOrHash::Id(id), true)
                    .await;
                return Err(TorrentError::Timeout(Self::INIT_TIMEOUT_SECS));
            }
        }

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

    /// Get the HTTP streaming URL for a file in a torrent.
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

    /// Remove a torrent and optionally delete its data.
    pub async fn remove(&self, torrent_id: usize, delete_data: bool) -> Result<()> {
        self.state.handles.write().await.remove(&torrent_id);
        self.state
            .session
            .delete(TorrentIdOrHash::Id(torrent_id), delete_data)
            .await
            .context("failed to delete torrent")?;

        info!(torrent_id, delete_data, "torrent removed");
        Ok(())
    }

    /// Get the absolute path of a torrent file on disk.
    pub async fn file_path(&self, torrent_id: usize, file_id: usize) -> Result<PathBuf> {
        let handles = self.state.handles.read().await;
        let torrent = handles
            .get(&torrent_id)
            .ok_or(TorrentError::NotFound(torrent_id))?;

        let rel_path = torrent
            .with_metadata(|meta| {
                meta.file_infos
                    .get(file_id)
                    .map(|fi| fi.relative_filename.clone())
            })
            .map_err(|_| TorrentError::MetadataNotReady(torrent_id))?
            .ok_or(TorrentError::FileNotFound { torrent_id, file_id })?;

        Ok(self.download_dir.join(rel_path))
    }

    /// Get the streaming server port.
    pub fn port(&self) -> u16 {
        self.server_port
    }
}
