use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::error::{ProviderError, Result};
use crate::models::{AnimeInfo, PagedResult, SearchQuery};
use crate::provider::AnimeProvider;

const BANGUMI_API: &str = "https://api.bgm.tv";
const USER_AGENT: &str = "Kuriume/0.1 (https://github.com/Kuriume)";

/// Bangumi (bangumi.tv / bgm.tv) 数据源
pub struct BangumiProvider {
    client: Client,
}

// ── Bangumi API 响应结构 ──────────────────────────────────

#[derive(Debug, Deserialize)]
struct BangumiSearchResponse {
    total: u32,
    data: Option<Vec<BangumiSubject>>,
}

#[derive(Debug, Deserialize)]
struct BangumiSubject {
    id: u64,
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    score: Option<f64>,
    eps: Option<u32>,
    images: Option<BangumiImages>,
    tags: Option<Vec<BangumiTag>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // API 响应字段，按需使用
struct BangumiImages {
    large: Option<String>,
    common: Option<String>,
    medium: Option<String>,
    small: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BangumiTag {
    name: String,
}

// ── 转换逻辑 ──────────────────────────────────────────────

impl BangumiSubject {
    fn into_anime_info(self) -> AnimeInfo {
        let title = self
            .name_cn
            .filter(|s| !s.is_empty())
            .unwrap_or(self.name);

        let cover = self
            .images
            .and_then(|img| img.large.or(img.common).or(img.medium));

        let year = self
            .date
            .as_deref()
            .and_then(|d| d.split('-').next())
            .and_then(|y| y.parse::<u16>().ok());

        let genres = self
            .tags
            .unwrap_or_default()
            .into_iter()
            .take(5)
            .map(|t| t.name)
            .collect();

        AnimeInfo {
            id: self.id.to_string(),
            title,
            cover,
            score: self.score,
            year,
            episodes: self.eps,
            genres,
            description: self.summary,
        }
    }
}

// ── Provider 实现 ─────────────────────────────────────────

impl BangumiProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .expect("failed to build HTTP client");
        Self { client }
    }
}

impl Default for BangumiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AnimeProvider for BangumiProvider {
    fn name(&self) -> &str {
        "bangumi"
    }

    async fn search(&self, query: SearchQuery) -> Result<PagedResult<AnimeInfo>> {
        let url = format!("{BANGUMI_API}/v0/search/subjects");

        let body = serde_json::json!({
            "keyword": query.keyword,
            "filter": {
                "type": [2]  // type 2 = 动画
            }
        });

        let resp = self
            .client
            .post(&url)
            .query(&[
                ("offset", query.offset.to_string()),
                ("limit", query.limit.to_string()),
            ])
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(ProviderError::Source(format!(
                "Bangumi API 返回 {}",
                resp.status()
            )));
        }

        let search_resp: BangumiSearchResponse = resp.json().await?;

        let data = search_resp
            .data
            .unwrap_or_default()
            .into_iter()
            .map(BangumiSubject::into_anime_info)
            .collect();

        Ok(PagedResult {
            data,
            total: search_resp.total,
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
                "Bangumi API 返回 {}",
                resp.status()
            )));
        }

        let subject: BangumiSubject = resp.json().await?;
        Ok(subject.into_anime_info())
    }

    async fn get_trending(&self, limit: u32) -> Result<Vec<AnimeInfo>> {
        // Bangumi 没有直接的 trending API，用「排行榜」接口代替
        let url = format!("{BANGUMI_API}/v0/search/subjects");

        let body = serde_json::json!({
            "keyword": "",
            "sort": "rank",
            "filter": {
                "type": [2]  // 动画
            }
        });

        let resp = self
            .client
            .post(&url)
            .query(&[
                ("offset", "0".to_string()),
                ("limit", limit.to_string()),
            ])
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(ProviderError::Source(format!(
                "Bangumi API 返回 {}",
                resp.status()
            )));
        }

        let search_resp: BangumiSearchResponse = resp.json().await?;

        Ok(search_resp
            .data
            .unwrap_or_default()
            .into_iter()
            .map(BangumiSubject::into_anime_info)
            .collect())
    }
}
