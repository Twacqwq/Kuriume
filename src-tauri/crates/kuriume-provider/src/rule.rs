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
use serde::{Deserialize, Deserializer, Serialize};

use crate::{ProviderError, Result};

// ── Rule model ───────────────────────────────────────────────────

/// A rule describes how to scrape one online anime streaming site.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    /// Stable machine identifier. Built-in rules use the `builtin:*` namespace;
    /// imported legacy rules receive a deterministic `custom:*` identifier.
    pub id: String,
    /// Schema revision for the JSON rule document.
    pub schema_version: u32,
    /// Display name (e.g. "giriGiriLove").
    pub name: String,
    /// Rule protocol revision chosen by the rule author.
    #[serde(default)]
    pub version: String,
    /// Attribution for the rule definition (not the indexed website).
    #[serde(default)]
    pub author: Option<String>,
    /// License of the rule definition when it is redistributed.
    #[serde(default)]
    pub license: Option<String>,
    /// Project or attribution page for the rule definition.
    #[serde(default)]
    pub homepage: Option<String>,
    /// Site root URL (e.g. "https://anime.girigirilove.top").
    pub base_url: String,
    /// Search URL template. `{keyword}` is replaced with the query.
    pub search_url: String,
    /// Custom User-Agent (optional; random UA if empty).
    #[serde(default)]
    pub user_agent: String,
    /// How an episode page becomes a playable asset.
    #[serde(default)]
    pub resolver: RuleResolver,
    /// Extra hosts the background resolver is allowed to navigate to.
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    /// Selectors for parsing HTML.
    pub selectors: RuleSelectors,
}

impl Rule {
    /// Current JSON schema revision for declarative rules.
    pub const CURRENT_SCHEMA_VERSION: u32 = 1;

    /// Fill the identity fields for rules constructed by older callers.
    ///
    /// Deserialization already performs this migration automatically. This
    /// method is useful for callers that construct [`Rule`] values directly.
    pub fn ensure_identity(&mut self) {
        if self.id.trim().is_empty() {
            self.id = legacy_rule_id(&self.name, &self.base_url);
        }
        if self.schema_version == 0 {
            self.schema_version = Self::CURRENT_SCHEMA_VERSION;
        }
    }

    /// Validate the declarative parts of an imported rule before it reaches
    /// the network layer. Network destinations are validated by the app,
    /// which owns the desktop security boundary.
    pub fn validate_structure(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(ProviderError::Parse("Rule id is required".into()));
        }
        if self.schema_version == 0 || self.schema_version > Self::CURRENT_SCHEMA_VERSION {
            return Err(ProviderError::Parse(format!(
                "Unsupported rule schema version: {}",
                self.schema_version
            )));
        }
        if self.name.trim().is_empty() {
            return Err(ProviderError::Parse("Rule name is required".into()));
        }
        if !self.search_url.contains("{keyword}") {
            return Err(ProviderError::Parse(
                "Search URL must contain {keyword}".into(),
            ));
        }
        for (name, selector) in [
            ("searchList", &self.selectors.search_list),
            ("searchName", &self.selectors.search_name),
            ("searchLink", &self.selectors.search_link),
            ("episodeRoad", &self.selectors.episode_road),
            ("episodeItem", &self.selectors.episode_item),
        ] {
            if selector.trim().is_empty() {
                return Err(ProviderError::Parse(format!("Selector {name} is required")));
            }
            parse_selector(selector)?;
        }
        if !self.selectors.road_name.trim().is_empty() {
            parse_selector(&self.selectors.road_name)?;
        }
        Ok(())
    }
}

/// Deserialization shape kept separate so legacy rule documents can omit the
/// identity fields without weakening the public [`Rule`] model.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleDocument {
    #[serde(default)]
    id: String,
    #[serde(default = "current_rule_schema_version")]
    schema_version: u32,
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    base_url: String,
    search_url: String,
    #[serde(default)]
    user_agent: String,
    #[serde(default)]
    resolver: RuleResolver,
    #[serde(default)]
    allowed_hosts: Vec<String>,
    selectors: RuleSelectors,
}

impl<'de> Deserialize<'de> for Rule {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let document = RuleDocument::deserialize(deserializer)?;
        let mut rule = Self {
            id: document.id,
            schema_version: document.schema_version,
            name: document.name,
            version: document.version,
            author: document.author,
            license: document.license,
            homepage: document.homepage,
            base_url: document.base_url,
            search_url: document.search_url,
            user_agent: document.user_agent,
            resolver: document.resolver,
            allowed_hosts: document.allowed_hosts,
            selectors: document.selectors,
        };
        rule.ensure_identity();
        Ok(rule)
    }
}

fn current_rule_schema_version() -> u32 {
    Rule::CURRENT_SCHEMA_VERSION
}

/// Deterministic FNV-1a identity for legacy rules. The source string is
/// normalized so harmless whitespace/case changes do not create a new source.
fn legacy_rule_id(name: &str, base_url: &str) -> String {
    let identity = format!(
        "{}|{}",
        name.trim().to_ascii_lowercase(),
        base_url.trim().trim_end_matches('/').to_ascii_lowercase()
    );
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in identity.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("custom:{hash:016x}")
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuleResolver {
    /// Resolve a direct media URL in a temporary, capability-free WebView.
    #[default]
    Direct,
    /// Legacy rule value, now treated as background extraction too.
    /// The app never renders a provider-controlled foreground player.
    Embed,
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
            .redirect(reqwest::redirect::Policy::none())
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
        let url = self
            .rule
            .search_url
            .replace("{keyword}", &encode_query_component(keyword));
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

                let href = item_el.value().attr("href").unwrap_or_default().to_string();

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
            HeaderValue::from_str(&format!("{}/", self.rule.base_url))
                .unwrap_or(HeaderValue::from_static("")),
        );
        headers.insert(
            ACCEPT_LANGUAGE,
            HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
        );
        headers.insert(CONNECTION, HeaderValue::from_static("keep-alive"));

        let resp = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        let mut resp = resp
            .error_for_status()
            .map_err(|e| ProviderError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(ProviderError::Source(
                "Source page redirected unexpectedly".into(),
            ));
        }
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await? {
            if body.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(ProviderError::Parse("Source page is too large".into()));
            }
            body.extend_from_slice(&chunk);
        }
        String::from_utf8(body).map_err(|_| ProviderError::Parse("Source page is not UTF-8".into()))
    }

    /// Turn a possibly-relative URL into an absolute one.
    fn resolve_url(&self, href: &str) -> String {
        let Ok(base) = reqwest::Url::parse(&self.rule.base_url) else {
            return href.into();
        };
        let Ok(mut url) = base.join(href) else {
            return href.into();
        };
        // AGE currently publishes absolute HTTP links on its HTTPS search page.
        // Only normalize that same site's standard port, never arbitrary hosts.
        if base.scheme() == "https"
            && url.scheme() == "http"
            && url.host_str() == base.host_str()
            && url.port_or_known_default() == Some(80)
        {
            let _ = url.set_scheme("https");
            let _ = url.set_port(None);
        }
        url.into()
    }
}

fn parse_selector(s: &str) -> Result<Selector> {
    Selector::parse(s).map_err(|e| ProviderError::Parse(format!("Invalid CSS selector '{s}': {e}")))
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_rule() -> Rule {
        Rule {
            id: "custom:test".into(),
            schema_version: Rule::CURRENT_SCHEMA_VERSION,
            name: "test".into(),
            version: "1".into(),
            author: None,
            license: None,
            homepage: None,
            base_url: "https://example.com".into(),
            search_url: "https://example.com/search?wd={keyword}".into(),
            user_agent: String::new(),
            resolver: RuleResolver::Direct,
            allowed_hosts: vec!["example.com".into()],
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
    fn same_site_legacy_http_links_use_the_declared_https_origin() {
        let engine = RuleEngine::new(test_rule());
        assert_eq!(
            engine.resolve_url("http://example.com/detail/1"),
            "https://example.com/detail/1"
        );
        assert_eq!(
            engine.resolve_url("//example.com/detail/1"),
            "https://example.com/detail/1"
        );
        assert_eq!(
            engine.resolve_url("http://other.example/detail/1"),
            "http://other.example/detail/1"
        );
        assert_eq!(
            engine.resolve_url("http://example.com:8080/detail/1"),
            "http://example.com:8080/detail/1"
        );
    }

    #[test]
    fn search_keywords_are_encoded_as_one_query_component() {
        assert_eq!(
            encode_query_component("葬送&x=1"),
            "%E8%91%AC%E9%80%81%26x%3D1"
        );
    }

    #[test]
    fn legacy_rule_json_gets_a_stable_identity() {
        let legacy = r#"{
            "name": "Legacy Source",
            "version": "1",
            "baseUrl": "https://example.com/",
            "searchUrl": "https://example.com/search?q={keyword}",
            "selectors": {
                "searchList": ".result",
                "searchName": ".title",
                "searchLink": ".title",
                "episodeRoad": ".road",
                "episodeItem": "a"
            }
        }"#;

        let first: Rule = serde_json::from_str(legacy).unwrap();
        let second: Rule = serde_json::from_str(legacy).unwrap();

        assert!(first.id.starts_with("custom:"));
        assert_eq!(first.id, second.id);
        assert_eq!(first.schema_version, Rule::CURRENT_SCHEMA_VERSION);
        assert_eq!(first.resolver, RuleResolver::Direct);
    }

    #[test]
    fn rule_serialization_uses_schema_version_and_camel_case() {
        let value = serde_json::to_value(test_rule()).unwrap();

        assert_eq!(value["id"], "custom:test");
        assert_eq!(value["schemaVersion"], Rule::CURRENT_SCHEMA_VERSION);
        assert!(value.get("schema_version").is_none());
        assert_eq!(value["allowedHosts"][0], "example.com");
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
            let name = element
                .select(&name_sel)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let href = element
                .select(&link_sel)
                .next()
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
