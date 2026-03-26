use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;

use crate::error::{ProviderError, Result};

const MIKAN_BASE: &str = "https://mikanani.me";
const USER_AGENT: &str = "Kuriume/0.1 (https://github.com/Kuriume/Kuriume)";

/// Default tracker list for constructing magnet URIs (sourced from Mikan pages).
const DEFAULT_TRACKERS: &[&str] = &[
    "http://t.nyaatracker.com/announce",
    "http://tracker.kamigami.org:2710/announce",
    "http://share.camoe.cn:8080/announce",
    "http://opentracker.acgnx.se/announce",
    "http://anidex.moe:6969/announce",
    "http://t.acg.rip:6699/announce",
    "https://tr.bangumi.moe:9696/announce",
    "http://tr.bangumi.moe:6969/announce",
    "http://open.acgtracker.com:1096/announce",
    "https://tracker.opentrackr.org:1337/announce",
];

// Re-export trait types so existing consumers can keep importing from here.
pub use crate::torrent_provider::{
    GroupTorrents, SubtitleGroup, TorrentEntry, TorrentProvider, TorrentSourceEntry,
};

// ---------------------------------------------------------------------------
// Mikan client
// ---------------------------------------------------------------------------

pub struct Mikan {
    client: Client,
    /// Effective tracker list for magnet URI construction.
    trackers: Vec<String>,
}

impl Mikan {
    /// Create a new Mikan client. If `custom_trackers` is empty, built-in defaults are used.
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

    // -- Search ---------------------------------------------------------------

    /// Search Mikan by keyword and return candidate anime entries.
    pub async fn search_bangumi(&self, keyword: &str) -> Result<Vec<TorrentSourceEntry>> {
        let url = format!("{MIKAN_BASE}/Home/Search");
        let html = self
            .client
            .get(&url)
            .query(&[("searchstr", keyword)])
            .send()
            .await?
            .error_for_status()
            .map_err(|e| ProviderError::Source(format!("Mikan search failed: {e}")))?
            .text()
            .await?;

        Ok(parse_search_results(&html))
    }

    // -- BGM ID resolution ----------------------------------------------------

    /// Fetch the Mikan bangumi page and extract the bgm.tv subject ID.
    pub async fn resolve_bgm_id(&self, mikan_id: &str) -> Result<Option<String>> {
        let html = self.fetch_bangumi_page(mikan_id).await?;
        Ok(extract_bgm_id(&html))
    }

    /// Search Mikan and find the entry whose bgm.tv subject ID matches.
    pub async fn find_mikan_id_by_bgm(
        self: &Arc<Self>,
        keyword: &str,
        bgm_subject_id: &str,
    ) -> Result<Option<TorrentSourceEntry>> {
        let candidates = self.search_bangumi(keyword).await?;

        let mut set = tokio::task::JoinSet::new();
        for (i, candidate) in candidates.into_iter().enumerate() {
            let this = Arc::clone(self);
            let mid = candidate.provider_id.clone();
            set.spawn(async move {
                let bgm_id = this.resolve_bgm_id(&mid).await?;
                Ok::<_, ProviderError>((i, candidate, bgm_id))
            });
        }

        let mut matches = Vec::new();
        while let Some(res) = set.join_next().await {
            let (i, mut candidate, bgm_id) = res
                .map_err(|e| ProviderError::Source(format!("task join error: {e}")))??;
            if let Some(ref id) = bgm_id {
                if id == bgm_subject_id {
                    candidate.bgm_id = bgm_id;
                    matches.push((i, candidate));
                }
            }
        }

        // Return the match with the lowest original index (first in search results)
        matches.sort_by_key(|(i, _)| *i);
        Ok(matches.into_iter().next().map(|(_, c)| c))
    }

    // -- Subtitle groups ------------------------------------------------------

    /// List all subtitle groups for a bangumi.
    pub async fn get_subtitle_groups(&self, mikan_id: &str) -> Result<Vec<SubtitleGroup>> {
        let html = self.fetch_bangumi_page(mikan_id).await?;
        Ok(parse_subtitle_groups(&html))
    }

    // -- Torrents -------------------------------------------------------------

    /// Get torrent entries for a specific subgroup of a bangumi via RSS.
    pub async fn get_subgroup_torrents(
        &self,
        mikan_id: &str,
        subgroup_id: &str,
    ) -> Result<Vec<TorrentEntry>> {
        let url = format!("{MIKAN_BASE}/RSS/Bangumi");
        let xml = self
            .client
            .get(&url)
            .query(&[
                ("bangumiId", mikan_id),
                ("subgroupid", subgroup_id),
            ])
            .send()
            .await?
            .error_for_status()
            .map_err(|e| {
                ProviderError::Source(format!(
                    "Mikan RSS failed for bangumi {mikan_id} subgroup {subgroup_id}: {e}"
                ))
            })?
            .text()
            .await?;

        Ok(parse_rss_items(&xml, &self.trackers))
    }

    /// Get all subtitle groups and their torrent entries for a bangumi.
    pub async fn get_all_torrents_concurrent(self: &Arc<Self>, mikan_id: &str) -> Result<Vec<GroupTorrents>> {
        let groups = self.get_subtitle_groups(mikan_id).await?;

        let mut set = tokio::task::JoinSet::new();
        for group in groups {
            let this = Arc::clone(self);
            let mid = mikan_id.to_owned();
            set.spawn(async move {
                let torrents = this.get_subgroup_torrents(&mid, &group.id).await?;
                Ok::<_, ProviderError>(GroupTorrents { group, torrents })
            });
        }

        let mut result = Vec::with_capacity(set.len());
        while let Some(res) = set.join_next().await {
            result.push(res.map_err(|e| ProviderError::Source(format!("task join error: {e}")))??)
        }

        Ok(result)
    }

    // -- Internal helpers -----------------------------------------------------

    async fn fetch_bangumi_page(&self, mikan_id: &str) -> Result<String> {
        let url = format!("{MIKAN_BASE}/Home/Bangumi/{mikan_id}");
        self.client
            .get(&url)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| {
                ProviderError::Source(format!("Mikan bangumi page {mikan_id} failed: {e}"))
            })?
            .text()
            .await
            .map_err(Into::into)
    }
}

impl Default for Mikan {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// TorrentProvider implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl TorrentProvider for Mikan {
    fn name(&self) -> &str {
        "Mikan"
    }

    async fn resolve(
        &self,
        keyword: &str,
        bgm_id: &str,
    ) -> Result<Option<TorrentSourceEntry>> {
        let candidates = self.search_bangumi(keyword).await?;

        // Sequential resolve — fine for the small number of search results
        for mut candidate in candidates {
            let resolved_bgm = self.resolve_bgm_id(&candidate.provider_id).await?;
            if let Some(ref id) = resolved_bgm {
                if id == bgm_id {
                    candidate.bgm_id = resolved_bgm;
                    return Ok(Some(candidate));
                }
            }
        }
        Ok(None)
    }

    async fn get_groups(&self, anime_id: &str) -> Result<Vec<SubtitleGroup>> {
        self.get_subtitle_groups(anime_id).await
    }

    async fn get_group_torrents(
        &self,
        anime_id: &str,
        group_id: &str,
    ) -> Result<Vec<TorrentEntry>> {
        self.get_subgroup_torrents(anime_id, group_id).await
    }
}

// ---------------------------------------------------------------------------
// HTML parsing helpers (no external dependency — pure string parsing)
// ---------------------------------------------------------------------------

/// Parse Mikan search HTML for anime bangumi cards.
fn parse_search_results(html: &str) -> Vec<TorrentSourceEntry> {
    let mut results = Vec::new();
    let mut search_start = 0;

    while let Some(link_pos) = html[search_start..].find("/Home/Bangumi/") {
        let abs_pos = search_start + link_pos;
        let path_start = abs_pos + "/Home/Bangumi/".len();

        // Extract mikan_id (digits after /Home/Bangumi/)
        let id_end = html[path_start..]
            .find(|c: char| !c.is_ascii_digit())
            .map(|i| path_start + i)
            .unwrap_or(html.len());
        let mikan_id = &html[path_start..id_end];

        if mikan_id.is_empty() || mikan_id.len() > 10 {
            search_start = id_end;
            continue;
        }

        // Skip RSS links (/RSS/Bangumi?bangumiId=...)
        if abs_pos > 4 && html[..abs_pos].ends_with("RSS/") {
            search_start = id_end;
            continue;
        }

        // Skip duplicates
        if results
            .iter()
            .any(|r: &TorrentSourceEntry| r.provider_id == mikan_id)
        {
            search_start = id_end;
            continue;
        }

        // Look ahead in nearby HTML for cover + title
        let window_end = (abs_pos + 500).min(html.len());
        let window = &html[abs_pos..window_end];

        let cover = extract_attr_value(window, "data-src").map(|src| {
            if src.starts_with("http") {
                src.to_string()
            } else {
                format!("{MIKAN_BASE}{src}")
            }
        });

        // Title is in <div class="an-text" title="...">
        let title = extract_attr_value(window, "title")
            .map(|s| decode_html_entities(s))
            .unwrap_or_default();

        if !title.is_empty() {
            results.push(TorrentSourceEntry {
                provider_id: mikan_id.to_string(),
                title,
                cover,
                bgm_id: None,
            });
        }

        search_start = id_end;
    }

    results
}

/// Extract the bgm.tv subject ID from a Mikan bangumi detail page.
fn extract_bgm_id(html: &str) -> Option<String> {
    let marker = "bgm.tv/subject/";
    let pos = html.find(marker)?;
    let start = pos + marker.len();
    let end = html[start..]
        .find(|c: char| !c.is_ascii_digit())
        .map(|i| start + i)
        .unwrap_or(html.len());
    let id = &html[start..end];
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// Parse subtitle group list from a Mikan bangumi page.
fn parse_subtitle_groups(html: &str) -> Vec<SubtitleGroup> {
    let mut groups = Vec::new();
    let marker = "subgroup-name subgroup-";
    let mut pos = 0;

    while let Some(found) = html[pos..].find(marker) {
        let abs = pos + found + marker.len();

        // Extract ID (digits)
        let id_end = html[abs..]
            .find(|c: char| !c.is_ascii_digit())
            .map(|i| abs + i)
            .unwrap_or(html.len());
        let id = &html[abs..id_end];

        if id.is_empty() {
            pos = id_end;
            continue;
        }

        // Extract name: skip to `>`, read until `</a>`
        if let Some(tag_close) = html[id_end..].find('>') {
            let name_start = id_end + tag_close + 1;
            if let Some(name_end_rel) = html[name_start..].find("</a>") {
                let raw_name = html[name_start..name_start + name_end_rel].trim();
                let name = decode_html_entities(raw_name);
                if !name.is_empty()
                    && !groups.iter().any(|g: &SubtitleGroup| g.id == id)
                {
                    groups.push(SubtitleGroup {
                        id: id.to_string(),
                        name,
                    });
                }
            }
        }

        pos = id_end;
    }

    groups
}

/// Parse torrent entries from a Mikan RSS feed XML.
fn parse_rss_items(xml: &str, trackers: &[String]) -> Vec<TorrentEntry> {
    let mut entries = Vec::new();
    let mut pos = 0;

    while let Some(item_start) = xml[pos..].find("<item>") {
        let abs_start = pos + item_start;
        let item_end = xml[abs_start..]
            .find("</item>")
            .map(|i| abs_start + i + 7)
            .unwrap_or(xml.len());
        let item = &xml[abs_start..item_end];
        pos = item_end;

        // Title
        let title = extract_xml_text(item, "title")
            .map(|s| decode_html_entities(&s))
            .unwrap_or_default();

        // Episode hash from <link>https://mikanani.me/Home/Episode/{hash}</link>
        let link = extract_xml_text(item, "link").unwrap_or_default();
        let episode_hash = link
            .rfind("/Home/Episode/")
            .map(|i| &link[i + "/Home/Episode/".len()..])
            .unwrap_or("")
            .to_string();

        // Torrent URL from <enclosure url="..."/>
        let torrent_url = extract_attr_value(item, "url")
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Construct magnet URI from hash + tracker list
        let magnet = if !episode_hash.is_empty() {
            let mut m = format!("magnet:?xt=urn:btih:{episode_hash}");
            for tracker in trackers {
                m.push_str("&tr=");
                m.push_str(tracker);
            }
            m
        } else {
            String::new()
        };

        // Size from <contentLength> (bytes → human-readable)
        let size_bytes = extract_xml_text(item, "contentLength")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let size = format_bytes(size_bytes);

        // Publish date from <pubDate> inside <torrent>
        let publish_date = extract_xml_text(item, "pubDate").unwrap_or_default();

        if !episode_hash.is_empty() {
            entries.push(TorrentEntry {
                title,
                episode_hash,
                torrent_url,
                magnet,
                size,
                publish_date,
            });
        }
    }

    entries
}

/// Extract text content between `<tag>` and `</tag>`.
fn extract_xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)?;
    Some(xml[start..start + end].trim().to_string())
}

/// Format byte count as human-readable string.
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

/// Extract the value of an HTML attribute from a snippet.
/// Looks for `attr="value"` or `attr='value'`.
fn extract_attr_value<'a>(html: &'a str, attr: &str) -> Option<&'a str> {
    let attr_eq = format!("{attr}=\"");
    let attr_eq_single = format!("{attr}='");

    if let Some(pos) = html.find(&attr_eq) {
        let start = pos + attr_eq.len();
        let end = html[start..].find('"')?;
        return Some(&html[start..start + end]);
    }
    if let Some(pos) = html.find(&attr_eq_single) {
        let start = pos + attr_eq_single.len();
        let end = html[start..].find('\'')?;
        return Some(&html[start..start + end]);
    }
    None
}

/// Decode common HTML entities.
fn decode_html_entities(s: &str) -> String {
    let s = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'");

    // Decode &#xHEX; numeric character references
    if !s.contains("&#x") {
        return s;
    }

    let mut result = String::with_capacity(s.len());
    let mut rest = s.as_str();
    while let Some(pos) = rest.find("&#x") {
        result.push_str(&rest[..pos]);
        let after = &rest[pos + 3..];
        if let Some(semi) = after.find(';') {
            let hex = &after[..semi];
            if let Ok(code) = u32::from_str_radix(hex, 16) {
                if let Some(ch) = char::from_u32(code) {
                    result.push(ch);
                }
            }
            rest = &after[semi + 1..];
        } else {
            result.push_str("&#x");
            rest = after;
        }
    }
    result.push_str(rest);
    result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_html_entities() {
        assert_eq!(
            decode_html_entities("&#x3010;&#x6211;&#x63A8;&#x7684;&#x5B69;&#x5B50;&#x3011;"),
            "【我推的孩子】"
        );
        assert_eq!(decode_html_entities("foo &amp; bar"), "foo & bar");
    }

    #[test]
    fn test_extract_bgm_id() {
        let html =
            r#"<a href="https://bgm.tv/subject/517057">https://bgm.tv/subject/517057</a>"#;
        assert_eq!(extract_bgm_id(html), Some("517057".to_string()));
    }

    #[test]
    fn test_parse_search_results() {
        let html = r#"
            <a href="/Home/Bangumi/2995" target="_blank">
                <span data-src="/images/Bangumi/202304/24335806.jpg?width=400" class="b-lazy"></span>
                <div class="an-text" title="&#x3010;&#x6211;&#x63A8;&#x7684;&#x5B69;&#x5B50;&#x3011;">【我推的孩子】</div>
            </a>
            <a href="/Home/Bangumi/3881" target="_blank">
                <span data-src="/images/Bangumi/202601/c180f722.jpg?width=400" class="b-lazy"></span>
                <div class="an-text" title="&#x3010;&#x6211;&#x63A8;&#x7684;&#x5B69;&#x5B50;&#x3011; &#x7B2C;&#x4E09;&#x5B63;">【我推的孩子】 第三季</div>
            </a>
        "#;
        let results = parse_search_results(html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].provider_id, "2995");
        assert_eq!(results[0].title, "【我推的孩子】");
        assert_eq!(results[1].provider_id, "3881");
        assert_eq!(results[1].title, "【我推的孩子】 第三季");
    }

    #[test]
    fn test_parse_subtitle_groups() {
        let html = r##"
            <a class="subgroup-name subgroup-554" data-anchor="#554">&#x767E;&#x51AC;&#x7EC3;&#x4E60;&#x7EC4;</a>
            <a class="subgroup-name subgroup-370" data-anchor="#370">LoliHouse</a>
            <a class="subgroup-name subgroup-583" data-anchor="#583">ANi</a>
        "##;
        let groups = parse_subtitle_groups(html);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].id, "554");
        assert_eq!(groups[0].name, "百冬练习组");
        assert_eq!(groups[1].id, "370");
        assert_eq!(groups[1].name, "LoliHouse");
        assert_eq!(groups[2].id, "583");
        assert_eq!(groups[2].name, "ANi");
    }

    #[test]
    fn test_parse_rss_items() {
        let xml = r#"
<rss version="2.0" xmlns:torrent="https://mikanani.me/0.1/">
  <channel>
    <title>Mikan Project - 我推的孩子</title>
    <item>
      <guid isPermaLink="false">【百冬练习组】推しの子 / Oshi no Ko[33][1080p AVC AAC][繁体]</guid>
      <link>https://mikanani.me/Home/Episode/abc123def456</link>
      <title>【百冬练习组】推しの子 / Oshi no Ko[33][1080p AVC AAC][繁体]</title>
      <description>【百冬练习组】推しの子 / Oshi no Ko[33][1080p AVC AAC][繁体][255.68 MB]</description>
      <torrent xmlns="https://mikanani.me/0.1/">
        <link>https://mikanani.me/Home/Episode/abc123def456</link>
        <contentLength>268099904</contentLength>
        <pubDate>2026-03-12T23:38:28.33</pubDate>
      </torrent>
      <enclosure type="application/x-bittorrent" length="268099904" url="https://mikanani.me/Download/20260312/abc123def456.torrent"/>
    </item>
    <item>
      <guid isPermaLink="false">【百冬练习组】推しの子 / Oshi no Ko[32][1080p AVC AAC][繁体]</guid>
      <link>https://mikanani.me/Home/Episode/xyz789ghi012</link>
      <title>【百冬练习组】推しの子 / Oshi no Ko[32][1080p AVC AAC][繁体]</title>
      <description>【百冬练习组】推しの子 / Oshi no Ko[32][1080p AVC AAC][繁体][512.00 MB]</description>
      <torrent xmlns="https://mikanani.me/0.1/">
        <link>https://mikanani.me/Home/Episode/xyz789ghi012</link>
        <contentLength>536870912</contentLength>
        <pubDate>2026-03-05T20:00:00</pubDate>
      </torrent>
      <enclosure type="application/x-bittorrent" length="536870912" url="https://mikanani.me/Download/20260305/xyz789ghi012.torrent"/>
    </item>
  </channel>
</rss>
        "#;
        let trackers: Vec<String> = DEFAULT_TRACKERS.iter().map(|s| s.to_string()).collect();
        let entries = parse_rss_items(xml, &trackers);
        assert_eq!(entries.len(), 2);

        let e = &entries[0];
        assert_eq!(
            e.title,
            "【百冬练习组】推しの子 / Oshi no Ko[33][1080p AVC AAC][繁体]"
        );
        assert_eq!(e.episode_hash, "abc123def456");
        assert_eq!(
            e.torrent_url,
            "https://mikanani.me/Download/20260312/abc123def456.torrent"
        );
        assert!(e.magnet.starts_with("magnet:?xt=urn:btih:abc123def456&tr="));
        assert_eq!(e.size, "255.68 MB");
        assert_eq!(e.publish_date, "2026-03-12T23:38:28.33");

        let e2 = &entries[1];
        assert_eq!(e2.episode_hash, "xyz789ghi012");
        assert_eq!(e2.size, "512.00 MB");
        assert_eq!(e2.publish_date, "2026-03-05T20:00:00");
    }

    #[test]
    fn test_extract_attr_value() {
        assert_eq!(
            extract_attr_value(r#"data-src="/images/test.jpg" class="b-lazy""#, "data-src"),
            Some("/images/test.jpg")
        );
        assert_eq!(
            extract_attr_value(r#"title='hello world'"#, "title"),
            Some("hello world")
        );
        assert_eq!(extract_attr_value(r#"no-attr-here"#, "title"), None);
    }
}
