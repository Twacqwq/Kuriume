use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;

use crate::error::{ProviderError, Result};
use crate::torrent_provider::{
    GroupTorrents, SubtitleGroup, TorrentEntry, TorrentProvider, TorrentSourceEntry,
};

const DMHY_BASE: &str = "https://share.dmhy.org";
const USER_AGENT: &str = "Kuriume/0.1 (https://github.com/Kuriume/Kuriume)";

// ---------------------------------------------------------------------------
// DMHY client
// ---------------------------------------------------------------------------

pub struct Dmhy {
    client: Client,
}

impl Dmhy {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client");
        Self { client }
    }

    /// Search DMHY via RSS and return parsed torrent entries.
    async fn search_rss(&self, keyword: &str) -> Result<Vec<DmhyItem>> {
        // sort_id=2 = Anime category
        let url = format!(
            "{DMHY_BASE}/topics/rss/rss.xml?keyword={}&sort_id=2",
            urlencoding(keyword)
        );
        let xml = self
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| ProviderError::Source(format!("DMHY RSS search failed: {e}")))?
            .text()
            .await?;

        Ok(parse_dmhy_rss(&xml))
    }
}

impl Default for Dmhy {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// TorrentProvider implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl TorrentProvider for Dmhy {
    fn name(&self) -> &str {
        "DMHY"
    }

    /// For DMHY, resolve returns a synthetic entry using the keyword.
    /// DMHY has no bangumi concept — search is keyword-based.
    async fn resolve(
        &self,
        keyword: &str,
        _bgm_id: &str,
    ) -> Result<Option<TorrentSourceEntry>> {
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

    /// Extract unique subtitle groups by parsing `[GroupName]` from titles.
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
            .map(item_to_entry)
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
                .push(item_to_entry(item));
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

// ---------------------------------------------------------------------------
// Internal types & parsing
// ---------------------------------------------------------------------------

struct DmhyItem {
    title: String,
    magnet: String,
    pub_date: String,
}

fn item_to_entry(item: DmhyItem) -> TorrentEntry {
    // Extract info hash from magnet URI for the episode_hash field
    let info_hash = extract_info_hash_from_magnet(&item.magnet);

    TorrentEntry {
        title: item.title,
        episode_hash: info_hash,
        // DMHY <link> is an HTML view page, not a .torrent download — leave empty.
        torrent_url: String::new(),
        magnet: item.magnet,
        size: String::new(), // DMHY RSS does not include size info
        publish_date: item.pub_date,
    }
}

/// Parse DMHY RSS XML into structured items.
fn parse_dmhy_rss(xml: &str) -> Vec<DmhyItem> {
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
            .map(|s| decode_cdata(&decode_html_entities(&s)))
            .unwrap_or_default();

        // <link> is the view page URL (not used — not a torrent download URL)
        let _link = extract_xml_text(item, "link").unwrap_or_default();

        // <enclosure url="magnet:?xt=urn:btih:..."/> — magnet link
        let magnet = extract_attr_value(item, "url")
            .unwrap_or_default()
            .to_string();

        let pub_date = extract_xml_text(item, "pubDate").unwrap_or_default();

        if !magnet.is_empty() {
            items.push(DmhyItem {
                title,
                magnet,
                pub_date,
            });
        }
    }

    items
}

/// Extract the info hash from a magnet URI.
fn extract_info_hash_from_magnet(magnet: &str) -> String {
    // magnet:?xt=urn:btih:HASH&...
    if let Some(start) = magnet.find("btih:") {
        let hash_start = start + 5;
        let hash_end = magnet[hash_start..]
            .find('&')
            .map(|i| hash_start + i)
            .unwrap_or(magnet.len());
        return magnet[hash_start..hash_end].to_string();
    }
    String::new()
}

/// Extract text content between `<tag>` and `</tag>`.
fn extract_xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)?;
    let text = xml[start..start + end].trim();
    Some(text.to_string())
}

/// Extract the value of an HTML/XML attribute.
fn extract_attr_value<'a>(html: &'a str, attr: &str) -> Option<&'a str> {
    let attr_eq = format!("{attr}=\"");
    if let Some(pos) = html.find(&attr_eq) {
        let start = pos + attr_eq.len();
        let end = html[start..].find('"')?;
        return Some(&html[start..start + end]);
    }
    None
}

/// Extract the first `[GroupName]` from a torrent title.
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

/// Strip CDATA wrapper if present.
fn decode_cdata(s: &str) -> String {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("<![CDATA[") {
        if let Some(inner) = inner.strip_suffix("]]>") {
            return inner.trim().to_string();
        }
    }
    s.to_string()
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
