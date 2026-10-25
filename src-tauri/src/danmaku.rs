//! Danmaku from the 弹弹play open danmaku network (https://www.dandanplay.com).
//!
//! Requests use signature authentication: the AppSecret is compiled in from
//! `KURIUME_DANDANPLAY_APP_ID` / `KURIUME_DANDANPLAY_APP_SECRET` at build time
//! (CI secrets), never sent over the network and never visible to the WebView.
//! Builds without them simply have no danmaku.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::State;

const API: &str = "https://api.dandanplay.net";
const APP_ID: Option<&str> = option_env!("KURIUME_DANDANPLAY_APP_ID");
const APP_SECRET: Option<&str> = option_env!("KURIUME_DANDANPLAY_APP_SECRET");

/// 弹弹play's caching advice: about an hour for a series still airing, half a
/// day otherwise.
const AIRING_TTL: Duration = Duration::from_secs(60 * 60);
const FINISHED_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const CACHE_LIMIT: usize = 64;
/// Titles tried per automatic match (Chinese, Japanese, romaji…).
const MATCH_TITLES: usize = 4;

fn credentials() -> Option<(&'static str, &'static str)> {
    match (APP_ID, APP_SECRET) {
        (Some(id), Some(secret)) if !id.trim().is_empty() && !secret.trim().is_empty() => {
            Some((id.trim(), secret.trim()))
        }
        _ => None,
    }
}

pub struct DanmakuState {
    client: reqwest::Client,
    comments: Mutex<HashMap<u64, CachedComments>>,
}

/// One episode's comments and when they go stale.
struct CachedComments {
    stored: Instant,
    ttl: Duration,
    comments: Vec<Comment>,
}

impl DanmakuState {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent(concat!("Kuriume/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(20))
                .build()
                .unwrap_or_default(),
            comments: Mutex::new(HashMap::new()),
        }
    }

    /// A signed GET. `path` is what gets signed: no host, no query string.
    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<T, String> {
        let (app_id, secret) = credentials().ok_or_else(|| UNAVAILABLE.to_string())?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        let response = self
            .client
            .get(format!("{API}{path}"))
            .query(query)
            .header("Accept", "application/json")
            .header("X-AppId", app_id)
            .header("X-Timestamp", timestamp.to_string())
            .header("X-Signature", signature(app_id, timestamp, path, secret))
            .send()
            .await
            .map_err(|error| format!("弹弹play: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            let reason = response
                .headers()
                .get("X-Error-Message")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            return Err(match reason {
                Some(reason) => format!("弹弹play HTTP {status}: {reason}"),
                None => format!("弹弹play HTTP {status}"),
            });
        }
        response
            .json::<T>()
            .await
            .map_err(|error| format!("弹弹play: {error}"))
    }
}

impl Default for DanmakuState {
    fn default() -> Self {
        Self::new()
    }
}

/// Error the frontend recognises: this build has no 弹弹play credentials.
pub const UNAVAILABLE: &str = "DANMAKU_UNAVAILABLE";

/// `base64(sha256(AppId + Timestamp + Path + AppSecret))`.
fn signature(app_id: &str, timestamp: u64, path: &str, secret: &str) -> String {
    let digest = ring::digest::digest(
        &ring::digest::SHA256,
        format!("{app_id}{timestamp}{path}{secret}").as_bytes(),
    );
    base64(digest.as_ref())
}

/// Standard, padded base64.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * index)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// ---- API shapes -----------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    #[serde(default = "yes")]
    success: bool,
    #[serde(default)]
    error_message: Option<String>,
}

fn yes() -> bool {
    true
}

impl Envelope {
    fn check(&self) -> Result<(), String> {
        if self.success {
            Ok(())
        } else {
            Err(format!(
                "弹弹play: {}",
                self.error_message.as_deref().unwrap_or("request failed")
            ))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    #[serde(flatten)]
    envelope: Envelope,
    #[serde(default)]
    animes: Vec<SearchAnime>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchAnime {
    anime_id: u64,
    anime_title: String,
    #[serde(default)]
    type_description: Option<String>,
    #[serde(default)]
    episodes: Vec<SearchEpisode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchEpisode {
    episode_id: u64,
    episode_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BangumiResponse {
    #[serde(flatten)]
    envelope: Envelope,
    bangumi: Option<BangumiDetail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BangumiDetail {
    #[serde(default)]
    anime_id: Option<u64>,
    #[serde(default)]
    anime_title: Option<String>,
    #[serde(default)]
    titles: Vec<BangumiTitle>,
    #[serde(default)]
    episodes: Vec<BangumiEpisode>,
}

#[derive(Deserialize)]
struct BangumiTitle {
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BangumiEpisode {
    episode_id: u64,
    episode_title: String,
    #[serde(default)]
    episode_number: Option<String>,
}

#[derive(Deserialize)]
struct CommentResponse {
    #[serde(default)]
    comments: Vec<RawComment>,
}

#[derive(Deserialize)]
struct RawComment {
    p: String,
    m: String,
}

// ---- What the frontend gets -----------------------------------------------

/// The 弹弹play episode a Kuriume episode plays with.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuMatch {
    anime_id: u64,
    anime_title: String,
    episode_id: u64,
    episode_title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuAnime {
    anime_id: u64,
    title: String,
    type_description: Option<String>,
    episode_count: usize,
}

/// One comment: seconds into the episode, display mode and RGB colour.
#[derive(Clone, Serialize)]
pub struct Comment {
    time: f64,
    mode: CommentMode,
    color: u32,
    text: String,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CommentMode {
    Scroll,
    Top,
    Bottom,
}

/// `p` is `time,mode,color,user`: 弹弹play modes 1 scroll, 4 bottom, 5 top.
fn parse_comment(p: &str, text: &str) -> Option<Comment> {
    let mut fields = p.split(',');
    let time: f64 = fields.next()?.trim().parse().ok()?;
    let mode = match fields.next()?.trim() {
        "4" => CommentMode::Bottom,
        "5" => CommentMode::Top,
        _ => CommentMode::Scroll,
    };
    let color = fields
        .next()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0xFF_FF_FF)
        & 0xFF_FF_FF;
    let text = text.trim();
    (time.is_finite() && time >= 0.0 && !text.is_empty()).then(|| Comment {
        time,
        mode,
        color,
        text: text.to_owned(),
    })
}

/// Comparison key for titles: lowercase letters, digits and CJK only.
fn title_key(title: &str) -> String {
    title
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// The episode numbered `episode` ("1", "01"), not specials ("S1", "C1").
fn find_episode(episodes: &[BangumiEpisode], episode: u32) -> Option<&BangumiEpisode> {
    episodes.iter().find(|item| {
        item.episode_number
            .as_deref()
            .and_then(|number| number.trim().parse::<u32>().ok())
            == Some(episode)
    })
}

fn detail_match(detail: BangumiDetail, episode: u32) -> Option<DanmakuMatch> {
    let found = find_episode(&detail.episodes, episode)?;
    Some(DanmakuMatch {
        // 弹弹play episode IDs are the anime ID followed by four digits.
        anime_id: detail.anime_id.unwrap_or(found.episode_id / 10_000),
        anime_title: detail
            .anime_title
            .clone()
            .or_else(|| detail.titles.first().map(|title| title.title.clone()))
            .unwrap_or_default(),
        episode_id: found.episode_id,
        episode_title: found.episode_title.clone(),
    })
}

/// The search result whose title matches one of ours, else the first one.
fn pick_anime(animes: Vec<SearchAnime>, titles: &[String]) -> Option<SearchAnime> {
    let keys: Vec<_> = titles.iter().map(|title| title_key(title)).collect();
    let with_episodes = animes
        .into_iter()
        .filter(|anime| !anime.episodes.is_empty());
    let mut fallback = None;
    for anime in with_episodes {
        if keys.contains(&title_key(&anime.anime_title)) {
            return Some(anime);
        }
        fallback.get_or_insert(anime);
    }
    fallback
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRequest {
    /// A remembered (or chosen) 弹弹play anime.
    anime_id: Option<u64>,
    /// The work's bgm.tv subject, for Bangumi catalog entries.
    bangumi_id: Option<u64>,
    /// Titles to search with, best first.
    titles: Vec<String>,
    episode: u32,
}

#[tauri::command]
pub fn danmaku_available() -> bool {
    credentials().is_some()
}

/// Finds the 弹弹play episode for one Kuriume episode; `None` when 弹弹play
/// has no such work or episode.
#[tauri::command]
pub async fn danmaku_match(
    state: State<'_, DanmakuState>,
    request: MatchRequest,
) -> Result<Option<DanmakuMatch>, String> {
    if request.episode == 0 {
        return Ok(None);
    }
    for path in [
        request.anime_id.map(|id| format!("/api/v2/bangumi/{id}")),
        request
            .bangumi_id
            .map(|id| format!("/api/v2/bangumi/bgmtv/{id}")),
    ]
    .into_iter()
    .flatten()
    {
        let response: BangumiResponse = match state.get(&path, &[]).await {
            Ok(response) => response,
            // An unknown bgm.tv subject is a 404; fall back to searching.
            Err(error) if error.contains("HTTP 404") => continue,
            Err(error) => return Err(error),
        };
        if response.envelope.success {
            if let Some(found) = response
                .bangumi
                .and_then(|detail| detail_match(detail, request.episode))
            {
                return Ok(Some(found));
            }
        }
    }
    let mut seen = Vec::new();
    for title in request
        .titles
        .iter()
        .map(|title| title.trim())
        .filter(|title| !title.is_empty())
    {
        if seen.len() >= MATCH_TITLES || seen.contains(&title) {
            continue;
        }
        seen.push(title);
        let response: SearchResponse = state
            .get(
                "/api/v2/search/episodes",
                &[
                    ("anime", title.to_owned()),
                    ("episode", request.episode.to_string()),
                ],
            )
            .await?;
        response.envelope.check()?;
        if let Some(anime) = pick_anime(response.animes, &request.titles) {
            let episode = &anime.episodes[0];
            return Ok(Some(DanmakuMatch {
                anime_id: anime.anime_id,
                anime_title: anime.anime_title.clone(),
                episode_id: episode.episode_id,
                episode_title: episode.episode_title.clone(),
            }));
        }
    }
    Ok(None)
}

/// Works matching `keyword`, for choosing a match by hand.
#[tauri::command]
pub async fn danmaku_search(
    state: State<'_, DanmakuState>,
    keyword: String,
) -> Result<Vec<DanmakuAnime>, String> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Ok(Vec::new());
    }
    let response: SearchResponse = state
        .get("/api/v2/search/episodes", &[("anime", keyword.to_owned())])
        .await?;
    response.envelope.check()?;
    Ok(response
        .animes
        .into_iter()
        .map(|anime| DanmakuAnime {
            anime_id: anime.anime_id,
            title: anime.anime_title,
            type_description: anime.type_description,
            episode_count: anime.episodes.len(),
        })
        .collect())
}

/// An episode's comments in time order, including those 弹弹play gathers from
/// other sites, converted to simplified Chinese.
#[tauri::command]
pub async fn danmaku_comments(
    state: State<'_, DanmakuState>,
    episode_id: u64,
    airing: bool,
) -> Result<Vec<Comment>, String> {
    if let Ok(cache) = state.comments.lock() {
        if let Some(cached) = cache.get(&episode_id) {
            if cached.stored.elapsed() < cached.ttl {
                return Ok(cached.comments.clone());
            }
        }
    }
    let response: CommentResponse = state
        .get(
            &format!("/api/v2/comment/{episode_id}"),
            &[
                ("withRelated", "true".to_owned()),
                ("chConvert", "1".to_owned()),
            ],
        )
        .await?;
    let mut comments: Vec<_> = response
        .comments
        .iter()
        .filter_map(|comment| parse_comment(&comment.p, &comment.m))
        .collect();
    comments.sort_by(|a, b| a.time.total_cmp(&b.time));
    if let Ok(mut cache) = state.comments.lock() {
        if cache.len() >= CACHE_LIMIT {
            cache.clear();
        }
        let ttl = if airing { AIRING_TTL } else { FINISHED_TTL };
        cache.insert(
            episode_id,
            CachedComments {
                stored: Instant::now(),
                ttl,
                comments: comments.clone(),
            },
        );
    }
    Ok(comments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc_4648() {
        for (input, output) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), output);
        }
    }

    #[test]
    fn signatures_follow_the_documented_formula() {
        // sha256("abc") = ba7816bf…15ad, base64 below.
        assert_eq!(
            base64(ring::digest::digest(&ring::digest::SHA256, b"abc").as_ref()),
            "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="
        );
        assert_eq!(
            signature("a", 1, "/b", "c"),
            base64(ring::digest::digest(&ring::digest::SHA256, b"a1/bc").as_ref())
        );
    }

    #[test]
    fn comments_parse_time_mode_and_colour() {
        let scroll = parse_comment("12.5,1,16777215,[BiliBili]abc", " 好 ").unwrap();
        assert_eq!(
            (scroll.time, scroll.mode, scroll.color, scroll.text.as_str()),
            (12.5, CommentMode::Scroll, 0xFFFFFF, "好")
        );
        assert_eq!(
            parse_comment("3,5,255,u", "x").unwrap().mode,
            CommentMode::Top
        );
        assert_eq!(
            parse_comment("3,4,255,u", "x").unwrap().mode,
            CommentMode::Bottom
        );
        assert!(parse_comment("x,1,0,u", "x").is_none());
        assert!(parse_comment("1,1,0,u", "  ").is_none());
    }

    #[test]
    fn episodes_match_by_number_and_titles_by_key() {
        let episodes = vec![
            BangumiEpisode {
                episode_id: 176170001,
                episode_title: "第1话".into(),
                episode_number: Some("1".into()),
            },
            BangumiEpisode {
                episode_id: 176170002,
                episode_title: "第2话".into(),
                episode_number: Some("02".into()),
            },
            BangumiEpisode {
                episode_id: 176170003,
                episode_title: "特别篇".into(),
                episode_number: Some("S1".into()),
            },
        ];
        assert_eq!(
            find_episode(&episodes, 2).map(|e| e.episode_id),
            Some(176170002)
        );
        assert!(find_episode(&episodes, 3).is_none());
        let detail = BangumiDetail {
            anime_id: None,
            anime_title: None,
            titles: vec![BangumiTitle {
                title: "葬送的芙莉莲".into(),
            }],
            episodes,
        };
        let found = detail_match(detail, 1).unwrap();
        assert_eq!(
            (found.anime_id, found.anime_title.as_str()),
            (17617, "葬送的芙莉莲")
        );

        let anime = |id, title: &str| SearchAnime {
            anime_id: id,
            anime_title: title.into(),
            type_description: None,
            episodes: vec![SearchEpisode {
                episode_id: id * 10_000 + 1,
                episode_title: "第1话".into(),
            }],
        };
        let titles = vec!["葬送的芙莉莲 第三季 黄金乡篇".to_string()];
        let picked = pick_anime(
            vec![
                anime(17617, "葬送的芙莉莲"),
                anime(19977, "葬送的芙莉莲 第三季 黄金乡篇"),
            ],
            &titles,
        );
        assert_eq!(picked.map(|a| a.anime_id), Some(19977));
        let picked = pick_anime(vec![anime(17617, "葬送的芙莉莲")], &["Frieren".into()]);
        assert_eq!(
            picked.map(|a| a.anime_id),
            Some(17617),
            "falls back to the first result"
        );
    }
}
