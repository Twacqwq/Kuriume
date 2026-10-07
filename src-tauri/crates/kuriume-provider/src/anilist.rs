use async_trait::async_trait;
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

use crate::error::{ProviderError, Result};
use crate::models::{
    AnimeInfo, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult, SearchQuery, SortBy, Weekday,
};
use crate::provider::AnimeProvider;

const ANILIST_API: &str = "https://graphql.anilist.co";
const BANGUMI_API: &str = "https://api.bgm.tv";
const USER_AGENT: &str = "Kuriume/0.1 (https://github.com/Kuriume/Kuriume)";
const CHINESE_BATCH_BUDGET: Duration = Duration::from_secs(6);
const CHINESE_REQUEST_TIMEOUT: Duration = Duration::from_secs(4);
const CHINESE_CACHE_LIMIT: usize = 512;

const MEDIA_FIELDS: &str = r#"
  id
  idMal
  title { romaji english native }
  synonyms
  coverImage { extraLarge large }
  bannerImage
  averageScore
  seasonYear
  episodes
  duration
  startDate { year month day }
  genres
  description(asHtml: false)
  status
  format
  nextAiringEpisode { episode }
  studios(isMain: true) { nodes { name } }
"#;

#[derive(Clone)]
pub struct AniList {
    client: Client,
    chinese_metadata: Arc<Mutex<HashMap<u64, ChineseCacheEntry>>>,
    chinese_requests: Arc<Semaphore>,
}

impl AniList {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("failed to build AniList HTTP client");
        Self {
            client,
            chinese_metadata: Arc::new(Mutex::new(HashMap::new())),
            chinese_requests: Arc::new(Semaphore::new(4)),
        }
    }

    async fn graphql<T: DeserializeOwned>(&self, query: String, variables: Value) -> Result<T> {
        let response = self
            .client
            .post(ANILIST_API)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::Source(format!(
                "AniList returned HTTP {}",
                response.status()
            )));
        }

        let payload: GraphQlResponse<T> = response.json().await?;
        if let Some(data) = payload.data {
            return Ok(data);
        }
        let message = payload
            .errors
            .first()
            .map(|error| error.message.clone())
            .unwrap_or_else(|| "AniList returned no data".into());
        Err(ProviderError::Source(message))
    }

    fn parse_id(id: &str) -> Result<u64> {
        id.strip_prefix("anilist:")
            .unwrap_or(id)
            .parse::<u64>()
            .map_err(|_| ProviderError::Parse(format!("Invalid AniList media ID: {id}")))
    }

    async fn page(
        &self,
        page: u32,
        per_page: u32,
        year: Option<u32>,
        search: Option<&str>,
        sort: &str,
        language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>> {
        let query = format!(
            r#"
            query ($page: Int!, $perPage: Int!, $year: Int, $search: String, $sort: [MediaSort!]!) {{
              Page(page: $page, perPage: $perPage) {{
                pageInfo {{ total currentPage perPage hasNextPage }}
                media(
                  type: ANIME
                  isAdult: false
                  seasonYear: $year
                  search: $search
                  sort: $sort
                ) {{
                  {MEDIA_FIELDS}
                }}
              }}
            }}
            "#
        );
        let data: PageResponse = self
            .graphql(
                query,
                json!({
                    "page": page,
                    "perPage": per_page,
                    "year": year,
                    "search": search,
                    "sort": [sort],
                }),
            )
            .await?;

        let offset = page.saturating_sub(1) * per_page;
        // AniList's search total can be an estimate (e.g. 5000). The last-page
        // flag is authoritative; do not keep requesting empty pages after it.
        let total = catalog_page_total(&data.page, offset, per_page);
        Ok(PagedResult {
            data: self.localized_list(data.page.media, language).await,
            total,
            limit: per_page,
            offset,
        })
    }

    async fn media(&self, id: u64) -> Result<Media> {
        let query = format!(
            r#"
            query ($id: Int!) {{
              Media(id: $id, type: ANIME, isAdult: false) {{
                {MEDIA_FIELDS}
              }}
            }}
            "#
        );
        let data: MediaResponse = self.graphql(query, json!({ "id": id })).await?;
        Ok(data.media)
    }

    async fn localized_anime_info(&self, media: Media) -> AnimeInfo {
        let request = LocalizationRequest::from(&media);
        let mut info = AnimeInfo::from(media);
        if let Some(metadata) = self.chinese_metadata_for(request).await {
            metadata.apply_to(&mut info);
        }
        info
    }

    async fn localized_list(&self, media: Vec<Media>, language: Option<&str>) -> Vec<AnimeInfo> {
        let mut requests = Vec::new();
        let mut items: Vec<AnimeInfo> = media
            .into_iter()
            .enumerate()
            .map(|(index, media)| {
                // AniList already supplies Chinese aliases for many titles. Only
                // fill gaps; synopsis enrichment is deferred to the detail view.
                if language == Some("zh") && preferred_chinese_title(&media.synonyms).is_none() {
                    requests.push((index, LocalizationRequest::from(&media)));
                }
                AnimeInfo::from(media)
            })
            .collect();
        let mut pending = JoinSet::new();
        for (index, request) in requests {
            let provider = self.clone();
            pending.spawn(async move { (index, provider.chinese_metadata_for(request).await) });
        }
        let deadline = tokio::time::Instant::now() + CHINESE_BATCH_BUDGET;
        while !pending.is_empty() {
            match tokio::time::timeout_at(deadline, pending.join_next()).await {
                Ok(Some(Ok((index, Some(metadata))))) => metadata.apply_to(&mut items[index]),
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => break,
            }
        }
        // Dropping the set cancels unfinished lookups. Their cache slots remain
        // empty so a later refresh can retry; the catalog itself always loads.
        items
    }

    async fn chinese_metadata_for(&self, request: LocalizationRequest) -> Option<ChineseMetadata> {
        let entry = {
            let mut cache = self.chinese_metadata.lock().await;
            if let Some(entry) = cache.get_mut(&request.id) {
                entry.last_used = Instant::now();
                Arc::clone(&entry.value)
            } else {
                if cache.len() >= CHINESE_CACHE_LIMIT {
                    let oldest_idle = cache
                        .iter()
                        .filter(|(_, entry)| Arc::strong_count(&entry.value) == 1)
                        .min_by_key(|(_, entry)| entry.last_used)
                        .map(|(id, _)| *id);
                    if let Some(id) = oldest_idle {
                        cache.remove(&id);
                    }
                }
                let value = Arc::new(Mutex::new(None));
                // If every slot is in use, keep this lookup uncached rather than
                // evicting a live request or growing the map without a bound.
                if cache.len() < CHINESE_CACHE_LIMIT {
                    cache.insert(
                        request.id,
                        ChineseCacheEntry {
                            value: Arc::clone(&value),
                            last_used: Instant::now(),
                        },
                    );
                }
                value
            }
        };
        // Per-title lock coalesces concurrent home, search and detail requests.
        let mut cached = entry.lock().await;
        if let Some(value) = cached.as_ref().filter(|value| value.is_fresh()) {
            return value.metadata.clone();
        }
        let _permit = self.chinese_requests.acquire().await.ok()?;
        let result = self
            .fetch_chinese_metadata(&request.aliases, request.year, request.episode_count)
            .await;
        let value = CachedChineseMetadata::from_result(result);
        let metadata = value.metadata.clone();
        *cached = Some(value);
        metadata
    }

    async fn fetch_chinese_metadata(
        &self,
        aliases: &[String],
        year: Option<u16>,
        episode_count: Option<u32>,
    ) -> Result<Option<ChineseMetadata>> {
        let keyword = aliases
            .iter()
            .find(|title| contains_kana(title))
            .or_else(|| aliases.first());
        let Some(keyword) = keyword else {
            return Ok(None);
        };
        let payload = self.bangumi_search(keyword, 10, 0).await?;
        let title_keys: BTreeSet<String> = aliases
            .iter()
            .map(|title| normalized_catalog_title(title))
            .filter(|title| !title.is_empty())
            .collect();
        let alternate_keys: BTreeSet<String> = aliases
            .iter()
            .filter_map(|title| localization_base_title(title))
            .map(normalized_catalog_title)
            .collect();

        let metadata = payload
            .data
            .into_iter()
            .filter_map(|subject| {
                let score = bangumi_match_score(&subject, &title_keys, year, episode_count).max(
                    bangumi_variant_score(&subject, &alternate_keys, year, episode_count),
                );
                (score >= 80).then_some((score, subject))
            })
            .max_by_key(|(score, _)| *score)
            .and_then(|(_, subject)| subject.into_metadata());
        Ok(metadata)
    }

    async fn bangumi_search(
        &self,
        keyword: &str,
        limit: u32,
        offset: u32,
    ) -> Result<BangumiSearchResponse> {
        let response = self
            .client
            .post(format!("{BANGUMI_API}/v0/search/subjects"))
            .timeout(CHINESE_REQUEST_TIMEOUT)
            .query(&[("limit", limit), ("offset", offset)])
            .json(&json!({
                "keyword": keyword,
                "sort": "match",
                "filter": { "type": [2], "nsfw": false },
            }))
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }

    async fn search_chinese(&self, query: &SearchQuery) -> Result<PagedResult<AnimeInfo>> {
        // This only bridges search names. All returned identities and playback
        // aliases still belong to AniList; no parallel Bangumi catalog is added.
        let limit = query.limit.clamp(1, 25);
        let keyword = zhconv::zhconv(query.keyword.trim(), zhconv::Variant::ZhHans);
        let subjects = self.bangumi_search(&keyword, limit, query.offset).await?;
        let mut result = PagedResult {
            data: Vec::new(),
            total: subjects.total,
            limit,
            offset: query.offset,
        };
        let mut seen = BTreeSet::new();
        let mut pending = subjects.data.into_iter();
        loop {
            // A full page of aliases exceeds AniList's query complexity limit.
            // Ten titles leave headroom without making a request per title.
            let batch: Vec<_> = pending.by_ref().take(10).collect();
            if batch.is_empty() {
                break;
            }
            // Search text is passed in variables, never interpolated into GraphQL.
            let variables = batch
                .iter()
                .enumerate()
                .map(|(i, subject)| (format!("s{i}"), json!(subject.name)))
                .collect::<serde_json::Map<String, Value>>();
            let declarations = (0..batch.len())
                .map(|i| format!("$s{i}: String!"))
                .collect::<Vec<_>>()
                .join(",");
            let fields = (0..batch.len()).map(|i| format!(
                "r{i}: Page(perPage: 5) {{ media(type: ANIME, isAdult: false, search: $s{i}, sort: SEARCH_MATCH) {{ {MEDIA_FIELDS} }} }}"
            )).collect::<Vec<_>>().join("\n");
            let mut matches: HashMap<String, SearchMediaPage> = self
                .graphql(
                    format!("query ({declarations}) {{ {fields} }}"),
                    Value::Object(variables),
                )
                .await?;
            for (i, subject) in batch.into_iter().enumerate() {
                let candidates = matches.remove(&format!("r{i}")).ok_or_else(|| {
                    ProviderError::Source("AniList returned incomplete search results".into())
                })?;
                if let Some(media) = match_search_subject(&subject, candidates.media) {
                    if !seen.insert(media.id) {
                        continue;
                    }
                    let mut info = AnimeInfo::from(media);
                    if let Some(metadata) = subject.into_metadata() {
                        metadata.apply_to(&mut info);
                    }
                    result.data.push(info);
                }
            }
        }
        Ok(result)
    }
}

impl Default for AniList {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AnimeProvider for AniList {
    fn name(&self) -> &str {
        "AniList"
    }

    async fn search(
        &self,
        query: SearchQuery,
        language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>> {
        let limit = query.limit.clamp(1, 50);
        let page = query.offset / limit + 1;
        if query.keyword.trim().is_empty() {
            return Ok(PagedResult {
                data: Vec::new(),
                total: 0,
                limit,
                offset: query.offset,
            });
        }
        if query.keyword.chars().any(is_han) && !contains_kana(&query.keyword) {
            let result = self.search_chinese(&query).await?;
            // An AniList-only title may not yet be indexed by Bangumi.
            if result.total > 0 || query.offset > 0 {
                return Ok(result);
            }
        }
        self.page(
            page,
            limit,
            None,
            Some(query.keyword.trim()),
            "SEARCH_MATCH",
            language,
        )
        .await
    }

    async fn get_detail(&self, id: &str, language: Option<&str>) -> Result<AnimeInfo> {
        let id = Self::parse_id(id)?;
        let media = self.media(id).await?;
        if language == Some("zh") {
            Ok(self.localized_anime_info(media).await)
        } else {
            Ok(media.into())
        }
    }

    async fn get_list(
        &self,
        query: GetListQuery,
        language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>> {
        let limit = query.limit.clamp(1, 50);
        let page = query.offset / limit + 1;
        let sort = match query.soft.unwrap_or_default() {
            SortBy::Rank => "TRENDING_DESC",
            SortBy::Date => "START_DATE_DESC",
        };
        self.page(page, limit, query.year, None, sort, language)
            .await
    }

    async fn get_episodes(&self, query: GetEpisodesQuery) -> Result<Vec<EpisodesInfo>> {
        let media = self.media(Self::parse_id(&query.id)?).await?;
        let total = media
            .episodes
            .or_else(|| media.next_airing_episode.as_ref().map(|next| next.episode))
            .unwrap_or(0);
        let start = query.offset.saturating_add(1);
        let end = total.min(query.offset.saturating_add(query.limit));
        if start > end {
            return Ok(Vec::new());
        }
        let duration = media.duration.map(|minutes| format!("{minutes} 分钟"));
        Ok((start..=end)
            .map(|episode| EpisodesInfo {
                id: format!("anilist:{}:{episode}", media.id),
                ep: episode,
                airdate: None,
                title: Some(format!("Episode {episode}")),
                title_cn: Some(format!("第 {episode} 话")),
                duration: duration.clone(),
                summary: None,
                thumbnail: None,
            })
            .collect())
    }

    async fn get_characters(&self, id: &str) -> Result<Vec<CharacterInfo>> {
        let id = Self::parse_id(id)?;
        let query = r#"
          query ($id: Int!) {
            Media(id: $id, type: ANIME, isAdult: false) {
              characters(page: 1, perPage: 24, sort: [ROLE, RELEVANCE, ID]) {
                edges {
                  role
                  node {
                    id
                    name { full native }
                    image { large }
                  }
                  voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                    name { full }
                  }
                }
              }
            }
          }
        "#;
        let data: CharacterResponse = self.graphql(query.into(), json!({ "id": id })).await?;
        Ok(data
            .media
            .characters
            .edges
            .into_iter()
            .map(|edge| CharacterInfo {
                id: edge.node.id,
                name: edge.node.name.full.or(edge.node.name.native),
                role: edge.role,
                avatar: edge.node.image.and_then(|image| image.large),
                cvs: Some(
                    edge.voice_actors
                        .into_iter()
                        .filter_map(|actor| actor.name.full)
                        .collect(),
                ),
            })
            .collect())
    }

    async fn get_calendar(&self, language: Option<&str>) -> Result<Vec<CalendarEntry>> {
        const SHANGHAI_OFFSET: i64 = 8 * 60 * 60;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let local_day = (now + SHANGHAI_OFFSET).div_euclid(86_400);
        // 1970-01-01 was Thursday. IDs use Monday=1 ... Sunday=7.
        let weekday = (local_day + 3).rem_euclid(7) + 1;
        let monday = local_day - (weekday - 1);
        let from = monday * 86_400 - SHANGHAI_OFFSET;
        let to = from + 7 * 86_400;

        let mut schedules = Vec::new();
        let mut page = 1_u32;
        loop {
            let query = format!(
                r#"
                query ($page: Int!, $from: Int!, $to: Int!) {{
                  Page(page: $page, perPage: 50) {{
                    pageInfo {{ total currentPage perPage hasNextPage }}
                    airingSchedules(
                      airingAt_greater: $from
                      airingAt_lesser: $to
                      sort: TIME
                    ) {{
                      airingAt
                      media {{
                        {MEDIA_FIELDS}
                      }}
                    }}
                  }}
                }}
                "#
            );
            let data: AiringPageResponse = self
                .graphql(query, json!({ "page": page, "from": from, "to": to }))
                .await?;
            schedules.extend(data.page.airing_schedules);
            if !data.page.page_info.has_next_page {
                break;
            }
            page += 1;
        }

        let (airing_times, media): (Vec<_>, Vec<_>) = schedules
            .into_iter()
            .map(|schedule| (schedule.airing_at, schedule.media))
            .unzip();
        let localized = self.localized_list(media, language).await;
        let mut grouped: [Vec<AnimeInfo>; 7] = std::array::from_fn(|_| Vec::new());
        for (airing_at, info) in airing_times.into_iter().zip(localized) {
            let local_day = (airing_at + SHANGHAI_OFFSET).div_euclid(86_400);
            let day_id = (local_day + 3).rem_euclid(7) as usize;
            if !grouped[day_id].iter().any(|item| item.id == info.id) {
                grouped[day_id].push(info);
            }
        }

        let names = [
            "星期一",
            "星期二",
            "星期三",
            "星期四",
            "星期五",
            "星期六",
            "星期日",
        ];
        Ok(grouped
            .into_iter()
            .enumerate()
            .map(|(index, items)| CalendarEntry {
                weekday: Weekday {
                    id: (index + 1) as u8,
                    cn: names[index].into(),
                },
                items,
            })
            .collect())
    }
}

#[derive(Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Deserialize)]
struct PageResponse {
    #[serde(rename = "Page")]
    page: MediaPage,
}

#[derive(Deserialize)]
struct MediaResponse {
    #[serde(rename = "Media")]
    media: Media,
}

#[derive(Deserialize)]
struct MediaPage {
    #[serde(rename = "pageInfo")]
    page_info: PageInfo,
    media: Vec<Media>,
}

#[derive(Deserialize)]
struct SearchMediaPage {
    media: Vec<Media>,
}

fn catalog_page_total(page: &MediaPage, offset: u32, limit: u32) -> u64 {
    if page.page_info.has_next_page {
        page.page_info
            .total
            .max(u64::from(offset) + u64::from(limit) + 1)
    } else {
        u64::from(offset) + page.media.len() as u64
    }
}

#[derive(Deserialize)]
struct PageInfo {
    total: u64,
    #[serde(rename = "hasNextPage")]
    has_next_page: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Media {
    id: u64,
    id_mal: Option<u64>,
    title: MediaTitle,
    #[serde(default)]
    synonyms: Vec<String>,
    cover_image: Option<CoverImage>,
    banner_image: Option<String>,
    average_score: Option<f64>,
    season_year: Option<u16>,
    episodes: Option<u32>,
    duration: Option<u32>,
    start_date: Option<FuzzyDate>,
    #[serde(default)]
    genres: Vec<String>,
    description: Option<String>,
    status: Option<String>,
    format: Option<String>,
    next_airing_episode: Option<NextAiringEpisode>,
    studios: Option<StudioConnection>,
}

#[derive(Debug, Deserialize)]
struct MediaTitle {
    romaji: Option<String>,
    english: Option<String>,
    native: Option<String>,
}

#[derive(Debug, Clone)]
struct ChineseMetadata {
    title: String,
    description: String,
    description_ja: Option<String>,
}

impl ChineseMetadata {
    fn apply_to(self, info: &mut AnimeInfo) {
        if !self.title.trim().is_empty() {
            info.title_cn = Some(self.title);
        }
        if !self.description.trim().is_empty() {
            info.description_cn = Some(self.description);
        }
        if self.description_ja.is_some() {
            info.description_ja = self.description_ja;
        }
    }
}

struct LocalizationRequest {
    id: u64,
    aliases: Vec<String>,
    year: Option<u16>,
    episode_count: Option<u32>,
}

impl From<&Media> for LocalizationRequest {
    fn from(media: &Media) -> Self {
        Self {
            id: media.id,
            aliases: media.search_titles(),
            year: media
                .season_year
                .or_else(|| media.start_date.as_ref().and_then(|date| date.year)),
            episode_count: media.episodes,
        }
    }
}

struct ChineseCacheEntry {
    value: Arc<Mutex<Option<CachedChineseMetadata>>>,
    last_used: Instant,
}

struct CachedChineseMetadata {
    metadata: Option<ChineseMetadata>,
    expires_at: Instant,
}

impl CachedChineseMetadata {
    fn from_result(result: Result<Option<ChineseMetadata>>) -> Self {
        let (metadata, lifetime) = match result {
            Ok(Some(metadata)) => {
                let complete = !metadata.title.is_empty() && !metadata.description.is_empty();
                (
                    Some(metadata),
                    Duration::from_secs(if complete { 24 * 60 * 60 } else { 10 * 60 }),
                )
            }
            Ok(None) => (None, Duration::from_secs(10 * 60)),
            // Throttle repeated failures briefly, never for the application's lifetime.
            Err(_) => (None, Duration::from_secs(15)),
        };
        Self {
            metadata,
            expires_at: Instant::now() + lifetime,
        }
    }

    fn is_fresh(&self) -> bool {
        Instant::now() < self.expires_at
    }
}

#[derive(Debug, Deserialize)]
struct BangumiSearchResponse {
    total: u64,
    #[serde(default)]
    data: Vec<BangumiSubject>,
}

#[derive(Debug, Deserialize)]
struct BangumiSubject {
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    #[serde(default)]
    eps: u32,
    #[serde(default)]
    total_episodes: u32,
}

impl BangumiSubject {
    fn into_metadata(self) -> Option<ChineseMetadata> {
        let title = self
            .name_cn
            .filter(|title| is_probably_chinese_title(title))
            .unwrap_or_default();
        let (description_cn, description_ja) =
            localized_synopses(&self.summary.unwrap_or_default());
        let description = description_cn.unwrap_or_default();
        (!title.is_empty() || !description.is_empty() || description_ja.is_some()).then_some(
            ChineseMetadata {
                title,
                description,
                description_ja,
            },
        )
    }
}

fn match_search_subject(subject: &BangumiSubject, candidates: Vec<Media>) -> Option<Media> {
    let mut ranked: Vec<_> = candidates
        .into_iter()
        .filter_map(|media| {
            let request = LocalizationRequest::from(&media);
            let keys = request
                .aliases
                .iter()
                .map(|title| normalized_catalog_title(title))
                .collect();
            let alternate_keys = request
                .aliases
                .iter()
                .filter_map(|title| localization_base_title(title))
                .map(normalized_catalog_title)
                .collect();
            let score = bangumi_match_score(subject, &keys, request.year, request.episode_count)
                .max(bangumi_variant_score(
                    subject,
                    &alternate_keys,
                    request.year,
                    request.episode_count,
                ));
            (score >= 80).then_some((score, media))
        })
        .collect();
    ranked.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    // Never silently map an ambiguous title to the wrong season or remake.
    if ranked.len() > 1 && ranked[0].0 == ranked[1].0 {
        return None;
    }
    ranked.into_iter().next().map(|(_, media)| media)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverImage {
    extra_large: Option<String>,
    large: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FuzzyDate {
    year: Option<u16>,
    month: Option<u8>,
    day: Option<u8>,
}

#[derive(Debug, Deserialize)]
struct NextAiringEpisode {
    episode: u32,
}

#[derive(Debug, Deserialize)]
struct StudioConnection {
    #[serde(default)]
    nodes: Vec<Studio>,
}

#[derive(Debug, Deserialize)]
struct Studio {
    name: String,
}

impl Media {
    fn search_titles(&self) -> Vec<String> {
        let mut seen = BTreeSet::new();
        [
            self.title.romaji.as_ref(),
            self.title.english.as_ref(),
            self.title.native.as_ref(),
        ]
        .into_iter()
        .flatten()
        .chain(self.synonyms.iter())
        .map(|title| title.trim())
        .filter(|title| !title.is_empty() && seen.insert(title.to_lowercase()))
        .map(str::to_owned)
        .collect()
    }
}

impl From<Media> for AnimeInfo {
    fn from(media: Media) -> Self {
        let search_titles = media.search_titles();
        let MediaTitle {
            romaji,
            english,
            native,
        } = media.title;
        let title = romaji
            .clone()
            .or_else(|| english.clone())
            .or_else(|| native.clone())
            .unwrap_or_else(|| format!("AniList {}", media.id));
        let title_en = english
            .or_else(|| romaji.clone())
            .or_else(|| native.clone())
            .unwrap_or_else(|| title.clone());
        let title_cn = preferred_chinese_title(&media.synonyms);
        let air_date = media.start_date.as_ref().and_then(format_fuzzy_date);
        let year = media
            .season_year
            .or_else(|| media.start_date.as_ref().and_then(|date| date.year));
        let total_episodes = media
            .episodes
            .or_else(|| media.next_airing_episode.map(|next| next.episode))
            .unwrap_or(0);
        let description = media.description.map(|text| strip_html(&text));
        let (description_cn, description_ja) =
            localized_synopses(description.as_deref().unwrap_or_default());
        Self {
            id: format!("anilist:{}", media.id),
            anilist_id: media.id,
            mal_id: media.id_mal,
            title,
            title_en,
            search_titles,
            title_cn,
            title_native: native,
            cover: media
                .cover_image
                .and_then(|cover| cover.extra_large.or(cover.large)),
            banner: media.banner_image,
            score: media.average_score.map(|score| score / 10.0),
            year,
            total_episodes,
            air_date,
            genres: media.genres,
            description,
            description_cn,
            description_ja,
            status: media.status,
            format: media.format,
            studios: media
                .studios
                .map(|connection| {
                    connection
                        .nodes
                        .into_iter()
                        .map(|studio| studio.name)
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

fn format_fuzzy_date(date: &FuzzyDate) -> Option<String> {
    let year = date.year?;
    match (date.month, date.day) {
        (Some(month), Some(day)) => Some(format!("{year:04}-{month:02}-{day:02}")),
        _ => Some(year.to_string()),
    }
}

fn strip_html(input: &str) -> String {
    scraper::Html::parse_fragment(input)
        .root_element()
        .text()
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string()
}

fn preferred_chinese_title(synonyms: &[String]) -> Option<String> {
    synonyms
        .iter()
        .find(|title| is_probably_chinese_title(title))
        .cloned()
}

fn is_probably_chinese_title(value: &str) -> bool {
    let han = value.chars().filter(|character| is_han(*character)).count();
    han >= 2
        && !contains_kana(value)
        && !value
            .chars()
            .any(|character| matches!(character, '\u{ac00}'..='\u{d7af}' | '\u{1100}'..='\u{11ff}'))
}

fn is_probably_chinese(value: &str) -> bool {
    let han = value.chars().filter(|character| is_han(*character)).count();
    let kana = value
        .chars()
        .filter(|character| {
            matches!(
                character,
                '\u{3040}'..='\u{30ff}' | '\u{31f0}'..='\u{31ff}'
            )
        })
        .count();
    han >= 4 && kana.saturating_mul(5) < han
}

fn contains_kana(value: &str) -> bool {
    value.chars().any(|character| {
        matches!(
            character,
            '\u{3040}'..='\u{30ff}' | '\u{31f0}'..='\u{31ff}'
        )
    })
}

fn is_probably_japanese(value: &str) -> bool {
    let kana = value
        .chars()
        .filter(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{31f0}'..='\u{31ff}'))
        .count();
    let han = value.chars().filter(|c| is_han(*c)).count();
    kana >= 4 && kana.saturating_mul(5) >= han
}

/// Alternate names for localization only; never broaden playback matching.
/// Do not strip individual parts, seasons, OVAs or short story subtitles.
fn localization_base_title(value: &str) -> Option<&str> {
    let value = value.trim();
    for suffix in ["第1&2クール", "第1＆2クール", "Part 1 & 2"] {
        if let Some(base) = value.strip_suffix(suffix) {
            return Some(base.trim());
        }
    }
    if let Some(index) = value.find('。') {
        let end = index + '。'.len_utf8();
        let (base, subtitle) = value.split_at(end);
        let subtitle = subtitle.trim();
        if base.chars().count() >= 12
            && subtitle.chars().count() >= 20
            && subtitle.starts_with(['～', '〜', '~'])
        {
            return Some(base);
        }
    }
    None
}

fn bangumi_variant_score(
    subject: &BangumiSubject,
    alternate_keys: &BTreeSet<String>,
    year: Option<u16>,
    episode_count: Option<u32>,
) -> i32 {
    let same_year = year.is_some_and(|year| {
        subject
            .date
            .as_deref()
            .is_some_and(|date| date.starts_with(&format!("{year}-")))
    });
    let count = subject.total_episodes.max(subject.eps);
    let conflicting_episodes =
        episode_count.is_some_and(|expected| expected > 0 && count > 0 && expected != count);
    if same_year
        && !conflicting_episodes
        && alternate_keys.contains(&normalized_catalog_title(&subject.name))
    {
        95
    } else {
        0
    }
}

fn localized_synopses(value: &str) -> (Option<String>, Option<String>) {
    // Bangumi sometimes appends the Japanese original to its Chinese synopsis.
    // Split only explicit source markers; do not guess at ordinary paragraphs.
    let (translated, original) = value
        .split_once("[简介原文]")
        .or_else(|| value.split_once("[原文]"))
        .unwrap_or((value, value));
    (
        is_probably_chinese(translated).then(|| translated.trim().to_owned()),
        is_probably_japanese(original).then(|| original.trim().to_owned()),
    )
}

fn is_han(character: char) -> bool {
    matches!(
        character,
        '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{f900}'..='\u{faff}'
    )
}

fn normalized_catalog_title(value: &str) -> String {
    let mut normalized: String = value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    for season in 1..=30 {
        for suffix in ["st", "nd", "rd", "th"] {
            normalized = normalized.replace(
                &format!("{season}{suffix}season"),
                &format!("season{season}"),
            );
        }
        normalized = normalized.replace(&format!("第{season}期"), &format!("season{season}"));
        normalized = normalized.replace(&format!("第{season}季"), &format!("season{season}"));
    }
    normalized
}

fn bangumi_match_score(
    subject: &BangumiSubject,
    title_keys: &BTreeSet<String>,
    year: Option<u16>,
    episode_count: Option<u32>,
) -> i32 {
    let candidate_titles = [Some(subject.name.as_str()), subject.name_cn.as_deref()];
    let exact_title = candidate_titles
        .into_iter()
        .flatten()
        .map(normalized_catalog_title)
        .any(|title| title_keys.contains(&title));
    let mut score = if exact_title { 100 } else { 0 };

    let subject_year = subject
        .date
        .as_deref()
        .and_then(|date| date.split('-').next())
        .and_then(|value| value.parse::<u16>().ok());
    if let (Some(expected), Some(candidate)) = (year, subject_year) {
        let difference = expected.abs_diff(candidate);
        score += match difference {
            0 => 20,
            1 => 8,
            _ => -35,
        };
    }

    let subject_episodes = subject.total_episodes.max(subject.eps);
    if let Some(expected) = episode_count.filter(|count| *count > 0) {
        if subject_episodes == expected {
            score += 12;
        } else if subject_episodes > 0 {
            score -= i32::try_from(expected.abs_diff(subject_episodes).min(12)).unwrap_or(12);
        }
    }
    score
}

#[derive(Deserialize)]
struct CharacterResponse {
    #[serde(rename = "Media")]
    media: CharacterMedia,
}

#[derive(Deserialize)]
struct CharacterMedia {
    characters: CharacterConnection,
}

#[derive(Deserialize)]
struct CharacterConnection {
    #[serde(default)]
    edges: Vec<CharacterEdge>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CharacterEdge {
    role: Option<String>,
    node: CharacterNode,
    #[serde(default)]
    voice_actors: Vec<VoiceActor>,
}

#[derive(Deserialize)]
struct CharacterNode {
    id: u64,
    name: PersonName,
    image: Option<CharacterImage>,
}

#[derive(Deserialize)]
struct PersonName {
    full: Option<String>,
    native: Option<String>,
}

#[derive(Deserialize)]
struct CharacterImage {
    large: Option<String>,
}

#[derive(Deserialize)]
struct VoiceActor {
    name: VoiceActorName,
}

#[derive(Deserialize)]
struct VoiceActorName {
    full: Option<String>,
}

#[derive(Deserialize)]
struct AiringPageResponse {
    #[serde(rename = "Page")]
    page: AiringPage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiringPage {
    page_info: PageInfo,
    #[serde(default)]
    airing_schedules: Vec<AiringSchedule>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiringSchedule {
    airing_at: i64,
    media: Media,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_namespaced_and_plain_ids() {
        assert_eq!(AniList::parse_id("anilist:21").unwrap(), 21);
        assert_eq!(AniList::parse_id("21").unwrap(), 21);
        assert!(AniList::parse_id("bangumi:21").is_err());
    }

    #[test]
    fn shanghai_weekday_math_uses_monday_as_one() {
        // 1970-01-01 was Thursday.
        let local_day = 0_i64;
        assert_eq!((local_day + 3).rem_euclid(7) + 1, 4);
    }

    #[test]
    fn selects_chinese_alias_without_mistaking_japanese_or_korean() {
        let synonyms = vec![
            "葬送のフリーレン".into(),
            "장송의 프리렌".into(),
            "葬送的芙莉莲".into(),
        ];
        assert_eq!(
            preferred_chinese_title(&synonyms).as_deref(),
            Some("葬送的芙莉莲")
        );
    }

    #[test]
    fn chinese_search_mapping_preserves_identity_and_rejects_ambiguous_or_wrong_seasons() {
        let subject: BangumiSubject = serde_json::from_value(json!({
            "name": "無職転生Ⅲ ～異世界行ったら本気だす～",
            "name_cn": "无职转生 第三季", "date": "2026-07-05", "eps": 14
        }))
        .unwrap();
        let matched = match_search_subject(&subject, vec![mushoku_media()]).unwrap();
        assert_eq!(matched.id, 178789);
        let mut other_season = mushoku_media();
        other_season.title.native = Some("無職転生Ⅱ ～異世界行ったら本気だす～".into());
        other_season.title.romaji = Some("Mushoku Tensei II".into());
        other_season.title.english = None;
        other_season.synonyms.clear();
        assert!(match_search_subject(&subject, vec![other_season]).is_none());
        let mut remake = mushoku_media();
        remake.season_year = Some(2020);
        assert!(match_search_subject(&subject, vec![remake]).is_none());
        let mut ambiguous = mushoku_media();
        ambiguous.id = 999;
        assert!(match_search_subject(&subject, vec![mushoku_media(), ambiguous]).is_none());
    }

    #[test]
    fn anilist_last_page_overrides_estimated_search_total() {
        let mut page = MediaPage {
            media: vec![mushoku_media()],
            page_info: PageInfo {
                total: 5000,
                has_next_page: false,
            },
        };
        assert_eq!(catalog_page_total(&page, 25, 25), 26);
        page.page_info = PageInfo {
            total: 0,
            has_next_page: true,
        };
        assert_eq!(catalog_page_total(&page, 0, 25), 26);
    }

    #[tokio::test]
    async fn empty_search_never_browses_the_entire_catalog() {
        let result = AniList::new()
            .search(
                SearchQuery {
                    keyword: "  ".into(),
                    limit: 25,
                    offset: 0,
                },
                Some("zh"),
            )
            .await
            .unwrap();
        assert_eq!(result.total, 0);
        assert!(result.data.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires the live AniList and Bangumi services"]
    async fn live_chinese_search_maps_simplified_traditional_and_missing_anilist_aliases() {
        let provider = AniList::new();
        for (keyword, expected, language) in [
            ("葬送的芙莉莲", 154587, "zh"),
            ("葬送的芙莉蓮", 154587, "en"),
            ("无职转生 第三季", 178789, "zh"),
        ] {
            let result = provider
                .search(
                    SearchQuery {
                        keyword: keyword.into(),
                        limit: 25,
                        offset: 0,
                    },
                    Some(language),
                )
                .await
                .unwrap();
            eprintln!(
                "{keyword}: {} results, total {}, ids {:?}",
                result.data.len(),
                result.total,
                result.data.iter().map(|m| m.anilist_id).collect::<Vec<_>>()
            );
            let media = result
                .data
                .iter()
                .find(|m| m.anilist_id == expected)
                .expect(keyword);
            assert_eq!(media.id, format!("anilist:{expected}"));
            assert!(media.title_cn.is_some());
            assert!(!media.title_en.is_empty());
        }
        let first = provider
            .search(
                SearchQuery {
                    keyword: "芙莉莲".into(),
                    limit: 1,
                    offset: 0,
                },
                Some("zh"),
            )
            .await
            .unwrap();
        let second = provider
            .search(
                SearchQuery {
                    keyword: "芙莉莲".into(),
                    limit: 1,
                    offset: 1,
                },
                Some("zh"),
            )
            .await
            .unwrap();
        assert!(!first.data.is_empty());
        assert!(!second.data.is_empty());
        assert_ne!(first.data[0].id, second.data[0].id);
        assert_eq!(second.offset, 1);
        let english = provider
            .search(
                SearchQuery {
                    keyword: "Sousou no Frieren".into(),
                    limit: 25,
                    offset: 0,
                },
                Some("en"),
            )
            .await
            .unwrap();
        assert!(english.data.iter().any(|m| m.anilist_id == 154587));
        assert!(english.total < 5000);
        let broad = provider
            .search(
                SearchQuery {
                    keyword: "魔法".into(),
                    limit: 25,
                    offset: 0,
                },
                Some("zh"),
            )
            .await
            .unwrap();
        assert!(broad.total > 25);
        assert!(!broad.data.is_empty());
    }

    #[test]
    fn bangumi_localization_requires_title_and_season_compatibility() {
        let titles = BTreeSet::from([
            normalized_catalog_title("Sousou no Frieren 2nd Season"),
            normalized_catalog_title("葬送のフリーレン 第2期"),
        ]);
        let correct = BangumiSubject {
            name: "葬送のフリーレン 第2期".into(),
            name_cn: Some("葬送的芙莉莲 第二季".into()),
            summary: Some("芙莉莲再次踏上旅途。".into()),
            date: Some("2026-01-16".into()),
            eps: 10,
            total_episodes: 10,
        };
        let unrelated = BangumiSubject {
            name: "葬送のフリーレン ～魔法～".into(),
            name_cn: Some("葬送的芙莉莲 小剧场".into()),
            summary: None,
            date: Some("2023-10-11".into()),
            eps: 11,
            total_episodes: 11,
        };
        assert!(bangumi_match_score(&correct, &titles, Some(2026), Some(10)) >= 80);
        assert!(bangumi_match_score(&unrelated, &titles, Some(2026), Some(10)) < 80);
    }

    #[test]
    fn transient_localization_errors_expire_before_valid_results() {
        let failed =
            CachedChineseMetadata::from_result(Err(ProviderError::Source("offline".into())));
        let absent = CachedChineseMetadata::from_result(Ok(None));
        let success = CachedChineseMetadata::from_result(Ok(Some(ChineseMetadata {
            title: "无职转生 第三季".into(),
            description: "无职转生第三季的故事。".into(),
            description_ja: None,
        })));
        assert!(failed.expires_at < absent.expires_at);
        assert!(absent.expires_at < success.expires_at);
        assert!(failed.expires_at.duration_since(Instant::now()) <= Duration::from_secs(15));
        let expired = CachedChineseMetadata {
            metadata: None,
            expires_at: Instant::now() - Duration::from_secs(1),
        };
        assert!(!expired.is_fresh());
    }

    #[test]
    fn bilingual_source_synopsis_is_split_before_display_and_fallback() {
        let chinese = "冒险者再次踏上了寻找魔法的旅途。";
        let japanese = "新たな世界で、もう一度冒険が始まる。";
        assert_eq!(
            localized_synopses(&format!("{chinese}\r\n\r\n[简介原文]\r\n{japanese}")),
            (Some(chinese.into()), Some(japanese.into()))
        );
        assert_eq!(localized_synopses("English synopsis only."), (None, None));
        assert_eq!(localized_synopses(japanese), (None, Some(japanese.into())));
    }

    #[test]
    fn localization_accepts_combined_cours_but_not_other_seasons_or_parts() {
        let aliases = [
            "転生したらスライムだった件 第4期 第1&2クール",
            "Tensei Shitara Slime Datta Ken 4th Season Part 1 & 2",
        ];
        let alternate_keys = aliases
            .iter()
            .filter_map(|title| localization_base_title(title))
            .map(normalized_catalog_title)
            .collect();
        let mut subject = BangumiSubject {
            name: "転生したらスライムだった件 第4期".into(),
            name_cn: None,
            summary: None,
            date: Some("2026-04-03".into()),
            eps: 24,
            total_episodes: 24,
        };
        assert!(bangumi_variant_score(&subject, &alternate_keys, Some(2026), Some(24)) >= 80);
        assert_eq!(
            bangumi_variant_score(&subject, &alternate_keys, Some(2025), Some(24)),
            0
        );
        assert_eq!(
            bangumi_variant_score(&subject, &alternate_keys, None, Some(24)),
            0
        );
        assert_eq!(
            bangumi_variant_score(&subject, &alternate_keys, Some(2026), Some(12)),
            0
        );
        for name in [
            "転生したらスライムだった件 第3期",
            "転生したらスライムだった件 第4期 第3クール",
        ] {
            subject.name = name.into();
            assert_eq!(
                bangumi_variant_score(&subject, &alternate_keys, Some(2026), Some(24)),
                0
            );
        }
        assert!(localization_base_title("作品名 第2クール").is_none());
        assert!(localization_base_title("Title Part 2").is_none());
    }

    #[test]
    fn localization_handles_long_descriptive_subtitles_without_stripping_short_story_names() {
        let base = "追放されたチート付与魔術師は気ままなセカンドライフを謳歌する。";
        let alias = format!("{base}　～俺は武器だけじゃなく、あらゆるものに『強化ポイント』を付与できるし、俺の意思でいつでも効果を解除できる～");
        assert_eq!(localization_base_title(&alias), Some(base));
        assert!(localization_base_title("葬送のフリーレン ～魔法～").is_none());
        let keys = BTreeSet::from([normalized_catalog_title(
            localization_base_title(&alias).unwrap(),
        )]);
        let subject = BangumiSubject {
            name: base.into(),
            name_cn: None,
            summary: None,
            date: Some("2026-10-06".into()),
            eps: 12,
            total_episodes: 12,
        };
        assert!(bangumi_variant_score(&subject, &keys, Some(2026), None) >= 80);
    }

    #[test]
    fn preserves_native_titles_and_only_labels_actual_japanese_synopses_as_japanese() {
        let mut media = mushoku_media();
        media.description = Some("A new journey begins.".into());
        let info = AnimeInfo::from(media);
        assert_eq!(
            info.title_native.as_deref(),
            Some("無職転生Ⅲ ～異世界行ったら本気だす～")
        );
        assert!(info.description_ja.is_none());
        assert!(info.description_cn.is_none());
        let mut media = mushoku_media();
        media.description = Some("<p>新たな世界で、もう一度冒険が始まる。</p>".into());
        let info = AnimeInfo::from(media);
        assert_eq!(
            info.description_ja.as_deref(),
            Some("新たな世界で、もう一度冒険が始まる。")
        );
        assert!(info.description_cn.is_none());
        assert!(!is_probably_japanese("冒险者再次踏上了寻找魔法的旅途。"));
    }

    fn mushoku_media() -> Media {
        serde_json::from_value(json!({
            "id": 178789,
            "title": {
                "romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu",
                "english": "Mushoku Tensei: Jobless Reincarnation Season 3",
                "native": "無職転生Ⅲ ～異世界行ったら本気だす～",
            },
            "synonyms": ["無職転生 ～異世界行ったら本気だす～ 第3期"],
            "seasonYear": 2026,
            "episodes": 14,
            "studios": {"nodes": [{"name": "Studio Bind"}]},
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn localized_list_fills_missing_titles_without_changing_matching_identity() {
        let provider = AniList::new();
        provider.chinese_metadata.lock().await.insert(
            178789,
            ChineseCacheEntry {
                value: Arc::new(Mutex::new(Some(CachedChineseMetadata::from_result(Ok(
                    Some(ChineseMetadata {
                        title: "无职转生 第三季 ～到了异世界就拿出真本事～".into(),
                        description: String::new(),
                        description_ja: None,
                    }),
                ))))),
                last_used: Instant::now(),
            },
        );
        let english = provider
            .localized_list(vec![mushoku_media()], Some("en"))
            .await;
        let chinese = provider
            .localized_list(vec![mushoku_media(), mushoku_media()], Some("zh"))
            .await;
        assert_eq!(chinese.len(), 2);
        assert!(english[0].title_cn.is_none());
        for item in chinese {
            assert_eq!(item.id, english[0].id);
            assert_eq!(item.title, english[0].title);
            assert_eq!(item.title_en, english[0].title_en);
            assert_eq!(item.search_titles, english[0].search_titles);
            assert!(item
                .title_cn
                .as_deref()
                .is_some_and(|title| title.contains("第三季")));
            assert_eq!(item.studios, vec!["Studio Bind"]);
        }
    }

    #[tokio::test]
    #[ignore = "requires the live AniList and Bangumi services"]
    async fn live_chinese_list_fills_mushoku_tensei_third_season_title() {
        let provider = AniList::new();
        let result = provider
            .search(
                SearchQuery {
                    keyword: "Mushoku Tensei III".into(),
                    limit: 3,
                    offset: 0,
                },
                Some("zh"),
            )
            .await
            .unwrap();
        let media = result
            .data
            .iter()
            .find(|media| media.anilist_id == 178789)
            .unwrap();
        assert!(media
            .title_cn
            .as_deref()
            .is_some_and(|title| title.contains("第三季")));
        assert!(media
            .search_titles
            .iter()
            .any(|title| title.contains("無職転生Ⅲ")));
        assert_eq!(media.id, "anilist:178789");
    }

    #[tokio::test]
    #[ignore = "requires the live AniList and Bangumi services"]
    async fn live_chinese_detail_has_a_localized_title_and_summary() {
        let media = AniList::new()
            .get_detail("anilist:154587", Some("zh"))
            .await
            .unwrap();
        assert!(media.title_cn.as_deref().is_some_and(is_probably_chinese));
        assert!(media
            .description_cn
            .as_deref()
            .is_some_and(is_probably_chinese));
        assert!(!media.title_en.trim().is_empty());
    }
}
