use async_trait::async_trait;
use serde::Serialize;

use crate::error::Result;

// ---------------------------------------------------------------------------
// Shared types for all torrent providers
// ---------------------------------------------------------------------------

/// A resolved anime reference within a torrent provider.
#[derive(Debug, Clone, Serialize)]
pub struct TorrentSourceEntry {
    /// Provider-internal identifier (e.g. Mikan bangumi ID).
    pub provider_id: String,
    pub title: String,
    pub cover: Option<String>,
    /// The bgm.tv subject ID this maps to, if known.
    pub bgm_id: Option<String>,
}

/// A release / subtitle group.
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleGroup {
    pub id: String,
    pub name: String,
}

/// A single torrent entry.
#[derive(Debug, Clone, Serialize)]
pub struct TorrentEntry {
    pub title: String,
    pub episode_hash: String,
    pub torrent_url: String,
    pub magnet: String,
    pub size: String,
    pub publish_date: String,
}

/// All torrents from one release group.
#[derive(Debug, Clone, Serialize)]
pub struct GroupTorrents {
    pub group: SubtitleGroup,
    pub torrents: Vec<TorrentEntry>,
}

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// Unified interface for torrent / resource providers (Mikan, Nyaa, etc.).
#[async_trait]
pub trait TorrentProvider: Send + Sync {
    /// Provider name used for identification and routing.
    fn name(&self) -> &str;

    /// Resolve a bgm.tv anime to this provider.
    ///
    /// `keyword` is used for initial search; `bgm_id` is matched against
    /// the provider's own bgm.tv mapping to find the correct entry.
    async fn resolve(
        &self,
        keyword: &str,
        bgm_id: &str,
    ) -> Result<Option<TorrentSourceEntry>>;

    /// List release / subtitle groups for an anime.
    ///
    /// `anime_id` is the provider-internal identifier returned by [`resolve`].
    async fn get_groups(&self, anime_id: &str) -> Result<Vec<SubtitleGroup>>;

    /// Get torrents for a specific release group.
    async fn get_group_torrents(
        &self,
        anime_id: &str,
        group_id: &str,
    ) -> Result<Vec<TorrentEntry>>;

    /// Get all groups with their torrents.
    ///
    /// Default implementation fetches groups then each group's torrents
    /// sequentially. Providers may override for concurrency.
    async fn get_all_torrents(&self, anime_id: &str) -> Result<Vec<GroupTorrents>> {
        let groups = self.get_groups(anime_id).await?;
        let mut result = Vec::with_capacity(groups.len());
        for group in groups {
            let torrents = self.get_group_torrents(anime_id, &group.id).await?;
            result.push(GroupTorrents { group, torrents });
        }
        Ok(result)
    }
}
