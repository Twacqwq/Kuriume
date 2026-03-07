use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::error::{ProviderError, Result};
use crate::models::{AnimeInfo, GetListQuery, PagedResult, SearchQuery};
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

        let parsed_resp: GetBangumiListResponse = resp.json().await?;
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
}

#[derive(Debug, Deserialize)]
struct BangumiSubject {
    id: u64,
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    score: Option<f64>,
    images: Option<BangumiImages>,
    meta_tags: Option<Vec<String>>,
    total_episodes: u32,
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

        Self {
            id: value.id.to_string(),
            title: value.name,
            title_cn,
            cover,
            score: value.score,
            year,
            total_episodes: value.total_episodes,
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

#[derive(Deserialize)]
struct GetBangumiListResponse {
    total: u64,
    limit: u32,
    offset: u32,
    data: Option<Vec<BangumiSubject>>,
}
