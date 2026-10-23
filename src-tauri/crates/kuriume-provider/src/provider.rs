use async_trait::async_trait;

use crate::error::Result;
use crate::models::{
    AnimeInfo, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult, RelatedMedia, SearchQuery,
};

/// Unified interface for catalog data sources. Anime and manga share it:
/// `search` and `get_list` take a kind; details and characters take any ID.
#[async_trait]
pub trait AnimeProvider: Send + Sync {
    /// Data-source name (used for identification and logging).
    fn name(&self) -> &str;

    /// Search for anime by keyword.
    async fn search(
        &self,
        query: SearchQuery,
        language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>>;

    /// Get anime details by the data-source internal ID.
    async fn get_detail(&self, id: &str, language: Option<&str>) -> Result<AnimeInfo>;

    /// Get anime list
    async fn get_list(
        &self,
        query: GetListQuery,
        language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>>;

    /// Get anime episodes
    async fn get_episodes(&self, query: GetEpisodesQuery) -> Result<Vec<EpisodesInfo>>;

    /// Get anime characters
    async fn get_characters(&self, id: &str) -> Result<Vec<CharacterInfo>>;

    /// Anime and manga linked to an entry (source manga, adaptations,
    /// sequels...). Empty by default.
    async fn get_relations(&self, _id: &str) -> Result<Vec<RelatedMedia>> {
        Ok(Vec::new())
    }

    /// Get weekly broadcast calendar.
    async fn get_calendar(&self, language: Option<&str>) -> Result<Vec<CalendarEntry>>;

    /// Titles this catalog knows for an ID without a network request, used
    /// to find the same work in another catalog. Empty by default.
    fn known_titles(&self, _id: &str) -> Vec<String> {
        Vec::new()
    }
}
