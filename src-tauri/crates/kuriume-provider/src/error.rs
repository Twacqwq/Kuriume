use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON deserialization failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Data-source error: {0}")]
    Source(String),

    #[error("Not found: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, ProviderError>;
