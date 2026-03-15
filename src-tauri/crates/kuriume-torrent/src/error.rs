use thiserror::Error;

#[derive(Debug, Error)]
pub enum TorrentError {
    #[error("engine error: {0}")]
    Engine(#[from] anyhow::Error),

    #[error("torrent not found: {0}")]
    NotFound(usize),

    #[error("file not found: torrent {torrent_id} file {file_id}")]
    FileNotFound { torrent_id: usize, file_id: usize },

    #[error("metadata not resolved for torrent {0}")]
    MetadataNotReady(usize),

    #[error("torrent metadata resolution timed out after {0} seconds (no peers available)")]
    Timeout(u64),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, TorrentError>;
