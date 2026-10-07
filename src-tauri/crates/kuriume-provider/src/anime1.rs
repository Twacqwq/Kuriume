//! Anime1's public catalog and anonymous video API. No account or WebView.
use async_trait::async_trait;
use reqwest::{Client, Url};
use scraper::Html;
use serde_json::Value;
use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

use crate::source_http::{self as http, selector};
use crate::{
    PlaybackCandidate, PlaybackEpisode, PlaybackHeaders, PlaybackProvider,
    PlaybackProviderCapabilities, PlaybackProviderDescriptor, PlaybackResolveRequest, PlaybackRoad,
    PlaybackSearch, PlaybackSource, ProviderError, ResolvePlan, Result,
};

pub struct Anime1 {
    client: Client,
    descriptor: PlaybackProviderDescriptor,
    catalog: Mutex<Option<(Instant, Vec<Value>)>>,
}

impl Default for Anime1 {
    fn default() -> Self {
        Self::new()
    }
}
impl Anime1 {
    pub fn new() -> Self {
        Self {
            client: http::client(),
            catalog: Mutex::new(None),
            descriptor: PlaybackProviderDescriptor {
                id: "builtin:anime1".into(),
                display_name: "Anime1".into(),
                built_in: true,
                capabilities: PlaybackProviderCapabilities {
                    search: true,
                    episodes: true,
                    direct: true,
                    sniff: false,
                },
            },
        }
    }
    async fn catalog(&self) -> Result<Vec<Value>> {
        if let Some((at, rows)) = &*self.catalog.lock().await {
            if at.elapsed() < Duration::from_secs(1800) {
                return Ok(rows.clone());
            }
        }
        let (body, _) = http::get(
            &self.client,
            "https://anime1.me/animelist.json",
            "anime1.me",
        )
        .await?;
        let rows: Vec<Value> = serde_json::from_str(&body)?;
        *self.catalog.lock().await = Some((Instant::now(), rows.clone()));
        Ok(rows)
    }
}

#[async_trait]
impl PlaybackProvider for Anime1 {
    fn descriptor(&self) -> &PlaybackProviderDescriptor {
        &self.descriptor
    }
    async fn search(&self, query: PlaybackSearch) -> Result<Vec<PlaybackCandidate>> {
        Ok(search_catalog(&self.catalog().await?, &query))
    }
    async fn episodes(&self, candidate_id: &str) -> Result<Vec<PlaybackRoad>> {
        let category = http::positive_id(candidate_id, "anime1:")?;
        let rows = self.catalog().await?;
        let row = rows
            .iter()
            .find(|row| row[0].as_u64() == Some(category) && catalog_title(row).is_some())
            .ok_or_else(|| ProviderError::NotFound("Anime1 work no longer exists".into()))?;
        let offset = episode_range(row[2].as_str().unwrap_or_default())
            .map_or(0, |(start, _)| start.saturating_sub(1));
        let mut next = Some(format!("https://anime1.me/?cat={category}"));
        let mut visited = BTreeSet::new();
        let mut episodes = Vec::new();
        while let Some(url) = next.take() {
            if visited.len() >= 40 || !visited.insert(url.clone()) {
                return Err(ProviderError::Source(
                    "Anime1 episode pagination exceeded limit".into(),
                ));
            }
            let (html, url) = http::get(&self.client, &url, "anime1.me").await?;
            let (mut page, following) = parse_page(&html, &url, category, offset)?;
            episodes.append(&mut page);
            next = following;
        }
        episodes.sort_by(|a, b| {
            a.episode_number
                .partial_cmp(&b.episode_number)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        episodes.dedup_by(|a, b| a.id == b.id);
        if episodes.is_empty() {
            return Err(ProviderError::NotFound(
                "Anime1 has no released episodes".into(),
            ));
        }
        Ok(vec![PlaybackRoad {
            id: "original".into(),
            label: "原声".into(),
            episodes,
        }])
    }
    async fn resolve(&self, request: PlaybackResolveRequest) -> Result<Vec<PlaybackSource>> {
        let category = http::positive_id(&request.candidate_id, "anime1:")?;
        let post = http::positive_id(&request.episode_id, &format!("anime1:{category}:"))?;
        if request.road_id != "original" {
            return Err(ProviderError::Parse("Invalid Anime1 version".into()));
        }
        let (html, _) = http::get(
            &self.client,
            &format!("https://anime1.me/{post}"),
            "anime1.me",
        )
        .await?;
        let payload = api_payload(&html, category)?;
        let response = self
            .client
            .post("https://v.anime1.me/api")
            .header("Origin", "https://anime1.me")
            .header("Referer", "https://anime1.me/")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!("d={payload}"))
            .send()
            .await?;
        let cookies: Vec<String> = response
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .map(str::to_owned)
            .collect();
        let body = http::text(response).await?;
        parse_media(&body, &cookies)
    }
}

fn catalog_title(row: &Value) -> Option<&str> {
    // Linked entries belong to a different site/catalog, not this provider.
    row[1]
        .as_str()
        .filter(|title| !title.contains('<') && !title.trim().is_empty())
}

fn search_catalog(rows: &[Value], query: &PlaybackSearch) -> Vec<PlaybackCandidate> {
    let aliases: Vec<_> = std::iter::once(query.query.as_str())
        .chain(query.alternative_titles.iter().map(String::as_str))
        .collect();
    let titles: Vec<_> = std::iter::once(query.query.as_str())
        .chain(query.alternative_titles.iter().map(String::as_str))
        .map(title_key)
        .filter(|s| !s.is_empty())
        .collect();
    let mut found = Vec::new();
    for row in rows {
        let (Some(id), Some(title)) = (row[0].as_u64(), catalog_title(row)) else {
            continue;
        };
        let range = episode_range(row[2].as_str().unwrap_or_default());
        let candidate = PlaybackCandidate {
            id: format!("anime1:{id}"),
            title: title.into(),
            exact_match: false,
            year: row[3].as_str().and_then(|v| v.parse().ok()),
            episode_count: range.map(|(start, end)| end - start + 1),
        };
        let (score, candidate) = http::rank(query, candidate, &[]);
        // Partial manual queries recall catalog entries, but never auto-confirm them.
        let key = title_key(title);
        let partial = titles
            .iter()
            .any(|term| key.contains(term) || term.contains(&key));
        let title_score = crate::playback_matching::score_candidate(
            title, None, None, &aliases, None, None, None,
        )
        .score;
        // A whole catalog needs title affinity, not just matching year/count
        // or a shared generic token such as "the".
        if title_score >= 50 || partial {
            found.push((if partial { score.max(60) } else { score }, candidate));
        }
    }
    http::ranked(found, query)
}

fn title_key(s: &str) -> String {
    zhconv::zhconv(s, zhconv::Variant::ZhHans)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn episode_range(value: &str) -> Option<(u32, u32)> {
    let (a, b) = value.split_once('-')?;
    let (a, b) = (a.parse().ok()?, b.parse().ok()?);
    (a > 0 && b >= a).then_some((a, b))
}
fn payload_category(payload: &str) -> Result<u64> {
    let decoded = Url::parse(&format!("https://anime1.me/?d={payload}"))
        .map_err(|_| ProviderError::Parse("Invalid Anime1 player data".into()))?
        .query_pairs()
        .find(|(key, _)| key == "d")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    let value: Value = serde_json::from_str(&decoded)?;
    value["c"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| value["c"].as_u64())
        .ok_or_else(|| ProviderError::Parse("Anime1 player missing category".into()))
}
fn api_payload(html: &str, category: u64) -> Result<String> {
    let doc = Html::parse_document(html);
    for video in doc.select(&selector("video[data-apireq]")) {
        let value = video.attr("data-apireq").unwrap_or_default();
        if value.len() <= 4096 && payload_category(value)? == category {
            return Ok(value.into());
        }
    }
    Err(ProviderError::Parse(
        "Anime1 episode belongs to another work or has no video".into(),
    ))
}
fn parse_page(
    html: &str,
    url: &Url,
    category: u64,
    offset: u32,
) -> Result<(Vec<PlaybackEpisode>, Option<String>)> {
    let doc = Html::parse_document(html);
    let mut episodes = Vec::new();
    for article in doc.select(&selector("article")) {
        let Some(video) = article.select(&selector("video[data-apireq]")).next() else {
            continue;
        };
        if payload_category(video.attr("data-apireq").unwrap_or_default())? != category {
            continue;
        }
        let Some(link) = article.select(&selector(".entry-title a")).next() else {
            continue;
        };
        let title = link.text().collect::<String>();
        let Some(post) = article
            .attr("id")
            .and_then(|s| s.strip_prefix("post-"))
            .and_then(|s| s.parse::<u64>().ok())
        else {
            continue;
        };
        let number = title
            .rsplit_once('[')
            .and_then(|(_, v)| v.split_once(']'))
            .and_then(|(v, _)| v.parse::<f64>().ok());
        let number = number
            .map(|n| n - f64::from(offset))
            .filter(|n| n.is_finite() && *n > 0.0);
        episodes.push(PlaybackEpisode {
            id: format!("anime1:{category}:{post}"),
            label: title,
            episode_number: number,
        });
    }
    let next = doc
        .select(&selector(".nav-previous a"))
        .next()
        .and_then(|el| el.attr("href"))
        .map(|href| {
            url.join(href)
                .map_err(|_| ProviderError::Parse("Invalid Anime1 pagination".into()))
        })
        .transpose()?
        .map(String::from);
    Ok((episodes, next))
}
fn parse_media(body: &str, cookies: &[String]) -> Result<Vec<PlaybackSource>> {
    let value: Value = serde_json::from_str(body)?;
    let mut sources = Vec::new();
    for source in value["s"].as_array().into_iter().flatten().take(4) {
        let Some(src) = source["src"].as_str() else {
            continue;
        };
        let src = if src.starts_with("//") {
            format!("https:{src}")
        } else {
            src.into()
        };
        let url = http::scoped_url(&src, &["v.anime1.me"])?;
        if !url.path().ends_with(".mp4") {
            continue;
        }
        let cookie = cookies
            .iter()
            .filter_map(|raw| {
                let parts: Vec<_> = raw.split(';').map(str::trim).collect();
                let (name, _) = parts.first()?.split_once('=')?;
                if !matches!(name, "e" | "p" | "h") {
                    return None;
                }
                let path = parts
                    .iter()
                    .find_map(|p| p.strip_prefix("path=").or_else(|| p.strip_prefix("Path=")));
                let domain = parts.iter().find_map(|p| {
                    p.strip_prefix("domain=")
                        .or_else(|| p.strip_prefix("Domain="))
                });
                (path == Some(url.path())
                    && domain.is_some_and(|d| d.trim_start_matches('.') == "v.anime1.me"))
                .then(|| parts[0].to_string())
            })
            .collect::<Vec<_>>()
            .join("; ");
        if cookie.is_empty() {
            return Err(ProviderError::Source(
                "Anime1 video session is unavailable".into(),
            ));
        }
        sources.push(PlaybackSource {
            name: "Anime1".into(),
            plan: ResolvePlan::Direct {
                allowed_hosts: vec![url.host_str().expect("validated media host").into()],
                url: url.into(),
                mime_type: Some("video/mp4".into()),
                subtitles: vec![],
                headers: PlaybackHeaders::from([
                    ("Referer".into(), "https://anime1.me/".into()),
                    ("Cookie".into(), cookie),
                ]),
            },
        });
    }
    if sources.is_empty() {
        return Err(ProviderError::NotFound(
            "Anime1 has no available media".into(),
        ));
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_matches_simplified_aliases_without_unrelated_or_external_entries() {
        let rows: Vec<Value> = serde_json::from_value(serde_json::json!([
            [1, "THE MARGINAL SERVICE", "1-12", "2023"],
            [2, "Paradox Live THE ANIMATION", "1-12", "2023"],
            [3, "葬送的芙莉蓮", "1-28", "2023"],
            [
                4,
                "<a href=\"https://other.example\">葬送的芙莉蓮</a>",
                "1-28",
                "2023"
            ],
            [5, "葬送的芙莉蓮 第二季", "29-38", "2026"]
        ]))
        .unwrap();
        let mut query = PlaybackSearch {
            query: "Sousou no Frieren".into(),
            alternative_titles: vec![
                "Frieren: Beyond Journey's End".into(),
                "葬送的芙莉莲".into(),
            ],
            anilist_id: None,
            year: Some(2023),
            episode_count: Some(28),
            episode_number: Some(1),
            limit: None,
        };
        let found = search_catalog(&rows, &query);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "anime1:3");
        assert!(found[0].exact_match);
        query.query = "葬送".into();
        query.alternative_titles.clear();
        let found = search_catalog(&rows, &query);
        assert!(!found.is_empty());
        assert!(found
            .iter()
            .all(|c| !c.exact_match && !c.title.contains('<')));
        query.query = "An unrelated title with the".into();
        assert!(search_catalog(&rows, &query).is_empty());
    }
    #[test]
    fn category_pagination_and_continuous_episode_numbers() {
        let html = r#"<article id="post-9"><h2 class="entry-title"><a>作品 [29]</a></h2><video data-apireq="%7B%22c%22%3A%221833%22%7D"></video></article><div class="nav-previous"><a href="/category/show/page/2">上一頁</a></div>"#;
        let (eps, next) = parse_page(
            html,
            &Url::parse("https://anime1.me/category/show").unwrap(),
            1833,
            28,
        )
        .unwrap();
        assert_eq!(eps[0].episode_number, Some(1.0));
        assert!(next.unwrap().ends_with("/page/2"));
        assert!(api_payload(html, 1307).is_err());
        assert!(http::positive_id("anime1:1307:9", "anime1:1833:").is_err());
    }
    #[test]
    fn video_cookies_are_limited_to_the_returned_media() {
        let cookies = vec![
            "e=123; path=/1/2.mp4; domain=.v.anime1.me; secure".into(),
            "account=secret; path=/; domain=.anime1.me".into(),
        ];
        let sources =
            parse_media(r#"{"s":[{"src":"//miru.v.anime1.me/1/2.mp4"}]}"#, &cookies).unwrap();
        let ResolvePlan::Direct {
            headers,
            allowed_hosts,
            ..
        } = &sources[0].plan
        else {
            panic!()
        };
        assert_eq!(headers["Cookie"], "e=123");
        assert_eq!(allowed_hosts, &["miru.v.anime1.me"]);
        assert!(parse_media(
            r#"{"s":[{"src":"https://evil.example/1/2.mp4"}]}"#,
            &cookies
        )
        .is_err());
        assert!(parse_media(
            r#"{"s":[{"src":"https://miru.v.anime1.me/other.mp4"}]}"#,
            &cookies
        )
        .is_err());
    }
}
