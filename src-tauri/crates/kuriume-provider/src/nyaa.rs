use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;

use crate::error::{ProviderError, Result};
use crate::torrent_provider::{
    GroupTorrents, SubtitleGroup, TorrentEntry, TorrentProvider, TorrentSourceEntry,
};

const NYAA_BASE: &str = "https://nyaa.si";
const USER_AGENT: &str = "Kuriume/0.1 (https://github.com/Kuriume/Kuriume)";

/// Default trackers for constructing magnet URIs.
const DEFAULT_TRACKERS: &[&str] = &[
    "http://nyaa.tracker.wf:7777/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
];

// ---------------------------------------------------------------------------
// Nyaa client
// ---------------------------------------------------------------------------

pub struct Nyaa {
    client: Client,
    trackers: Vec<String>,
}

impl Nyaa {
    pub fn new(custom_trackers: Vec<String>) -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client");
        let trackers = if custom_trackers.is_empty() {
            DEFAULT_TRACKERS.iter().map(|s| s.to_string()).collect()
        } else {
            custom_trackers
        };
        Self { client, trackers }
    }

    /// Search Nyaa via RSS and return parsed torrent entries.
    async fn search_rss(&self, keyword: &str) -> Result<Vec<NyaaItem>> {
        // c=1_0 = Anime - All, f=0 = No filter
        let url = format!("{NYAA_BASE}/?page=rss&q={}&c=1_0&f=0", urlencoding(keyword));
        let xml = self
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| ProviderError::Source(format!("Nyaa RSS search failed: {e}")))?
            .text()
            .await?;

        Ok(parse_nyaa_rss(&xml))
    }
}

impl Default for Nyaa {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// TorrentProvider implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl TorrentProvider for Nyaa {
    fn name(&self) -> &str {
        "Nyaa"
    }

    /// For Nyaa, resolve simply returns a synthetic entry using the keyword.
    /// Nyaa has no concept of bangumi IDs, so `anime_id` = the search keyword.
    async fn resolve(
        &self,
        keyword: &str,
        _bgm_id: &str,
    ) -> Result<Option<TorrentSourceEntry>> {
        // Verify the keyword returns results
        let items = self.search_rss(keyword).await?;
        if items.is_empty() {
            return Ok(None);
        }
        Ok(Some(TorrentSourceEntry {
            provider_id: keyword.to_string(),
            title: keyword.to_string(),
            cover: None,
            bgm_id: None,
        }))
    }

    /// Extract unique subtitle groups from search results by parsing `[GroupName]` from titles.
    async fn get_groups(&self, anime_id: &str) -> Result<Vec<SubtitleGroup>> {
        let items = self.search_rss(anime_id).await?;
        let mut seen = HashMap::new();
        for item in &items {
            let group_name = extract_group_from_title(&item.title);
            seen.entry(group_name.clone())
                .or_insert_with(|| SubtitleGroup {
                    id: group_name.clone(),
                    name: group_name,
                });
        }
        let mut groups: Vec<SubtitleGroup> = seen.into_values().collect();
        groups.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(groups)
    }

    /// Get torrents for a specific group (filter by `[GroupName]` in title).
    async fn get_group_torrents(
        &self,
        anime_id: &str,
        group_id: &str,
    ) -> Result<Vec<TorrentEntry>> {
        let items = self.search_rss(anime_id).await?;
        let entries = items
            .into_iter()
            .filter(|item| extract_group_from_title(&item.title) == group_id)
            .map(|item| self.item_to_entry(item))
            .collect();
        Ok(entries)
    }

    /// Override to fetch once and group all results together.
    async fn get_all_torrents(&self, anime_id: &str) -> Result<Vec<GroupTorrents>> {
        let items = self.search_rss(anime_id).await?;

        let mut groups_map: HashMap<String, Vec<TorrentEntry>> = HashMap::new();
        for item in items {
            let group_name = extract_group_from_title(&item.title);
            groups_map
                .entry(group_name)
                .or_default()
                .push(self.item_to_entry(item));
        }

        let mut result: Vec<GroupTorrents> = groups_map
            .into_iter()
            .map(|(name, torrents)| GroupTorrents {
                group: SubtitleGroup {
                    id: name.clone(),
                    name,
                },
                torrents,
            })
            .collect();
        result.sort_by(|a, b| a.group.name.cmp(&b.group.name));
        Ok(result)
    }
}

impl Nyaa {
    fn item_to_entry(&self, item: NyaaItem) -> TorrentEntry {
        let magnet = if !item.info_hash.is_empty() {
            let mut m = format!("magnet:?xt=urn:btih:{}", item.info_hash);
            for tracker in &self.trackers {
                m.push_str("&tr=");
                m.push_str(tracker);
            }
            m
        } else {
            String::new()
        };

        TorrentEntry {
            title: item.title,
            episode_hash: item.info_hash,
            torrent_url: item.torrent_url,
            magnet,
            size: item.size,
            publish_date: item.pub_date,
        }
    }
}

// ---------------------------------------------------------------------------
// Internal types & parsing
// ---------------------------------------------------------------------------

struct NyaaItem {
    title: String,
    torrent_url: String,
    info_hash: String,
    size: String,
    pub_date: String,
}

/// Parse Nyaa RSS XML into structured items.
fn parse_nyaa_rss(xml: &str) -> Vec<NyaaItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while let Some(item_start) = xml[pos..].find("<item>") {
        let abs_start = pos + item_start;
        let item_end = xml[abs_start..]
            .find("</item>")
            .map(|i| abs_start + i + 7)
            .unwrap_or(xml.len());
        let item = &xml[abs_start..item_end];
        pos = item_end;

        let title = extract_xml_text(item, "title")
            .map(|s| decode_html_entities(&s))
            .unwrap_or_default();

        // <link> is the .torrent download URL
        let torrent_url = extract_xml_text(item, "link").unwrap_or_default();

        // <nyaa:infoHash>
        let info_hash = extract_nyaa_field(item, "infoHash").unwrap_or_default();

        // <nyaa:size> — already human-readable
        let size = extract_nyaa_field(item, "size").unwrap_or_default();

        let pub_date = extract_xml_text(item, "pubDate").unwrap_or_default();

        if !info_hash.is_empty() {
            items.push(NyaaItem {
                title,
                torrent_url,
                info_hash,
                size,
                pub_date,
            });
        }
    }

    items
}

/// Extract text from `<nyaa:field>...</nyaa:field>`.
fn extract_nyaa_field(xml: &str, field: &str) -> Option<String> {
    let open = format!("<nyaa:{field}>");
    let close = format!("</nyaa:{field}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)?;
    Some(xml[start..start + end].trim().to_string())
}

/// Extract text content between `<tag>` and `</tag>`.
fn extract_xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)?;
    Some(xml[start..start + end].trim().to_string())
}

/// Extract the first `[GroupName]` from a torrent title.
/// Falls back to "Unknown" if no brackets found.
fn extract_group_from_title(title: &str) -> String {
    if let Some(start) = title.find('[') {
        if let Some(end) = title[start..].find(']') {
            let group = &title[start + 1..start + end];
            if !group.is_empty() {
                return group.to_string();
            }
        }
    }
    "Unknown".to_string()
}

/// Decode common HTML entities.
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
}

/// Simple URL-encoding for query parameters.
fn urlencoding(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => result.push(ch),
            ' ' => result.push('+'),
            _ => {
                let mut buf = [0u8; 4];
                let encoded = ch.encode_utf8(&mut buf);
                for b in encoded.bytes() {
                    result.push('%');
                    result.push_str(&format!("{b:02X}"));
                }
            }
        }
    }
    result
}
