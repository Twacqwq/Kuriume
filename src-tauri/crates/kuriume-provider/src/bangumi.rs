//! Bangumi (bgm.tv) as an animation catalog, beside AniList. Bangumi is
//! Chinese-first: titles and synopses need no second localisation lookup.
//! It has no broadcast times (only dates) and almost no English titles.
//! See <https://bangumi.github.io/api/>.
use async_trait::async_trait;
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

use crate::anilist::localized_synopses;
use crate::error::{ProviderError, Result};
use crate::models::{
    AnimeInfo, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult, SearchQuery, SortBy, Weekday,
};
use crate::provider::AnimeProvider;
use crate::user_agent::USER_AGENT;

const API: &str = "https://api.bgm.tv";
/// Bangumi asks for considerate clients; keep requests a little apart.
const MIN_SPACING: Duration = Duration::from_millis(200);
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_LIMIT: usize = 400;
/// Bangumi dates are Beijing dates.
const SHANGHAI_OFFSET: i64 = 8 * 60 * 60;
const ANIME: u8 = 2;
/// Main-story episodes (not SP/OP/ED/PV).
const MAIN_EPISODE: u8 = 0;

/// Cached values by subject ID, with the time they were stored.
type Cache<T> = Arc<StdMutex<HashMap<u64, (Instant, T)>>>;

pub struct Bangumi {
    client: Client,
    last_request: Arc<Mutex<Option<Instant>>>,
    subjects: Cache<Subject>,
    episodes: Cache<Vec<Episode>>,
}

impl Default for Bangumi {
    fn default() -> Self {
        Self::new()
    }
}

impl Bangumi {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .expect("failed to build Bangumi HTTP client");
        Self {
            client,
            last_request: Arc::new(Mutex::new(None)),
            subjects: Arc::new(StdMutex::new(HashMap::new())),
            episodes: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    pub(crate) fn parse_id(id: &str) -> Result<u64> {
        id.strip_prefix("bangumi:")
            .unwrap_or(id)
            .parse::<u64>()
            .map_err(|_| ProviderError::Parse(format!("Invalid Bangumi subject ID: {id}")))
    }

    async fn send<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T> {
        {
            let mut last = self.last_request.lock().await;
            if let Some(previous) = *last {
                let wait = (previous + MIN_SPACING).saturating_duration_since(Instant::now());
                if !wait.is_zero() {
                    tokio::time::sleep(wait).await;
                }
            }
            *last = Some(Instant::now());
        }
        let response = request.send().await?;
        match response.status() {
            StatusCode::NOT_FOUND => Err(ProviderError::NotFound("Bangumi subject".into())),
            StatusCode::TOO_MANY_REQUESTS => Err(ProviderError::Source(
                "Bangumi rate limit reached (HTTP 429); retry in a moment".into(),
            )),
            status if !status.is_success() => Err(ProviderError::Source(format!(
                "Bangumi returned HTTP {}",
                status.as_u16()
            ))),
            _ => Ok(response.json().await?),
        }
    }

    async fn subject(&self, id: u64) -> Result<Subject> {
        if let Some(subject) = cached(&self.subjects, id) {
            return Ok(subject);
        }
        let subject: Subject = self
            .send(self.client.get(format!("{API}/v0/subjects/{id}")))
            .await?;
        if subject.subject_type.is_some_and(|kind| kind != ANIME) {
            return Err(ProviderError::NotFound(format!(
                "Bangumi {id} is not an anime"
            )));
        }
        remember(&self.subjects, [(id, subject.clone())]);
        Ok(subject)
    }

    /// Every main episode of a subject (Bangumi pages at 100 per request).
    async fn all_episodes(&self, id: u64) -> Result<Vec<Episode>> {
        if let Some(episodes) = cached(&self.episodes, id) {
            return Ok(episodes);
        }
        let mut episodes = Vec::new();
        for page in 0..10 {
            let response: Paged<Episode> = self
                .send(self.client.get(format!("{API}/v0/episodes")).query(&[
                    ("subject_id", id.to_string()),
                    ("type", MAIN_EPISODE.to_string()),
                    ("limit", "100".into()),
                    ("offset", (page * 100).to_string()),
                ]))
                .await?;
            let count = response.data.len();
            episodes.extend(response.data);
            if count < 100 || episodes.len() as u64 >= response.total {
                break;
            }
        }
        remember(&self.episodes, [(id, episodes.clone())]);
        Ok(episodes)
    }

    fn remember_subjects<'a>(&self, subjects: impl IntoIterator<Item = &'a Subject>) {
        remember(
            &self.subjects,
            subjects
                .into_iter()
                .filter(|subject| subject.summary.is_some())
                .map(|subject| (subject.id, subject.clone())),
        );
    }
}

fn cached<T: Clone>(cache: &StdMutex<HashMap<u64, (Instant, T)>>, id: u64) -> Option<T> {
    let cache = cache.lock().ok()?;
    let (stored, value) = cache.get(&id)?;
    (stored.elapsed() < CACHE_TTL).then(|| value.clone())
}

fn remember<T>(
    cache: &StdMutex<HashMap<u64, (Instant, T)>>,
    items: impl IntoIterator<Item = (u64, T)>,
) {
    let Ok(mut cache) = cache.lock() else { return };
    let now = Instant::now();
    for (id, value) in items {
        cache.insert(id, (now, value));
    }
    if cache.len() > CACHE_LIMIT {
        cache.retain(|_, (stored, _)| now.duration_since(*stored) < CACHE_TTL);
        while cache.len() > CACHE_LIMIT {
            let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, (stored, _))| *stored)
                .map(|(id, _)| *id)
            else {
                break;
            };
            cache.remove(&oldest);
        }
    }
}

/// Today's date in Beijing as `YYYY-MM-DD`, which compares as text.
fn today(now_unix: i64) -> String {
    let days = (now_unix + SHANGHAI_OFFSET).div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Debug, Clone, Deserialize)]
struct Paged<T> {
    #[serde(default)]
    total: u64,
    #[serde(default = "Vec::new")]
    data: Vec<T>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Images {
    large: Option<String>,
    common: Option<String>,
    medium: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Rating {
    #[serde(default)]
    score: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct Tag {
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct InfoboxItem {
    key: String,
    value: Value,
}

/// A v0 subject; search results and the legacy calendar share most fields.
#[derive(Debug, Clone, Deserialize)]
struct Subject {
    id: u64,
    #[serde(rename = "type")]
    subject_type: Option<u8>,
    #[serde(default)]
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    /// v0 subjects.
    date: Option<String>,
    /// Legacy calendar items.
    air_date: Option<String>,
    platform: Option<String>,
    images: Option<Images>,
    /// Search results carry a single image URL.
    image: Option<String>,
    #[serde(default)]
    infobox: Vec<InfoboxItem>,
    #[serde(default)]
    eps: u32,
    #[serde(default)]
    total_episodes: u32,
    rating: Option<Rating>,
    #[serde(default)]
    tags: Vec<Tag>,
    #[serde(default)]
    meta_tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Episode {
    id: u64,
    #[serde(default)]
    sort: f64,
    ep: Option<f64>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    name_cn: String,
    #[serde(default)]
    airdate: String,
    #[serde(default)]
    duration: String,
    #[serde(default)]
    desc: String,
}

impl Episode {
    fn number(&self) -> u32 {
        let value = self.ep.filter(|ep| *ep > 0.0).unwrap_or(self.sort);
        value.max(0.0).round() as u32
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Character {
    id: u64,
    name: Option<String>,
    relation: Option<String>,
    images: Option<Images>,
    #[serde(default)]
    actors: Vec<Actor>,
}

#[derive(Debug, Clone, Deserialize)]
struct Actor {
    name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CalendarDay {
    weekday: CalendarWeekday,
    #[serde(default)]
    items: Vec<Subject>,
}

#[derive(Debug, Clone, Deserialize)]
struct CalendarWeekday {
    id: u8,
    cn: String,
}

fn infobox_values(items: &[InfoboxItem], keys: &[&str]) -> Vec<String> {
    let mut values = Vec::new();
    for item in items
        .iter()
        .filter(|item| keys.contains(&item.key.as_str()))
    {
        match &item.value {
            Value::String(text) => values.extend(
                text.split(['、', '/', '，'])
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_owned),
            ),
            Value::Array(entries) => values.extend(
                entries
                    .iter()
                    .filter_map(|entry| entry.get("v").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_owned),
            ),
            _ => {}
        }
    }
    values
}

/// Tags that describe the release, not the story.
fn is_genre_tag(tag: &str) -> bool {
    const SKIP: &[&str] = &[
        "TV",
        "WEB",
        "OVA",
        "OAD",
        "剧场版",
        "日本",
        "中国",
        "美国",
        "日本动画",
        "TV动画",
        "动画",
        "原创",
        "漫画改",
        "小说改",
        "游戏改",
        "轻小说改",
        "未确定",
    ];
    !SKIP.contains(&tag) && !tag.chars().next().is_some_and(|c| c.is_ascii_digit())
}

impl Subject {
    fn date(&self) -> Option<&str> {
        self.date
            .as_deref()
            .or(self.air_date.as_deref())
            .filter(|date| !date.is_empty() && !date.starts_with("0000"))
    }

    fn cover(&self) -> Option<String> {
        let present = |url: &Option<String>| url.clone().filter(|url| !url.is_empty());
        self.images
            .as_ref()
            .and_then(|images| {
                present(&images.large)
                    .or_else(|| present(&images.common))
                    .or_else(|| present(&images.medium))
            })
            .or_else(|| present(&self.image))
            .map(|url| url.replacen("http://", "https://", 1))
    }

    fn format(&self) -> Option<String> {
        let platform = self.platform.as_deref()?;
        Some(
            match platform {
                "TV" => "TV",
                "剧场版" => "MOVIE",
                "OVA" | "OAD" => "OVA",
                "WEB" => "ONA",
                other => other,
            }
            .to_owned(),
        )
    }

    /// `episodes`: the subject's main episodes, when known (detail pages).
    fn into_info(self, episodes: Option<&[Episode]>, now: i64) -> AnimeInfo {
        let name_cn = self
            .name_cn
            .clone()
            .map(|title| title.trim().to_owned())
            .filter(|title| !title.is_empty());
        let english = infobox_values(&self.infobox, &["英文名", "英文名称"])
            .into_iter()
            .next();
        let aliases = infobox_values(&self.infobox, &["别名", "中文名"]);
        let mut seen = BTreeSet::new();
        let search_titles = std::iter::once(self.name.clone())
            .chain(name_cn.clone())
            .chain(english.clone())
            .chain(aliases)
            .map(|title| title.trim().to_owned())
            .filter(|title| !title.is_empty() && seen.insert(title.to_lowercase()))
            .collect();
        let title = if self.name.trim().is_empty() {
            name_cn
                .clone()
                .unwrap_or_else(|| format!("Bangumi {}", self.id))
        } else {
            self.name.trim().to_owned()
        };
        let date = self.date().map(str::to_owned);
        let year = date
            .as_deref()
            .and_then(|date| date.get(..4))
            .and_then(|year| year.parse().ok());
        let today = today(now);
        let announced = self.total_episodes.max(self.eps);
        let (aired, status) = match episodes {
            Some(episodes) => {
                let aired = episodes
                    .iter()
                    .filter(|episode| !episode.airdate.is_empty() && episode.airdate <= today)
                    .count() as u32;
                let total = announced.max(episodes.len() as u32);
                let status =
                    if date.as_deref().is_some_and(|date| date > today.as_str()) || aired == 0 {
                        "NOT_YET_RELEASED"
                    } else if total > 0 && aired >= total {
                        "FINISHED"
                    } else {
                        "RELEASING"
                    };
                (Some(aired), Some(status.to_owned()))
            }
            None => (
                None,
                date.as_deref()
                    .filter(|date| *date > today.as_str())
                    .map(|_| "NOT_YET_RELEASED".to_owned()),
            ),
        };
        let summary = self.summary.as_deref().map(str::trim).unwrap_or_default();
        let (description_cn, description_ja) = localized_synopses(summary);
        let genres = self
            .meta_tags
            .iter()
            .cloned()
            .chain(self.tags.iter().map(|tag| tag.name.clone()))
            .filter(|tag| is_genre_tag(tag))
            .fold(Vec::<String>::new(), |mut genres, tag| {
                if genres.len() < 4 && !genres.contains(&tag) {
                    genres.push(tag);
                }
                genres
            });
        AnimeInfo {
            id: format!("bangumi:{}", self.id),
            anilist_id: 0,
            mal_id: None,
            title_en: english.unwrap_or_else(|| title.clone()),
            title_native: Some(title.clone()),
            title,
            search_titles,
            title_cn: name_cn,
            cover: self.cover(),
            cover_color: None,
            banner: None,
            score: self
                .rating
                .as_ref()
                .map(|rating| rating.score)
                .filter(|score| *score > 0.0),
            year,
            total_episodes: episodes
                .map_or(announced, |episodes| announced.max(episodes.len() as u32)),
            air_date: date,
            genres,
            description: (!summary.is_empty()).then(|| summary.to_owned()),
            description_cn,
            description_ja,
            status,
            format: self.format(),
            studios: infobox_values(&self.infobox, &["动画制作"]),
            next_airing: None,
            aired_episodes: aired,
            schedule: None,
        }
    }
}

fn paged(response: Paged<Subject>, limit: u32, offset: u32, now: i64) -> PagedResult<AnimeInfo> {
    PagedResult {
        total: response.total,
        data: response
            .data
            .into_iter()
            .map(|subject| subject.into_info(None, now))
            .collect(),
        limit,
        offset,
    }
}

#[async_trait]
impl AnimeProvider for Bangumi {
    fn name(&self) -> &str {
        "Bangumi"
    }

    async fn search(
        &self,
        query: SearchQuery,
        _language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>> {
        let limit = query.limit.clamp(1, 50);
        let keyword = query.keyword.trim();
        if keyword.is_empty() {
            return Ok(PagedResult {
                data: Vec::new(),
                total: 0,
                limit,
                offset: query.offset,
            });
        }
        let response: Paged<Subject> = self
            .send(
                self.client
                    .post(format!("{API}/v0/search/subjects"))
                    .query(&[("limit", limit), ("offset", query.offset)])
                    .json(&json!({
                        "keyword": keyword,
                        "sort": "match",
                        "filter": { "type": [ANIME], "nsfw": false },
                    })),
            )
            .await?;
        self.remember_subjects(&response.data);
        Ok(paged(response, limit, query.offset, now_unix()))
    }

    async fn get_detail(&self, id: &str, _language: Option<&str>) -> Result<AnimeInfo> {
        let id = Self::parse_id(id)?;
        let subject = self.subject(id).await?;
        // Episodes give the aired count; a failure leaves it unknown, not the page broken.
        let episodes = self.all_episodes(id).await.ok();
        Ok(subject.into_info(episodes.as_deref(), now_unix()))
    }

    async fn get_list(
        &self,
        query: GetListQuery,
        _language: Option<&str>,
    ) -> Result<PagedResult<AnimeInfo>> {
        let limit = query.limit.clamp(1, 50);
        let sort = match query.soft.unwrap_or_default() {
            SortBy::Rank => "rank",
            SortBy::Date => "date",
        };
        let mut params = vec![
            ("type", ANIME.to_string()),
            ("sort", sort.to_owned()),
            ("limit", limit.to_string()),
            ("offset", query.offset.to_string()),
        ];
        if let Some(year) = query.year {
            params.push(("year", year.to_string()));
        }
        if let Some(month) = query.month.filter(|month| (1..=12).contains(month)) {
            params.push(("month", month.to_string()));
        }
        let response: Paged<Subject> = self
            .send(self.client.get(format!("{API}/v0/subjects")).query(&params))
            .await?;
        self.remember_subjects(&response.data);
        Ok(paged(response, limit, query.offset, now_unix()))
    }

    async fn get_episodes(&self, query: GetEpisodesQuery) -> Result<Vec<EpisodesInfo>> {
        let id = Self::parse_id(&query.id)?;
        let episodes = self.all_episodes(id).await?;
        let limit = if query.limit == 0 {
            usize::MAX
        } else {
            query.limit as usize
        };
        Ok(episodes
            .into_iter()
            .skip(query.offset as usize)
            .take(limit)
            .map(|episode| {
                let number = episode.number();
                EpisodesInfo {
                    id: format!("bangumi:{id}:{}", episode.id),
                    ep: number,
                    airdate: (!episode.airdate.is_empty()).then_some(episode.airdate),
                    title: Some(if episode.name.is_empty() {
                        format!("Episode {number}")
                    } else {
                        episode.name
                    }),
                    title_cn: (!episode.name_cn.is_empty()).then_some(episode.name_cn),
                    duration: (!episode.duration.is_empty()).then_some(episode.duration),
                    summary: (!episode.desc.is_empty()).then_some(episode.desc),
                    thumbnail: None,
                }
            })
            .collect())
    }

    async fn get_characters(&self, id: &str) -> Result<Vec<CharacterInfo>> {
        let id = Self::parse_id(id)?;
        let characters: Vec<Character> = self
            .send(
                self.client
                    .get(format!("{API}/v0/subjects/{id}/characters")),
            )
            .await?;
        Ok(characters
            .into_iter()
            .take(24)
            .map(|character| CharacterInfo {
                id: character.id,
                name: character.name,
                // AniList's role names, which the details page sorts and labels by.
                role: Some(
                    match character.relation.as_deref() {
                        Some("主角") => "MAIN",
                        Some("配角") => "SUPPORTING",
                        _ => "BACKGROUND",
                    }
                    .to_owned(),
                ),
                avatar: character
                    .images
                    .and_then(|images| images.large.or(images.medium).or(images.common))
                    .filter(|url| !url.is_empty()),
                cvs: Some(
                    character
                        .actors
                        .into_iter()
                        .filter_map(|actor| actor.name)
                        .collect(),
                ),
            })
            .collect())
    }

    async fn get_calendar(&self, _language: Option<&str>) -> Result<Vec<CalendarEntry>> {
        let days: Vec<CalendarDay> = self
            .send(self.client.get(format!("{API}/calendar")))
            .await?;
        let now = now_unix();
        let mut entries: Vec<CalendarEntry> = days
            .into_iter()
            .filter(|day| (1..=7).contains(&day.weekday.id))
            .map(|day| CalendarEntry {
                weekday: Weekday {
                    id: day.weekday.id,
                    cn: day.weekday.cn,
                },
                items: day
                    .items
                    .into_iter()
                    .map(|subject| subject.into_info(None, now))
                    .collect(),
            })
            .collect();
        entries.sort_by_key(|entry| entry.weekday.id);
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_761_004_800; // 2025-10-21 00:00 UTC (08:00 Beijing)

    fn subject() -> Subject {
        serde_json::from_value(json!({
            "id": 400602, "type": 2, "name": "葬送のフリーレン", "name_cn": "葬送的芙莉莲",
            "summary": "勇者一行打倒魔王之后的故事。", "date": "2023-09-29", "platform": "TV",
            "images": { "large": "http://lain.bgm.tv/pic/cover/l/x.jpg", "common": "", "medium": "" },
            "infobox": [
                { "key": "别名", "value": [{ "v": "Frieren: Beyond Journey's End" }, { "v": "葬送のフリーレン" }] },
                { "key": "英文名", "value": "Frieren: Beyond Journey's End" },
                { "key": "动画制作", "value": "MADHOUSE" }
            ],
            "eps": 28, "total_episodes": 28, "rating": { "score": 9.1 },
            "tags": [{ "name": "奇幻", "count": 9 }, { "name": "2023年10月", "count": 5 }, { "name": "TV", "count": 3 }],
            "meta_tags": ["日本", "奇幻", "TV", "漫画改"]
        }))
        .unwrap()
    }

    fn episode(number: u32, airdate: &str) -> Episode {
        serde_json::from_value(json!({ "id": 1000 + number, "sort": number, "ep": number, "name": "", "name_cn": format!("第{number}话"), "airdate": airdate, "duration": "00:24:00", "desc": "" })).unwrap()
    }

    #[test]
    fn subjects_map_to_catalog_entries() {
        let info = subject().into_info(None, NOW);
        assert_eq!(info.id, "bangumi:400602");
        assert_eq!(info.title_cn.as_deref(), Some("葬送的芙莉莲"));
        assert_eq!(info.title, "葬送のフリーレン");
        assert_eq!(info.title_en, "Frieren: Beyond Journey's End");
        assert_eq!(
            info.cover.as_deref(),
            Some("https://lain.bgm.tv/pic/cover/l/x.jpg")
        );
        assert_eq!(info.year, Some(2023));
        assert_eq!(info.total_episodes, 28);
        assert_eq!(info.format.as_deref(), Some("TV"));
        assert_eq!(info.studios, ["MADHOUSE"]);
        assert_eq!(info.genres, ["奇幻"]);
        assert_eq!(info.score, Some(9.1));
        assert!(info
            .search_titles
            .contains(&"Frieren: Beyond Journey's End".to_owned()));
        assert_eq!(
            info.description_cn.as_deref(),
            Some("勇者一行打倒魔王之后的故事。")
        );
        assert!(info.next_airing.is_none() && info.schedule.is_none());
    }

    #[test]
    fn episode_dates_give_aired_count_and_status() {
        let airing = [
            episode(1, "2025-10-07"),
            episode(2, "2025-10-14"),
            episode(3, "2025-10-21"),
            episode(4, "2025-10-28"),
        ];
        let mut base = subject();
        base.total_episodes = 4;
        base.eps = 4;
        let info = base.clone().into_info(Some(&airing), NOW);
        assert_eq!(
            info.aired_episodes,
            Some(3),
            "today's episode counts as aired (Beijing date)"
        );
        assert_eq!(info.status.as_deref(), Some("RELEASING"));
        let finished = [episode(1, "2023-09-29"), episode(2, "2023-09-29")];
        base.total_episodes = 2;
        base.eps = 2;
        assert_eq!(
            base.clone()
                .into_info(Some(&finished), NOW)
                .status
                .as_deref(),
            Some("FINISHED")
        );
        base.date = Some("2026-01-01".into());
        assert_eq!(
            base.into_info(Some(&[episode(1, "2026-01-01")]), NOW)
                .status
                .as_deref(),
            Some("NOT_YET_RELEASED")
        );
    }

    #[test]
    fn beijing_dates() {
        assert_eq!(today(NOW), "2025-10-21");
        assert_eq!(today(NOW - 9 * 3600), "2025-10-20");
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    }

    #[test]
    fn ids_and_roles() {
        assert_eq!(Bangumi::parse_id("bangumi:21").unwrap(), 21);
        assert!(Bangumi::parse_id("anilist:21").is_err());
        assert_eq!(episode(3, "").number(), 3);
    }

    #[test]
    fn legacy_calendar_items_parse() {
        let day: CalendarDay = serde_json::from_value(json!({
            "weekday": { "en": "Mon", "cn": "星期一", "ja": "月耀日", "id": 1 },
            "items": [{ "id": 1, "url": "http://bgm.tv/subject/1", "type": 2, "name": "A", "name_cn": "",
                        "summary": "", "air_date": "2025-10-06", "air_weekday": 1,
                        "images": { "large": "http://lain.bgm.tv/l.jpg", "common": "", "medium": "", "small": "", "grid": "" },
                        "rating": { "total": 10, "count": {}, "score": 7.2 } }]
        }))
        .unwrap();
        let info = day.items[0].clone().into_info(None, NOW);
        assert_eq!(
            info.title_cn, None,
            "empty Chinese names fall back to the original"
        );
        assert_eq!(info.air_date.as_deref(), Some("2025-10-06"));
        assert_eq!(info.cover.as_deref(), Some("https://lain.bgm.tv/l.jpg"));
    }
}
