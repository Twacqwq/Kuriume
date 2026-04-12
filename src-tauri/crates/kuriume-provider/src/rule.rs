//! # Online source rule engine
//!
//! Defines the [`Rule`] model for online anime video sites, and a CSS-selector-based
//! scraping engine to search anime, list episodes, and extract episode page URLs.
//!
//! Rules are small JSON configs — each describes one video site with CSS selectors.
//! The actual video URL extraction (m3u8/mp4) happens on the frontend via WebView
//! request interception; this module only handles the HTML navigation layer.

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT_LANGUAGE, CONNECTION, REFERER};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

use crate::{ProviderError, Result};

// ── Rule model ───────────────────────────────────────────────────

/// A rule describes how to scrape one online anime streaming site.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    /// Display name (e.g. "giriGiriLove").
    pub name: String,
    /// Site root URL (e.g. "https://anime.girigirilove.top").
    pub base_url: String,
    /// Search URL template. `{keyword}` is replaced with the query.
    pub search_url: String,
    /// Custom User-Agent (optional; random UA if empty).
    #[serde(default)]
    pub user_agent: String,
    /// Selectors for parsing HTML.
    pub selectors: RuleSelectors,
}

/// CSS selectors used by the rule engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSelectors {
    /// Selector for each search result item container.
    pub search_list: String,
    /// Selector (relative to each result item) for the anime name text.
    pub search_name: String,
    /// Selector (relative to each result item) for the link `<a href>`.
    pub search_link: String,
    /// Selector for each episode road/playlist group container.
    pub episode_road: String,
    /// Selector (relative to each road) for individual episode `<a>` links.
    pub episode_item: String,
    /// Optional: global selector for road/playlist names (matched by index).
    /// When absent, roads are named "播放列表1", "播放列表2", etc.
    #[serde(default)]
    pub road_name: String,
}

// ── Scraped output types ─────────────────────────────────────────

/// One search result from an online source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlineSearchResult {
    /// Anime name as displayed on the site.
    pub name: String,
    /// Relative or absolute URL to the anime detail/episode list page.
    pub url: String,
}

/// A "road" (playlist variant) containing episode links.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlineRoad {
    /// Human label, e.g. "播放列表1".
    pub name: String,
    /// Episode entries in order.
    pub episodes: Vec<OnlineEpisode>,
}

/// One episode on an online source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlineEpisode {
    /// Display name (e.g. "第01集", or "01").
    pub name: String,
    /// URL of the episode page (to be loaded in WebView for video sniffing).
    pub url: String,
}

// ── Rule engine ──────────────────────────────────────────────────

/// HTTP client + rule config used to scrape sites.
pub struct RuleEngine {
    client: reqwest::Client,
    rule: Rule,
}

impl RuleEngine {
    pub fn new(rule: Rule) -> Self {
        let ua = if rule.user_agent.is_empty() {
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        } else {
            &rule.user_agent
        };

        let client = reqwest::Client::builder()
            .user_agent(ua)
            .use_rustls_tls()
            .timeout(std::time::Duration::from_secs(15))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self { client, rule }
    }

    pub fn rule(&self) -> &Rule {
        &self.rule
    }

    /// Search the site for anime matching `keyword`.
    pub async fn search(&self, keyword: &str) -> Result<Vec<OnlineSearchResult>> {
        let url = self.rule.search_url.replace("{keyword}", keyword);
        let html = self.fetch_html(&url).await?;
        let document = Html::parse_document(&html);

        let list_sel = parse_selector(&self.rule.selectors.search_list)?;
        let name_sel = parse_selector(&self.rule.selectors.search_name)?;
        let link_sel = parse_selector(&self.rule.selectors.search_link)?;

        let mut results = Vec::new();
        for element in document.select(&list_sel) {
            let name = element
                .select(&name_sel)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();

            let href = element
                .select(&link_sel)
                .next()
                .and_then(|el| el.value().attr("href"))
                .unwrap_or_default()
                .to_string();

            if !name.is_empty() && !href.is_empty() {
                results.push(OnlineSearchResult {
                    name,
                    url: self.resolve_url(&href),
                });
            }
        }

        Ok(results)
    }

    /// Fetch the episode list (roads) from an anime detail page.
    pub async fn get_episodes(&self, page_url: &str) -> Result<Vec<OnlineRoad>> {
        let url = self.resolve_url(page_url);
        let html = self.fetch_html(&url).await?;
        let document = Html::parse_document(&html);

        let road_sel = parse_selector(&self.rule.selectors.episode_road)?;
        let item_sel = parse_selector(&self.rule.selectors.episode_item)?;

        // Collect road names from a separate global selector if provided.
        let road_names: Vec<String> = if !self.rule.selectors.road_name.is_empty() {
            let rn_sel = parse_selector(&self.rule.selectors.road_name)?;
            document
                .select(&rn_sel)
                .map(|el| el.text().collect::<String>().trim().to_string())
                .collect()
        } else {
            Vec::new()
        };

        let mut roads = Vec::new();

        for (i, road_el) in document.select(&road_sel).enumerate() {
            let mut episodes = Vec::new();
            for item_el in road_el.select(&item_sel) {
                let name = item_el
                    .text()
                    .collect::<String>()
                    .trim()
                    .replace(|c: char| c.is_whitespace(), "");

                let href = item_el
                    .value()
                    .attr("href")
                    .unwrap_or_default()
                    .to_string();

                if !href.is_empty() {
                    episodes.push(OnlineEpisode {
                        name,
                        url: self.resolve_url(&href),
                    });
                }
            }

            if !episodes.is_empty() {
                let name = road_names
                    .get(i)
                    .filter(|s| !s.is_empty())
                    .cloned()
                    .unwrap_or_else(|| format!("播放列表{}", i + 1));
                roads.push(OnlineRoad { name, episodes });
            }
        }

        Ok(roads)
    }

    // ── Internal helpers ─────────────────────────────────────────

    async fn fetch_html(&self, url: &str) -> Result<String> {
        let mut headers = HeaderMap::new();
        headers.insert(
            REFERER,
            HeaderValue::from_str(&format!("{}/", self.rule.base_url)).unwrap_or(HeaderValue::from_static("")),
        );
        headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"));
        headers.insert(CONNECTION, HeaderValue::from_static("keep-alive"));

        let resp = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        resp.text()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))
    }

    /// Turn a possibly-relative URL into an absolute one.
    fn resolve_url(&self, href: &str) -> String {
        if href.starts_with("http://") || href.starts_with("https://") {
            href.to_string()
        } else {
            format!(
                "{}{}",
                self.rule.base_url.trim_end_matches('/'),
                if href.starts_with('/') { href.to_string() } else { format!("/{href}") }
            )
        }
    }
}

fn parse_selector(s: &str) -> Result<Selector> {
    Selector::parse(s).map_err(|e| ProviderError::Parse(format!("Invalid CSS selector '{s}': {e}")))
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_rule() -> Rule {
        Rule {
            name: "test".into(),
            base_url: "https://example.com".into(),
            search_url: "https://example.com/search?wd={keyword}".into(),
            user_agent: String::new(),
            selectors: RuleSelectors {
                search_list: "div.search-item".into(),
                search_name: "a.title".into(),
                search_link: "a.title".into(),
                episode_road: "ul.playlist".into(),
                episode_item: "li > a".into(),
                road_name: String::new(),
            },
        }
    }

    #[test]
    fn resolve_url_absolute() {
        let engine = RuleEngine::new(test_rule());
        assert_eq!(
            engine.resolve_url("https://other.com/foo"),
            "https://other.com/foo"
        );
    }

    #[test]
    fn resolve_url_relative() {
        let engine = RuleEngine::new(test_rule());
        assert_eq!(
            engine.resolve_url("/anime/123"),
            "https://example.com/anime/123"
        );
    }

    #[test]
    fn resolve_url_no_slash() {
        let engine = RuleEngine::new(test_rule());
        assert_eq!(
            engine.resolve_url("anime/123"),
            "https://example.com/anime/123"
        );
    }

    #[test]
    fn parse_search_results() {
        let rule = test_rule();
        let engine = RuleEngine::new(rule);
        let html = r#"
            <div class="search-item">
                <a class="title" href="/anime/1">Clannad</a>
            </div>
            <div class="search-item">
                <a class="title" href="/anime/2">Frieren</a>
            </div>
        "#;
        let document = Html::parse_document(html);
        let list_sel = Selector::parse("div.search-item").unwrap();
        let name_sel = Selector::parse("a.title").unwrap();
        let link_sel = Selector::parse("a.title").unwrap();

        let mut results = Vec::new();
        for element in document.select(&list_sel) {
            let name = element.select(&name_sel).next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let href = element.select(&link_sel).next()
                .and_then(|el| el.value().attr("href"))
                .unwrap_or_default();
            results.push(OnlineSearchResult {
                name,
                url: engine.resolve_url(href),
            });
        }

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "Clannad");
        assert_eq!(results[0].url, "https://example.com/anime/1");
        assert_eq!(results[1].name, "Frieren");
    }

    #[test]
    fn parse_episode_list() {
        let rule = test_rule();
        let engine = RuleEngine::new(rule);
        let html = r#"
            <ul class="playlist">
                <li><a href="/play/1/1">第01集</a></li>
                <li><a href="/play/1/2">第02集</a></li>
            </ul>
            <ul class="playlist">
                <li><a href="/play2/1/1">第01集</a></li>
            </ul>
        "#;
        let document = Html::parse_document(html);
        let road_sel = Selector::parse("ul.playlist").unwrap();
        let item_sel = Selector::parse("li > a").unwrap();

        let mut roads = Vec::new();
        let mut count = 1;
        for road_el in document.select(&road_sel) {
            let mut episodes = Vec::new();
            for item in road_el.select(&item_sel) {
                let name = item.text().collect::<String>().trim().to_string();
                let href = item.value().attr("href").unwrap_or_default();
                episodes.push(OnlineEpisode {
                    name,
                    url: engine.resolve_url(href),
                });
            }
            if !episodes.is_empty() {
                roads.push(OnlineRoad {
                    name: format!("播放列表{count}"),
                    episodes,
                });
                count += 1;
            }
        }

        assert_eq!(roads.len(), 2);
        assert_eq!(roads[0].episodes.len(), 2);
        assert_eq!(roads[0].episodes[0].name, "第01集");
        assert_eq!(roads[0].episodes[0].url, "https://example.com/play/1/1");
        assert_eq!(roads[1].episodes.len(), 1);
    }
}
