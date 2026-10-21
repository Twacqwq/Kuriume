use crate::diagnostics::{observe, operation, Action, Event};
use crate::store_commands::StoreState;
use kuriume_provider::{
    find_counterpart, AnimeInfo, AnimeProvider, CalendarEntry, CharacterInfo, EpisodesInfo,
    GetEpisodesQuery, GetListQuery, PagedResult, SearchQuery,
};
use std::{collections::HashMap, sync::Arc};
use tauri::{command, AppHandle, State};

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
        let owner = id
            .split_once(':')
            .and_then(|(prefix, _)| provider_name(prefix))
            .unwrap_or(name);
        self.get(owner)
    }

    fn get(&self, name: &str) -> Result<&Arc<dyn AnimeProvider>, String> {
        self.providers
            .get(name)
            .ok_or_else(|| format!("Catalog provider not found: {name}"))
    }
}

/// Provider name for a catalog source / ID prefix (`anilist`, `bangumi`).
fn provider_name(source: &str) -> Option<&'static str> {
    match source {
        "anilist" => Some("AniList"),
        "bangumi" => Some("Bangumi"),
        _ => None,
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

/// The chosen catalog's ID for a saved entry from the other catalog
/// (`anilist:21` → `bangumi:975` while Bangumi is the source), or `None` when
/// `id` already belongs to the chosen catalog, was never saved, or has no
/// confident match. A match found by title is remembered on the saved media,
/// so history, library and playback bindings carry over.
#[command]
pub(crate) async fn catalog_counterpart(
    catalog: State<'_, ProviderState>,
    store: State<'_, StoreState>,
    app: AppHandle,
    id: &str,
) -> Result<Option<String>, String> {
    let Some((source, external_id)) = id.split_once(':') else {
        return Ok(None);
    };
    let saved = store.with_store(&app, |store| {
        let target = store
            .get_settings()
            .map_err(|error| error.to_string())?
            .catalog_source;
        if target == source {
            return Ok(None);
        }
        let Some(media_id) = store
            .media_for_identity(source, external_id)
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };
        let identities = store
            .external_identity_list(&media_id)
            .map_err(|error| error.to_string())?;
        let media = store
            .get_media(&media_id)
            .map_err(|error| error.to_string())?;
        Ok(Some((target, media_id, identities, media)))
    })?;
    let Some((target, media_id, identities, media)) = saved else {
        return Ok(None);
    };
    if let Some(identity) = identities
        .iter()
        .find(|identity| identity.provider == target && identity.scope == "title")
    {
        return Ok(Some(format!("{target}:{}", identity.external_id)));
    }
    let (Some(media), Some(target_name), Some(source_name)) =
        (media, provider_name(&target), provider_name(source))
    else {
        return Ok(None);
    };
    let mut titles = vec![media.title];
    titles.extend(catalog.get(source_name)?.known_titles(id));
    let provider = catalog.get(target_name)?;
    let found = observe(
        Event::CatalogRequest,
        target_name,
        operation(),
        Some(Action::Search),
        find_counterpart(
            provider.as_ref(),
            &titles,
            u32::try_from(media.total_episodes).unwrap_or(0),
        ),
    )
    .await
    .map_err(|error| error.to_string())?;
    let Some((_, found_id)) = found.as_ref().and_then(|info| info.id.split_once(':')) else {
        return Ok(None);
    };
    store.with_store(&app, |store| {
        store
            .link_catalog_identity(&media_id, &target, found_id)
            .map_err(|error| error.to_string())
    })?;
    Ok(Some(format!("{target}:{found_id}")))
}
