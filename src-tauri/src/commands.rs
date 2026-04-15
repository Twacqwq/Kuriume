use kuriume_provider::{
    AnimeInfo, AnimeProvider, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery,
    GetListQuery, GroupTorrents, PagedResult, SearchQuery, SubtitleGroup, TorrentEntry,
    TorrentProvider, TorrentSourceEntry,
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
// Torrent provider commands (multi-source)
// ---------------------------------------------------------------------------

pub struct TorrentProviderState {
    providers: HashMap<String, Arc<dyn TorrentProvider>>,
}

impl TorrentProviderState {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    pub fn register(&mut self, provider: Arc<dyn TorrentProvider>) {
        self.providers.insert(provider.name().to_string(), provider);
    }

    fn get(&self, name: &str) -> Option<&Arc<dyn TorrentProvider>> {
        self.providers.get(name)
    }

    pub fn list_providers(&self) -> Vec<String> {
        let mut names: Vec<String> = self.providers.keys().cloned().collect();
        names.sort();
        names
    }
}

impl Default for TorrentProviderState {
    fn default() -> Self {
        Self::new()
    }
}

/// Resolve a bgm.tv anime to a torrent provider.
#[command]
pub(crate) async fn torrent_source_resolve(
    state: State<'_, TorrentProviderState>,
    provider: &str,
    keyword: &str,
    bgm_id: &str,
) -> Result<Option<TorrentSourceEntry>, String> {
    let p = state
        .get(provider)
        .ok_or_else(|| format!("Torrent provider not found: {provider}"))?;
    p.resolve(keyword, bgm_id).await.map_err(|e| e.to_string())
}

/// List subtitle / release groups for an anime.
#[command]
pub(crate) async fn torrent_source_get_groups(
    state: State<'_, TorrentProviderState>,
    provider: &str,
    anime_id: &str,
) -> Result<Vec<SubtitleGroup>, String> {
    let p = state
        .get(provider)
        .ok_or_else(|| format!("Torrent provider not found: {provider}"))?;
    p.get_groups(anime_id).await.map_err(|e| e.to_string())
}

/// Get torrents for a specific release group.
#[command]
pub(crate) async fn torrent_source_get_group_torrents(
    state: State<'_, TorrentProviderState>,
    provider: &str,
    anime_id: &str,
    group_id: &str,
) -> Result<Vec<TorrentEntry>, String> {
    let p = state
        .get(provider)
        .ok_or_else(|| format!("Torrent provider not found: {provider}"))?;
    p.get_group_torrents(anime_id, group_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get all release groups with their torrent entries.
#[command]
pub(crate) async fn torrent_source_get_all_torrents(
    state: State<'_, TorrentProviderState>,
    provider: &str,
    anime_id: &str,
) -> Result<Vec<GroupTorrents>, String> {
    let p = state
        .get(provider)
        .ok_or_else(|| format!("Torrent provider not found: {provider}"))?;
    p.get_all_torrents(anime_id)
        .await
        .map_err(|e| e.to_string())
}

/// List all registered torrent provider names.
#[command]
pub(crate) async fn torrent_source_list_providers(
    state: State<'_, TorrentProviderState>,
) -> Result<Vec<String>, String> {
    Ok(state.list_providers())
}
