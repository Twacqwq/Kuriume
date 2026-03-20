use kuriume_provider::{
    AnimeInfo, AnimeProvider, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery,
    GetListQuery, Mikan, MikanBangumiEntry, MikanTorrentEntry, PagedResult, SearchQuery,
    SubtitleGroup, SubtitleGroupTorrents,
};
use std::{collections::HashMap, sync::Arc};
use tauri::{command, State};

pub struct ProviderState {
    providers: HashMap<String, Arc<dyn AnimeProvider>>,
}

impl ProviderState {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    pub fn register(&mut self, provider: Arc<dyn AnimeProvider>) {
        self.providers.insert(provider.name().to_string(), provider);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn AnimeProvider>> {
        self.providers.get(name)
    }
}

impl Default for ProviderState {
    fn default() -> Self {
        Self::new()
    }
}

#[command]
pub(crate) async fn get_list(
    state: State<'_, ProviderState>,
    provider: &str,
    query: GetListQuery,
) -> Result<PagedResult<AnimeInfo>, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider.get_list(query).await.map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn search(
    state: State<'_, ProviderState>,
    provider: &str,
    query: SearchQuery,
) -> Result<PagedResult<AnimeInfo>, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider.search(query).await.map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn get_detail(
    state: State<'_, ProviderState>,
    provider: &str,
    id: &str,
) -> Result<AnimeInfo, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider.get_detail(id).await.map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn get_episodes(
    state: State<'_, ProviderState>,
    provider: &str,
    query: GetEpisodesQuery,
) -> Result<Vec<EpisodesInfo>, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider
        .get_episodes(query)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn get_calendar(
    state: State<'_, ProviderState>,
    provider: &str,
) -> Result<Vec<CalendarEntry>, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider.get_calendar().await.map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn get_characters(
    state: State<'_, ProviderState>,
    provider: &str,
    id: &str,
) -> Result<Vec<CharacterInfo>, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider.get_characters(id).await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Mikan commands
// ---------------------------------------------------------------------------

pub struct MikanState {
    pub mikan: Arc<Mikan>,
}

impl MikanState {
    pub fn new() -> Self {
        Self {
            mikan: Arc::new(Mikan::new()),
        }
    }
}

impl Default for MikanState {
    fn default() -> Self {
        Self::new()
    }
}

/// Search Mikan for anime matching the keyword.
#[command]
pub(crate) async fn mikan_search(
    state: State<'_, MikanState>,
    keyword: &str,
) -> Result<Vec<MikanBangumiEntry>, String> {
    state
        .mikan
        .search_bangumi(keyword)
        .await
        .map_err(|e| e.to_string())
}

/// Find the Mikan entry whose bgm.tv subject ID matches.
#[command]
pub(crate) async fn mikan_resolve(
    state: State<'_, MikanState>,
    keyword: &str,
    bgm_id: &str,
) -> Result<Option<MikanBangumiEntry>, String> {
    state
        .mikan
        .find_mikan_id_by_bgm(keyword, bgm_id)
        .await
        .map_err(|e| e.to_string())
}

/// List subtitle groups for a Mikan bangumi.
#[command]
pub(crate) async fn mikan_get_subgroups(
    state: State<'_, MikanState>,
    mikan_id: &str,
) -> Result<Vec<SubtitleGroup>, String> {
    state
        .mikan
        .get_subtitle_groups(mikan_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get torrent entries for a specific subgroup.
#[command]
pub(crate) async fn mikan_get_subgroup_torrents(
    state: State<'_, MikanState>,
    mikan_id: &str,
    subgroup_id: &str,
) -> Result<Vec<MikanTorrentEntry>, String> {
    state
        .mikan
        .get_subgroup_torrents(mikan_id, subgroup_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get all subtitle groups with their torrent entries.
#[command]
pub(crate) async fn mikan_get_all_torrents(
    state: State<'_, MikanState>,
    mikan_id: &str,
) -> Result<Vec<SubtitleGroupTorrents>, String> {
    state
        .mikan
        .get_all_torrents(mikan_id)
        .await
        .map_err(|e| e.to_string())
}
