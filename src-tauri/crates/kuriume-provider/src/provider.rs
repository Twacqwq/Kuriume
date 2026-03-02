use async_trait::async_trait;

use crate::error::Result;
use crate::models::{AnimeInfo, PagedResult, SearchQuery};

/// Unified interface for anime series data sources
///
/// Each data source (such as Bangumi) implements this trait,
/// and internally holds its own HTTP client to request the corresponding API.
#[async_trait]
pub trait AnimeProvider: Send + Sync {
    /// 数据源名称（用于标识和日志）
    fn name(&self) -> &str;

    /// 按关键词搜索番剧
    async fn search(&self, query: SearchQuery) -> Result<PagedResult<AnimeInfo>>;

    /// 根据数据源内部 ID 获取番剧详情
    async fn get_detail(&self, id: &str) -> Result<AnimeInfo>;

    /// 获取热门 / 排行榜番剧
    async fn get_trending(&self, limit: u32) -> Result<Vec<AnimeInfo>>;
}
