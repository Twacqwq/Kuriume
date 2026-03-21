use async_trait::async_trait;

use crate::error::Result;
use crate::models::{
    AnimeInfo, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult, SearchQuery,
};

/// Unified interface for anime data sources.
#[async_trait]
pub trait AnimeProvider: Send + Sync {
    /// Data-source name (used for identification and logging).
    fn name(&self) -> &str;

    /// Search for anime by keyword.
    async fn search(&self, query: SearchQuery) -> Result<PagedResult<AnimeInfo>>;

    /// Get anime details by the data-source internal ID.
    async fn get_detail(&self, id: &str) -> Result<AnimeInfo>;

    /// Get anime list
    async fn get_list(&self, query: GetListQuery) -> Result<PagedResult<AnimeInfo>>;

    /// Get anime episodes
    async fn get_episodes(&self, query: GetEpisodesQuery) -> Result<Vec<EpisodesInfo>>;

    /// Get anime characters
    async fn get_characters(&self, id: &str) -> Result<Vec<CharacterInfo>>;

    /// Get weekly broadcast calendar.
    async fn get_calendar(&self) -> Result<Vec<CalendarEntry>>;
}
