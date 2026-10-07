//! HiAnime's public catalog -> episode servers -> ZokoAnime media config.
//! Only data is decoded; no remote JavaScript, verification UI or player page
//! is executed. See docs/playback-review-2026-10-07.md for protocol provenance.

use std::{collections::BTreeMap, time::Duration};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, Url};
use scraper::{Html, Selector};
use serde::Deserialize;

use crate::{
    playback_matching as matching, PlaybackCandidate, PlaybackEpisode, PlaybackHeaders,
    PlaybackProvider, PlaybackProviderCapabilities, PlaybackProviderDescriptor,
    PlaybackResolveRequest, PlaybackRoad, PlaybackSearch, PlaybackSource, PlaybackSubtitle,
    ProviderError, ResolvePlan, Result,
};

const SITE: &str = "https://hianime.at";
const MEDIA_HOST: &str = "hls.dramahot.top";
const MAX_BODY: usize = 2 * 1024 * 1024;

pub struct HiAnime {
    client: Client,
    descriptor: PlaybackProviderDescriptor,
}

impl Default for HiAnime {
    fn default() -> Self {
        Self::new()
    }
}

impl HiAnime {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("Kuriume/0.1")
                .build()
                .expect("valid HiAnime HTTP client"),
            descriptor: PlaybackProviderDescriptor {
                id: "builtin:hianime".into(),
                display_name: "HiAnime".into(),
                built_in: true,
                capabilities: PlaybackProviderCapabilities {
                    search: true,
                    episodes: true,
                    direct: true,
                    ..Default::default()
                },
            },
        }
    }

    async fn get(&self, url: Url) -> Result<String> {
        let mut response = self.client.get(url).send().await?.error_for_status()?;
        if !response.status().is_success() {
            return Err(ProviderError::Source(
                "HiAnime endpoint changed; unexpected redirect".into(),
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > MAX_BODY {
                return Err(ProviderError::Parse(
                    "HiAnime response exceeds size limit".into(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        String::from_utf8(bytes)
            .map_err(|_| ProviderError::Parse("Invalid HiAnime response".into()))
    }

    async fn fragment(&self, path: &str) -> Result<String> {
        #[derive(Deserialize)]
        struct Fragment {
            status: bool,
            html: String,
        }
        let result: Fragment = serde_json::from_str(&self.get(site_url(path)).await?)?;
        if !result.status {
            return Err(ProviderError::Source(
                "HiAnime episode is unavailable".into(),
            ));
        }
        Ok(result.html)
    }
}

#[async_trait]
impl PlaybackProvider for HiAnime {
    fn descriptor(&self) -> &PlaybackProviderDescriptor {
        &self.descriptor
    }

    async fn search(&self, query: PlaybackSearch) -> Result<Vec<PlaybackCandidate>> {
        let titles: Vec<&str> = std::iter::once(query.query.as_str())
            .chain(query.alternative_titles.iter().map(String::as_str))
            .collect();
        let mut found = BTreeMap::new();
        // Aliases avoid requiring the display language to match the source.
        // Stop on a confident match; challenge/HTTP errors are not retried.
        for term in matching::search_terms(&titles).into_iter().take(4) {
            let mut url = site_url("/search");
            url.query_pairs_mut().append_pair("keyword", &term);
            for (score, candidate) in parse_search(&self.get(url).await?, &query) {
                found
                    .entry(candidate.id.clone())
                    .or_insert((score, candidate));
            }
            if found.values().any(|(_, candidate)| candidate.exact_match) {
                break;
            }
        }
        let mut found: Vec<_> = found.into_values().collect();
        found.sort_by(|a, b| b.1.exact_match.cmp(&a.1.exact_match).then(b.0.cmp(&a.0)));
        if let Some((best, _)) = found.first() {
            let floor = (best - 55).max(25);
            found.retain(|(score, _)| *score >= floor);
        }
        Ok(found
            .into_iter()
            .take(query.limit.unwrap_or(12).clamp(1, 20))
            .map(|(_, item)| item)
            .collect())
    }

    async fn episodes(&self, candidate_id: &str) -> Result<Vec<PlaybackRoad>> {
        let (slug, show_id) = parse_candidate(candidate_id)?;
        let episode_path = format!("/api/theme/episode/list/{show_id}");
        let (detail, fragment) = tokio::try_join!(
            self.get(site_url(&format!("/{slug}"))),
            self.fragment(&episode_path),
        )?;
        let episodes = parse_episodes(show_id, &fragment);
        let detail = Html::parse_document(&detail);
        let mut roads = Vec::new();
        for (version, label) in [("sub", "Sub"), ("dub", "Dub")] {
            let count = detail
                .select(&selector(&format!(".anisc-detail .tick-{version}")))
                .next()
                .and_then(|el| el.text().collect::<String>().trim().parse::<f64>().ok());
            let Some(count) = count else {
                continue;
            };
            let episodes: Vec<_> = episodes
                .iter()
                .filter(|ep| ep.episode_number.is_some_and(|n| n <= count))
                .cloned()
                .collect();
            if !episodes.is_empty() {
                roads.push(PlaybackRoad {
                    id: version.into(),
                    label: label.into(),
                    episodes,
                });
            }
        }
        if roads.is_empty() {
            return Err(ProviderError::NotFound(
                "HiAnime has no released episodes".into(),
            ));
        }
        Ok(roads)
    }

    async fn resolve(&self, request: PlaybackResolveRequest) -> Result<Vec<PlaybackSource>> {
        let (_, show_id) = parse_candidate(&request.candidate_id)?;
        let ep_id = parse_episode(show_id, &request.episode_id)?;
        if !matches!(request.road_id.as_str(), "sub" | "dub") {
            return Err(ProviderError::Parse("Invalid HiAnime version".into()));
        }
        let html = self
            .fragment(&format!("/api/theme/episode/servers?episodeId={ep_id}"))
            .await?;
        let player_url = parse_server(&html, &request.road_id)?;
        let config = self.get(player_url).await?;
        Ok(vec![PlaybackSource {
            name: "ZokoAnime".into(),
            plan: decode_config(&config)?,
        }])
    }
}

fn site_url(path: &str) -> Url {
    Url::parse(SITE)
        .unwrap()
        .join(path)
        .expect("validated HiAnime path")
}
fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("static HiAnime selector")
}

fn parse_candidate(id: &str) -> Result<(&str, u64)> {
    let slug = id.strip_prefix("hianime:").unwrap_or_default();
    let show = slug
        .rsplit('-')
        .next()
        .and_then(|n| n.parse::<u64>().ok())
        .filter(|n| *n > 0);
    if slug.len() > 256
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || show.is_none()
    {
        return Err(ProviderError::Parse("Invalid HiAnime candidate".into()));
    }
    Ok((slug, show.unwrap()))
}

fn parse_episode(show: u64, id: &str) -> Result<u64> {
    id.strip_prefix(&format!("hianime:{show}:"))
        .and_then(|n| n.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .ok_or_else(|| ProviderError::Parse("HiAnime episode belongs to another work".into()))
}

fn parse_search(html: &str, query: &PlaybackSearch) -> Vec<(i32, PlaybackCandidate)> {
    let document = Html::parse_document(html);
    let titles: Vec<&str> = std::iter::once(query.query.as_str())
        .chain(query.alternative_titles.iter().map(String::as_str))
        .collect();
    document
        .select(&selector(".film_list-wrap .flw-item"))
        .filter_map(|item| {
            let link = item.select(&selector(".film-name a")).next()?;
            let url = Url::parse(SITE).ok()?.join(link.attr("href")?).ok()?;
            if url.host_str() != Some("hianime.at") {
                return None;
            }
            let id = format!("hianime:{}", url.path().trim_matches('/'));
            parse_candidate(&id).ok()?;
            let title = link
                .attr("title")
                .map(str::to_owned)
                .unwrap_or_else(|| link.text().collect::<String>().trim().into());
            let count = item
                .select(&selector(".tick-sub"))
                .next()
                .and_then(|el| el.text().collect::<String>().trim().parse().ok());
            let score = [title.as_str(), link.attr("data-jname").unwrap_or_default()]
                .into_iter()
                .map(|title| {
                    matching::score_candidate(
                        title,
                        None,
                        count,
                        &titles,
                        query.year,
                        query.episode_count,
                        query.episode_number,
                    )
                })
                .max_by_key(|m| (m.high_confidence, m.score))?;
            Some((
                score.score,
                PlaybackCandidate {
                    id,
                    title,
                    exact_match: score.high_confidence,
                    episode_count: count,
                    year: None,
                },
            ))
        })
        .collect()
}

fn parse_episodes(show: u64, html: &str) -> Vec<PlaybackEpisode> {
    let document = Html::parse_fragment(html);
    let mut episodes: Vec<_> = document
        .select(&selector(".ep-item[data-id][data-number]"))
        .filter_map(|el| {
            let id = el.attr("data-id")?.parse::<u64>().ok()?;
            let number = el.attr("data-number")?.parse::<f64>().ok()?;
            if id == 0 || !number.is_finite() || number <= 0.0 {
                return None;
            }
            Some(PlaybackEpisode {
                id: format!("hianime:{show}:{id}"),
                label: el.attr("title").unwrap_or_default().into(),
                episode_number: Some(number),
            })
        })
        .collect();
    episodes.sort_by(|a, b| a.episode_number.partial_cmp(&b.episode_number).unwrap());
    episodes.dedup_by(|a, b| a.id == b.id);
    episodes
}

fn scoped_https(raw: &str, host: &str) -> Result<Url> {
    let url =
        Url::parse(raw).map_err(|_| ProviderError::Parse("Invalid HiAnime media URL".into()))?;
    if url.scheme() != "https"
        || url.host_str() != Some(host)
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(ProviderError::Parse("Undeclared HiAnime media host".into()));
    }
    Ok(url)
}

fn parse_server(html: &str, version: &str) -> Result<Url> {
    let document = Html::parse_fragment(html);
    for item in document.select(&selector(".server-item[data-hash]")) {
        if item.attr("data-type") != Some(version)
            || item.attr("data-server-name") != Some("ZokoAnime")
        {
            continue;
        }
        let bytes = STANDARD
            .decode(item.attr("data-hash").unwrap_or_default())
            .map_err(|_| ProviderError::Parse("Invalid HiAnime server data".into()))?;
        let raw = String::from_utf8(bytes)
            .map_err(|_| ProviderError::Parse("Invalid HiAnime server URL".into()))?;
        let url = scoped_https(&raw, "zokoanime.video")?;
        let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
        if parts.len() != 5
            || parts[0] != "stream"
            || parts[1] != "mal"
            || parts[2].parse::<u64>().is_err()
            || parts[3].parse::<f64>().is_err()
            || parts[4] != version
        {
            return Err(ProviderError::Parse(
                "Unsupported HiAnime server path".into(),
            ));
        }
        return Ok(url);
    }
    Err(ProviderError::NotFound(
        "No supported HiAnime server for this episode/version".into(),
    ))
}

fn decode_config(html: &str) -> Result<ResolvePlan> {
    #[derive(Deserialize)]
    struct Track {
        src: String,
        label: String,
        lang: Option<String>,
    }
    #[derive(Deserialize)]
    struct Config {
        src: String,
        #[serde(default)]
        subtitles: Vec<Track>,
    }
    let encoded = html
        .split_once("window.__P=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .map(|(value, _)| value)
        .ok_or_else(|| ProviderError::Source("HiAnime player config unavailable".into()))?;
    let mut bytes = STANDARD
        .decode(encoded)
        .map_err(|_| ProviderError::Parse("Invalid HiAnime config encoding".into()))?;
    let key = b"otaku-embed-v1";
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte ^= key[i % key.len()];
    }
    let config: Config = serde_json::from_slice(&bytes)?;
    let url = scoped_https(&config.src, MEDIA_HOST)?;
    if !url.path().ends_with(".m3u8") {
        return Err(ProviderError::Parse(
            "HiAnime did not return HLS media".into(),
        ));
    }
    let subtitles = config
        .subtitles
        .into_iter()
        .take(32)
        .filter_map(|track| {
            let url = scoped_https(&track.src, MEDIA_HOST).ok()?;
            if !url.path().ends_with(".vtt") {
                return None;
            }
            Some(PlaybackSubtitle {
                label: track.label,
                url: url.into(),
                language: track.lang,
            })
        })
        .collect();
    let headers = PlaybackHeaders::from([("Referer".into(), "https://zokoanime.video/".into())]);
    Ok(ResolvePlan::Direct {
        url: url.into(),
        mime_type: Some("application/x-mpegURL".into()),
        subtitles,
        headers,
        allowed_hosts: vec![MEDIA_HOST.into(), "hls1.drama1.cfd".into()],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query() -> PlaybackSearch {
        PlaybackSearch {
            query: "葬送的芙莉莲".into(),
            alternative_titles: vec!["Sousou no Frieren".into()],
            anilist_id: None,
            year: Some(2023),
            episode_count: Some(28),
            episode_number: Some(1),
            limit: None,
        }
    }

    #[test]
    fn matches_alias_without_confusing_sequels_or_sidebar() {
        let result = parse_search(
            r#"<div class="film_list-wrap">
          <div class="flw-item"><div class="tick-sub">28</div><h3 class="film-name"><a href="/frieren-481" title="Frieren: Beyond Journey's End" data-jname="Sousou no Frieren">Frieren</a></h3></div>
          <div class="flw-item"><div class="tick-sub">10</div><h3 class="film-name"><a href="/frieren-season-2-808" title="Frieren Season 2" data-jname="Sousou no Frieren 2nd Season">S2</a></h3></div>
        </div><div class="flw-item"><h3 class="film-name"><a href="/unrelated-1">Other</a></h3></div>"#,
            &query(),
        );
        assert_eq!(result.len(), 2);
        assert!(result[0].1.exact_match);
        assert!(!result[1].1.exact_match);
        assert!(result[0].0 > result[1].0);
    }

    #[test]
    fn preserves_episode_identity_and_rejects_other_show() {
        let episodes = parse_episodes(
            481,
            r#"<a class="ep-item" data-id="9228" data-number="2" title="Second"></a><a class="ep-item" data-id="9227" data-number="1"></a>"#,
        );
        assert_eq!(episodes[0].episode_number, Some(1.0));
        assert_eq!(parse_episode(481, &episodes[1].id).unwrap(), 9228);
        assert!(parse_episode(808, &episodes[0].id).is_err());
        assert!(parse_candidate("hianime:../../search?x=481").is_err());
    }

    #[test]
    fn decode_is_data_only_and_host_scoped() {
        let encode = |src: &str| {
            let config = serde_json::json!({"src": src, "subtitles":[{"src":"https://hls.dramahot.top/sub.vtt","label":"English","lang":"en"}]}).to_string();
            let bytes: Vec<_> = config
                .bytes()
                .enumerate()
                .map(|(i, b)| b ^ b"otaku-embed-v1"[i % 14])
                .collect();
            format!("<script>window.__P=\"{}\"</script>", STANDARD.encode(bytes))
        };
        let ResolvePlan::Direct { subtitles, .. } =
            decode_config(&encode("https://hls.dramahot.top/master.m3u8")).unwrap()
        else {
            panic!()
        };
        assert_eq!(subtitles[0].language.as_deref(), Some("en"));
        assert!(decode_config(&encode("https://127.0.0.1/master.m3u8")).is_err());
        assert!(decode_config("<h1>Verify you are human</h1>").is_err());
        assert!(scoped_https("https://user@hls.dramahot.top/x", MEDIA_HOST).is_err());
    }

    #[test]
    fn does_not_silently_switch_translation_or_load_unknown_hosts() {
        let hash = STANDARD.encode("https://zokoanime.video/stream/mal/52991/1/sub");
        let html = format!(
            r#"<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="{hash}"></div>"#
        );
        assert!(parse_server(&html, "sub").is_ok());
        assert!(parse_server(&html, "dub").is_err());
        let html = html.replace(
            &hash,
            &STANDARD.encode("https://evil.example/stream/mal/52991/1/sub"),
        );
        assert!(parse_server(&html, "sub").is_err());
    }

    #[tokio::test]
    #[ignore = "live source: explicit opt-in, not evidence of desktop playback"]
    async fn live_search_episodes_and_hls() {
        let provider = HiAnime::new();
        let result = provider.search(query()).await.unwrap();
        let candidate = result
            .iter()
            .find(|c| c.exact_match)
            .expect("confident Frieren match");
        let roads = provider.episodes(&candidate.id).await.unwrap();
        let sub = roads.iter().find(|r| r.id == "sub").unwrap();
        for episode in sub.episodes.iter().take(2) {
            let sources = provider
                .resolve(PlaybackResolveRequest {
                    candidate_id: candidate.id.clone(),
                    road_id: sub.id.clone(),
                    episode_id: episode.id.clone(),
                })
                .await
                .unwrap();
            let ResolvePlan::Direct { url, subtitles, .. } = &sources[0].plan else {
                panic!("direct only")
            };
            let master = provider
                .client
                .get(url)
                .header("Referer", "https://zokoanime.video/")
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(master.starts_with("#EXTM3U"));
            assert!(!subtitles.is_empty());
            let captions = provider
                .client
                .get(&subtitles[0].url)
                .header("Referer", "https://zokoanime.video/")
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(captions.starts_with("WEBVTT"));
            eprintln!(
                "HiAnime {} / {:?}: HLS + VTT OK",
                candidate.title, episode.episode_number
            );
        }
    }
}
