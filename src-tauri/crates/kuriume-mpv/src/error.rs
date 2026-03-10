use thiserror::Error;

#[derive(Debug, Error)]
pub enum MpvError {
    #[error("mpv error: {0}")]
    Mpv(String),

    #[error("property not available: {0}")]
    PropertyUnavailable(String),

    #[error("player not initialized")]
    NotInitialized,
}

impl From<libmpv2::Error> for MpvError {
    fn from(e: libmpv2::Error) -> Self {
        MpvError::Mpv(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, MpvError>;
