use crate::diagnostics::{observe, operation, Action, Event};
use kuriume_provider::{
    AnimeInfo, AnimeProvider, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery,
    GetListQuery, PagedResult, SearchQuery,
};
use std::{collections::HashMap, sync::Arc};
use tauri::{command, State};

/// Catalog providers are deliberately independent from playback sources.
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

    /// A namespaced catalog ID (`anilist:1`, `bangumi:1`) names its own
    /// catalog, whatever the caller passed: saved items keep opening from
    /// the catalog they came from after the browsing source changes.
    fn for_id(&self, name: &str, id: &str) -> Result<&Arc<dyn AnimeProvider>, String> {
        let owner = match id.split_once(':').map(|(prefix, _)| prefix) {
            Some("anilist") => "AniList",
            Some("bangumi") => "Bangumi",
            _ => name,
        };
        self.get(owner)
    }

    fn get(&self, name: &str) -> Result<&Arc<dyn AnimeProvider>, String> {
        self.providers
            .get(name)
            .ok_or_else(|| format!("Catalog provider not found: {name}"))
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
    language: Option<&str>,
) -> Result<PagedResult<AnimeInfo>, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::List),
        state.get(provider)?.get_list(query, language),
    )
    .await
    .map_err(|error| error.to_string())
}

#[command]
pub(crate) async fn search(
    state: State<'_, ProviderState>,
    provider: &str,
    query: SearchQuery,
    language: Option<&str>,
) -> Result<PagedResult<AnimeInfo>, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::Search),
        state.get(provider)?.search(query, language),
    )
    .await
    .map_err(|error| error.to_string())
}

#[command]
pub(crate) async fn get_detail(
    state: State<'_, ProviderState>,
    provider: &str,
    id: &str,
    language: Option<&str>,
) -> Result<AnimeInfo, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::Detail),
        state.for_id(provider, id)?.get_detail(id, language),
    )
    .await
    .map_err(|error| error.to_string())
}

#[command]
pub(crate) async fn get_episodes(
    state: State<'_, ProviderState>,
    provider: &str,
    query: GetEpisodesQuery,
) -> Result<Vec<EpisodesInfo>, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::Episodes),
        state.for_id(provider, &query.id)?.get_episodes(query),
    )
    .await
    .map_err(|error| error.to_string())
}

#[command]
pub(crate) async fn get_calendar(
    state: State<'_, ProviderState>,
    provider: &str,
    language: Option<&str>,
) -> Result<Vec<CalendarEntry>, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::Calendar),
        state.get(provider)?.get_calendar(language),
    )
    .await
    .map_err(|error| error.to_string())
}

#[command]
pub(crate) async fn get_characters(
    state: State<'_, ProviderState>,
    provider: &str,
    id: &str,
) -> Result<Vec<CharacterInfo>, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::Characters),
        state.for_id(provider, id)?.get_characters(id),
    )
    .await
    .map_err(|error| error.to_string())
}
