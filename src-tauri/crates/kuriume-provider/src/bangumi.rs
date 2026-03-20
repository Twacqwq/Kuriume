use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::error::{ProviderError, Result};
use crate::models::{
    AnimeInfo, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery, PagedResult,
    SearchQuery,
};
use crate::provider::AnimeProvider;

const BANGUMI_API: &str = "https://api.bgm.tv";
const USER_AGENT: &str = "Kuriume/0.1 (https://github.com/Twacqwq/Kuriume)";

pub struct Bangumi {
    client: Client,
}

impl Bangumi {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .expect("failed to build HTTP client");
        Self { client }
    }
}

impl Default for Bangumi {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AnimeProvider for Bangumi {
    fn name(&self) -> &str {
        "Bangumi"
    }

    async fn search(&self, _: SearchQuery) -> Result<PagedResult<AnimeInfo>> {
        Ok(PagedResult {
            data: Vec::new(),
            total: 0,
            limit: 0,
            offset: 0,
        })
    }

    async fn get_detail(&self, id: &str) -> Result<AnimeInfo> {
        let url = format!("{BANGUMI_API}/v0/subjects/{id}");

        let resp = self.client.get(&url).send().await?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(ProviderError::NotFound(format!("Subject {id} not found")));
        }
        if !resp.status().is_success() {
            return Err(ProviderError::Source(format!(
                "Failed to request Bangumi {} API returned {}",
                &url,
                resp.status()
            )));
        }

        let subject: BangumiSubject = resp.json().await?;
        Ok(subject.into())
    }

    async fn get_list(&self, query: GetListQuery) -> Result<PagedResult<AnimeInfo>> {
        let url = format!("{BANGUMI_API}/v0/subjects");

        let mut req = self.client.get(&url).query(&[
            ("type", query.typ),
            ("limit", query.limit),
            ("offset", query.offset),
        ]);
        if let Some(soft_by) = query.soft.filter(|s| !s.as_str().is_empty()) {
            req = req.query(&[("sort", soft_by.as_str())]);
        }
        if let Some(year) = query.year.filter(|&y| y > 0) {
            req = req.query(&[("year", year)]);
        }
        if let Some(month) = query.month.filter(|&m| m > 0) {
            req = req.query(&[("month", month)]);
        }

        let resp = req.send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Source(format!(
                "Failed to request Bangumi {} API returned {}",
                &url,
                resp.status()
            )));
        }

        let parsed_resp: GetBangumiListResponse<BangumiSubject> = resp.json().await?;
        Ok(PagedResult {
            data: parsed_resp
                .data
                .unwrap_or_default()
                .into_iter()
                .map(AnimeInfo::from)
                .collect(),
            total: parsed_resp.total,
            limit: parsed_resp.limit,
            offset: parsed_resp.offset,
        })
    }

    async fn get_episodes(&self, query: GetEpisodesQuery) -> Result<Vec<EpisodesInfo>> {
        let url = format!("{BANGUMI_API}/v0/episodes");

        let resp = self
            .client
            .get(&url)
            .query(&[("subject_id", query.id)])
            .query(&[("offset", query.offset), ("limit", query.limit)])
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Source(format!(
                "Failed to request Bangumi {} API returned {}",
                &url,
                resp.status()
            )));
        }

        let parsed_resp: GetBangumiListResponse<BangumiEposodes> = resp.json().await?;
        Ok(parsed_resp
            .data
            .unwrap_or_default()
            .into_iter()
            .map(EpisodesInfo::from)
            .collect())
    }

    async fn get_characters(&self, id: &str) -> Result<Vec<CharacterInfo>> {
        let url = format!("{BANGUMI_API}/v0/subjects/{id}/characters");

        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Source(format!(
                "Failed to request Bangumi {} API returned {}",
                &url,
                resp.status()
            )));
        }

        let parsed_resp: Vec<BangumiCharacters> = resp.json().await?;
        Ok(parsed_resp.into_iter().map(CharacterInfo::from).collect())
    }
}

#[derive(Debug, Deserialize)]
struct BangumiSubject {
    id: u64,
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    rating: Rating,
    images: Option<BangumiImages>,
    meta_tags: Option<Vec<String>>,
    total_episodes: u32,
    eps: u32,
}

impl From<BangumiSubject> for AnimeInfo {
    fn from(value: BangumiSubject) -> Self {
        let title_cn = value
            .name_cn
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| value.name.clone());

        let cover = value
            .images
            .and_then(|img| img.large.or(img.common).or(img.medium));

        let year = value
            .date
            .as_deref()
            .and_then(|d| d.split('-').next())
            .and_then(|y| y.parse::<u16>().ok());

        let total_episodes = std::cmp::max(value.total_episodes, value.eps);

        Self {
            id: value.id.to_string(),
            title: value.name,
            title_cn,
            cover,
            score: value.rating.score,
            year,
            total_episodes,
            air_date: value.date,
            genres: value.meta_tags.unwrap(),
            description: value.summary,
        }
    }
}

#[derive(Debug, Deserialize)]
struct BangumiImages {
    large: Option<String>,
    common: Option<String>,
    medium: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Rating {
    score: Option<f64>,
}

#[derive(Deserialize)]
struct GetBangumiListResponse<T> {
    total: u64,
    limit: u32,
    offset: u32,
    data: Option<Vec<T>>,
}

#[derive(Debug, Deserialize)]
struct BangumiEposodes {
    id: u64,
    airdate: Option<String>,
    name: Option<String>,
    name_cn: Option<String>,
    duration: Option<String>,
    desc: Option<String>,
    ep: u32,
}

impl From<BangumiEposodes> for EpisodesInfo {
    fn from(value: BangumiEposodes) -> Self {
        Self {
            id: value.id.to_string(),
            ep: value.ep,
            airdate: value.airdate,
            title: value.name,
            title_cn: value.name_cn,
            summary: value.desc,
            duration: value.duration,
            thumbnail: Some("".to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct Actor {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BangumiCharacters {
    id: u64,
    images: Option<BangumiImages>,
    relation: Option<String>,
    name: Option<String>,
    actors: Option<Vec<Actor>>,
}

impl From<BangumiCharacters> for CharacterInfo {
    fn from(value: BangumiCharacters) -> Self {
        let avatar = value
            .images
            .and_then(|img| img.large.or(img.common).or(img.medium));

        Self {
            id: value.id,
            name: value.name,
            role: value.relation,
            avatar,
            cvs: value
                .actors
                .unwrap_or_default()
                .into_iter()
                .map(|c| c.name)
                .collect(),
        }
    }
}
