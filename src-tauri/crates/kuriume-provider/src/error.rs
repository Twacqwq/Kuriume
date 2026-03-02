use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("HTTP 请求失败: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),

    #[error("数据源错误: {0}")]
    Source(String),

    #[error("未找到: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, ProviderError>;
