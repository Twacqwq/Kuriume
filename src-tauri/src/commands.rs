use crate::diagnostics::{observe, operation, Action, Event};
use crate::store_commands::StoreState;
use kuriume_provider::{
    find_counterpart, AnimeInfo, AnimeProvider, CalendarEntry, CharacterInfo, EpisodesInfo,
    GetEpisodesQuery, GetListQuery, MediaKind, PagedResult, RelatedMedia, SearchQuery,
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

/// The catalog manga are browsed in, whatever the anime catalog is.
const MANGA_CATALOG: &str = "bangumi";

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

/// Anime and manga linked to a catalog entry (its source manga, adaptations,
/// sequels), from the catalog the ID names.
#[command]
pub(crate) async fn get_relations(
    state: State<'_, ProviderState>,
    provider: &str,
    id: &str,
) -> Result<Vec<RelatedMedia>, String> {
    observe(
        Event::CatalogRequest,
        provider,
        operation(),
        Some(Action::Relations),
        state.for_id(provider, id)?.get_relations(id),
    )
    .await
    .map_err(|error| error.to_string())
}

/// The Bangumi entry for an AniList manga that was never saved (reached
/// through an anime's related works), found by its titles; `None` when
/// there is no confident match. Manga are browsed in Bangumi only.
#[command]
pub(crate) async fn find_manga_counterpart(
    state: State<'_, ProviderState>,
    id: &str,
) -> Result<Option<String>, String> {
    let Some(("anilist", _)) = id.split_once(':') else {
        return Ok(None);
    };
    let info = observe(
        Event::CatalogRequest,
        "AniList",
        operation(),
        Some(Action::Detail),
        state.get("AniList")?.get_detail(id, None),
    )
    .await
    .map_err(|error| error.to_string())?;
    if info.kind != MediaKind::Manga {
        return Ok(None);
    }
    // Bangumi names books by their original title: search that first.
    let mut titles: Vec<String> = info.title_native.iter().cloned().collect();
    titles.extend([info.title.clone(), info.title_en.clone()]);
    titles.extend(info.title_cn.iter().cloned());
    titles.extend(info.search_titles.iter().cloned());
    let found = observe(
        Event::CatalogRequest,
        "Bangumi",
        operation(),
        Some(Action::Search),
        find_counterpart(state.get("Bangumi")?.as_ref(), MediaKind::Manga, &titles, 0),
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(found.map(|info| info.id))
}

/// The chosen catalog's ID for a saved entry from the other catalog
/// (`anilist:21` → `bangumi:975` while Bangumi is the source; Bangumi for
/// every manga), or `None` when
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
        let anime_catalog = store
            .get_settings()
            .map_err(|error| error.to_string())?
            .catalog_source;
        let Some(media_id) = store
            .media_for_identity(source, external_id)
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };
        let media = store
            .get_media(&media_id)
            .map_err(|error| error.to_string())?;
        // The 数据源 setting picks the anime catalog; manga always use Bangumi.
        let target = if media.as_ref().is_some_and(|media| media.kind == "manga") {
            MANGA_CATALOG.to_owned()
        } else {
            anime_catalog
        };
        if target == source {
            return Ok(None);
        }
        let identities = store
            .external_identity_list(&media_id)
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
    let kind = if media.kind == "manga" {
        MediaKind::Manga
    } else {
        MediaKind::Anime
    };
    let found = observe(
        Event::CatalogRequest,
        target_name,
        operation(),
        Some(Action::Search),
        find_counterpart(
            provider.as_ref(),
            kind,
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
