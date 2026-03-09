use kuriume_provider::{
    AnimeInfo, AnimeProvider, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult,
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
pub(crate) async fn get_characters(
    state: State<'_, ProviderState>,
    provider: &str,
    id: &str,
) -> Result<Vec<CharacterInfo>, String> {
    let provider = state.get(provider).ok_or("Provider not found")?;
    provider.get_characters(id).await.map_err(|e| e.to_string())
}
