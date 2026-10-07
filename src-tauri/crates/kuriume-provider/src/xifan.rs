//! Anonymous endpoints used by Xifan Next's public web player.
use crate::{playback_matching, source_http as http};
use crate::{
    PlaybackCandidate, PlaybackEpisode, PlaybackHeaders, PlaybackProvider,
    PlaybackProviderCapabilities, PlaybackProviderDescriptor, PlaybackResolveRequest, PlaybackRoad,
    PlaybackSearch, PlaybackSource, ProviderError, ResolvePlan, Result,
};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const API: &str = "https://api.xifanacg.com";
// Public publishable project key, shipped by the website (not a user/API secret).
// No Authorization header, account, login session, or user-entered configuration.
const PUBLIC_KEY: &str = "sb_publishable_OBIVAWACIX6lPXrO98_z24_HcsmalkA";
const MEDIA_HOSTS: &[&str] = &[
    "apn.moedot.net",
    "hydownload.pan.wo.cn",
    "play.xfvod.pro",
    "dl.playxf.top",
];

pub struct Xifan {
    client: Client,
    descriptor: PlaybackProviderDescriptor,
}
impl Default for Xifan {
    fn default() -> Self {
        Self::new()
    }
}
impl Xifan {
    pub fn new() -> Self {
        Self {
            client: http::client(),
            descriptor: PlaybackProviderDescriptor {
                id: "builtin:xifan".into(),
                display_name: "稀饭 Next".into(),
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
    async fn api(&self, path: &str, body: Value) -> Result<Value> {
        let response = self
            .client
            .post(format!("{API}/{path}"))
            .header("apikey", PUBLIC_KEY)
            .header("Origin", "https://next.xifanacg.com")
            .json(&body)
            .send()
            .await?;
        Ok(serde_json::from_str(&http::text(response).await?)?)
    }
}

#[async_trait]
impl PlaybackProvider for Xifan {
    fn descriptor(&self) -> &PlaybackProviderDescriptor {
        &self.descriptor
    }
    async fn search(&self, query: PlaybackSearch) -> Result<Vec<PlaybackCandidate>> {
        let titles: Vec<_> = std::iter::once(query.query.as_str())
            .chain(query.alternative_titles.iter().map(String::as_str))
            .collect();
        let mut found = BTreeMap::new();
        for term in playback_matching::search_terms(&titles).into_iter().take(4) {
            let results = self
                .api(
                    "rest/v1/rpc/search_animes",
                    json!({"search_term":term,"page_number":1,"items_per_page":24}),
                )
                .await?;
            let rows = results
                .as_array()
                .ok_or_else(|| ProviderError::Parse("Unexpected Xifan search response".into()))?;
            for row in rows {
                let (Some(id), Some(title)) = (row["id"].as_u64(), row["title"].as_str()) else {
                    continue;
                };
                let candidate = PlaybackCandidate {
                    id: format!("xifan:{id}"),
                    title: title.into(),
                    exact_match: false,
                    year: row["release_year"].as_u64().and_then(|y| y.try_into().ok()),
                    episode_count: row["current_episodes"]
                        .as_u64()
                        .and_then(|n| n.try_into().ok()),
                };
                let aliases: Vec<_> = row["aliases"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .chain(row["title_original"].as_str())
                    .map(str::to_owned)
                    .collect();
                let matched = http::rank(&query, candidate, &aliases);
                found.insert(matched.1.id.clone(), matched);
            }
            if found.values().any(|(_, c)| c.exact_match) {
                break;
            }
        }
        Ok(http::ranked(found.into_values().collect(), &query))
    }
    async fn episodes(&self, candidate_id: &str) -> Result<Vec<PlaybackRoad>> {
        let id = http::positive_id(candidate_id, "xifan:")?;
        parse_roads(
            id,
            &self
                .api("rest/v1/rpc/get_anime_detail", json!({"p_id":id}))
                .await?,
        )
    }
    async fn resolve(&self, request: PlaybackResolveRequest) -> Result<Vec<PlaybackSource>> {
        let show = http::positive_id(&request.candidate_id, "xifan:")?;
        let road = http::positive_id(&request.road_id, &format!("xifan:{show}:source:"))?;
        let episode = http::positive_id(&request.episode_id, &format!("xifan:{show}:episode:"))?;
        let roads = self.episodes(&request.candidate_id).await?;
        if !roads.iter().any(|r| {
            r.id == request.road_id && r.episodes.iter().any(|e| e.id == request.episode_id)
        }) {
            return Err(ProviderError::Parse(
                "Xifan episode does not belong to the selected work/line".into(),
            ));
        }
        let value = self
            .api(
                "functions/v1/issue-web-playback",
                json!({"action":"fallback","episode_id":episode,"source_id":road}),
            )
            .await?;
        parse_media(&value, show, episode, road)
    }
}

fn parse_roads(show: u64, value: &Value) -> Result<Vec<PlaybackRoad>> {
    if value["anime"]["id"].as_u64() != Some(show) {
        return Err(ProviderError::NotFound(
            "Xifan work no longer exists".into(),
        ));
    }
    let mut roads = Vec::new();
    for source in value["sources"].as_array().into_iter().flatten().take(20) {
        let (Some(id), Some(name)) = (source["id"].as_u64(), source["name"].as_str()) else {
            continue;
        };
        let mut episodes: Vec<_> = source["episodes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|ep| {
                let id = ep["id"].as_u64()?;
                let number = ep["episode_number"].as_f64()?;
                if id == 0 || !number.is_finite() || number <= 0.0 {
                    return None;
                }
                Some(PlaybackEpisode {
                    id: format!("xifan:{show}:episode:{id}"),
                    label: ep["title"].as_str().unwrap_or_default().into(),
                    episode_number: Some(number),
                })
            })
            .collect();
        episodes.sort_by(|a, b| a.episode_number.partial_cmp(&b.episode_number).unwrap());
        episodes.dedup_by(|a, b| a.id == b.id);
        if !episodes.is_empty() {
            roads.push(PlaybackRoad {
                id: format!("xifan:{show}:source:{id}"),
                label: name.into(),
                episodes,
            });
        }
    }
    if roads.is_empty() {
        return Err(ProviderError::NotFound(
            "Xifan has no released episodes".into(),
        ));
    }
    // The direct xfvod route avoids the cloud-download gateway used by xfxf1,
    // which can reject anonymous range requests even when its page opens.
    roads.sort_by_key(|road| !road.id.ends_with(":source:1"));
    Ok(roads)
}
fn parse_media(value: &Value, show: u64, episode: u64, road: u64) -> Result<Vec<PlaybackSource>> {
    if value["ok"] != true {
        return Err(ProviderError::Source(
            "Xifan anonymous playback unavailable; try another source".into(),
        ));
    }
    if value["anime_id"].as_u64() != Some(show) || value["episode_id"].as_u64() != Some(episode) {
        return Err(ProviderError::Parse(
            "Xifan returned a different episode".into(),
        ));
    }
    let mut sources = Vec::new();
    for item in value["candidates"].as_array().into_iter().flatten().take(8) {
        if item["source_id"].as_u64() != Some(road) {
            continue;
        }
        let Some(raw) = item["url"].as_str() else {
            continue;
        };
        let url = http::scoped_url(raw, MEDIA_HOSTS)?;
        let mime = if url.path().ends_with(".mp4") {
            "video/mp4"
        } else if url.path().ends_with(".m3u8") {
            "application/vnd.apple.mpegurl"
        } else {
            continue;
        };
        sources.push(PlaybackSource {
            name: item["source_name"].as_str().unwrap_or("Xifan").into(),
            plan: ResolvePlan::Direct {
                url: url.into(),
                mime_type: Some(mime.into()),
                subtitles: vec![],
                headers: PlaybackHeaders::from([(
                    "Referer".into(),
                    "https://next.xifanacg.com/".into(),
                )]),
                allowed_hosts: MEDIA_HOSTS.iter().map(|s| s.to_string()).collect(),
            },
        });
    }
    if sources.is_empty() {
        return Err(ProviderError::NotFound(
            "Xifan has no supported anonymous media".into(),
        ));
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_work_line_and_episode_scoped() {
        let value = json!({"anime":{"id":26},"sources":[{"id":4,"name":"主线","episodes":[{"id":20,"episode_number":2,"title":"B"},{"id":10,"episode_number":1,"title":"A"}]}]});
        let roads = parse_roads(26, &value).unwrap();
        assert_eq!(roads[0].episodes[0].id, "xifan:26:episode:10");
        assert!(parse_roads(27, &value).is_err());
        let media = json!({"ok":true,"anime_id":26,"episode_id":10,"candidates":[{"source_id":4,"url":"https://apn.moedot.net/video.mp4"}]});
        assert!(parse_media(&media, 26, 10, 4).is_ok());
        assert!(parse_media(&media, 26, 11, 4).is_err());
        assert!(parse_media(&media, 26, 10, 1).is_err());
        assert!(parse_media(&json!({"ok":false,"error":"unauthorized"}), 26, 10, 4).is_err());
        let mut evil = media;
        evil["candidates"][0]["url"] = json!("https://127.0.0.1/private.mp4");
        assert!(parse_media(&evil, 26, 10, 4).is_err());
    }
}
