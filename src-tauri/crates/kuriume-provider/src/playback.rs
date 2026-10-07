//! Playback-source contracts shared by native providers and declarative rules.
//!
//! Catalog metadata and playback resolution deliberately use separate traits:
//! a catalog identifies an anime, while a [`PlaybackProvider`] searches a
//! concrete source and resolves one selected episode into a transport plan.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::rule::{Rule, RuleEngine};
use crate::{ProviderError, Result};

/// Capabilities advertised before the app invokes a provider.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProviderCapabilities {
    pub search: bool,
    pub episodes: bool,
    pub direct: bool,
    pub sniff: bool,
}

/// Stable, serializable provider metadata for settings and source selection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProviderDescriptor {
    /// Stable machine ID, such as `builtin:age` or `builtin:hianime`.
    pub id: String,
    /// Localized/user-facing provider name.
    pub display_name: String,
    /// Whether this provider ships with Kuriume rather than being imported.
    pub built_in: bool,
    pub capabilities: PlaybackProviderCapabilities,
}

/// Provider search input. Alternative titles let native providers attempt a
/// catalog's romaji/English/native aliases without coupling to its data model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSearch {
    pub query: String,
    #[serde(default)]
    pub anilist_id: Option<u64>,
    #[serde(default)]
    pub alternative_titles: Vec<String>,
    #[serde(default)]
    pub year: Option<u16>,
    #[serde(default)]
    pub episode_count: Option<u32>,
    #[serde(default)]
    pub episode_number: Option<u32>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// One source-specific anime candidate. `id` is opaque to the caller and must
/// only be returned to the same provider's [`PlaybackProvider::episodes`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCandidate {
    pub id: String,
    pub title: String,
    /// Whether the provider title exactly matches one of the catalog titles
    /// after conservative punctuation/case normalization.
    #[serde(default)]
    pub exact_match: bool,
    /// Optional source metadata used to disambiguate similarly named seasons.
    #[serde(default)]
    pub episode_count: Option<u32>,
    #[serde(default)]
    pub year: Option<u16>,
}

/// A provider playlist/translation/version containing playable episodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackRoad {
    pub id: String,
    pub label: String,
    pub episodes: Vec<PlaybackEpisode>,
}

/// One source-specific episode. The explicit number avoids treating array
/// position as episode identity (important for specials and missing episodes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEpisode {
    pub id: String,
    pub label: String,
    pub episode_number: Option<f64>,
}

/// Opaque identities selected by the app and returned to the same provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackResolveRequest {
    pub candidate_id: String,
    pub road_id: String,
    pub episode_id: String,
}

pub type PlaybackHeaders = BTreeMap<String, String>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaybackSubtitle {
    pub label: String,
    pub url: String,
    pub language: Option<String>,
}

/// An alternative transport for the same work, translation and episode.
/// A failed CDN is not a failed title match; callers can select another source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaybackSource {
    pub name: String,
    pub plan: ResolvePlan,
}

/// Provider-neutral result of resolving an episode.
///
/// The desktop shell owns URL validation, WebView creation, request sniffing,
/// and playback. Providers only describe the least-privileged plan required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolvePlan {
    /// A media asset already suitable for the native player.
    Direct {
        url: String,
        #[serde(rename = "mimeType", default)]
        mime_type: Option<String>,
        #[serde(default)]
        subtitles: Vec<PlaybackSubtitle>,
        #[serde(default)]
        headers: PlaybackHeaders,
        #[serde(rename = "allowedHosts", default)]
        allowed_hosts: Vec<String>,
    },
    /// An episode page that must be loaded in an isolated sniffer WebView.
    Sniff {
        #[serde(rename = "pageUrl")]
        page_url: String,
        #[serde(default)]
        headers: PlaybackHeaders,
        #[serde(rename = "allowedHosts", default)]
        allowed_hosts: Vec<String>,
    },
}

/// Unified interface implemented by every playback source.
#[async_trait]
pub trait PlaybackProvider: Send + Sync {
    fn descriptor(&self) -> &PlaybackProviderDescriptor;

    async fn search(&self, query: PlaybackSearch) -> Result<Vec<PlaybackCandidate>>;

    async fn episodes(&self, candidate_id: &str) -> Result<Vec<PlaybackRoad>>;

    async fn resolve(&self, request: PlaybackResolveRequest) -> Result<Vec<PlaybackSource>>;
}

/// Adapter that exposes an existing declarative [`RuleEngine`] through the
/// unified playback-provider contract.
pub struct RulePlaybackProvider {
    descriptor: PlaybackProviderDescriptor,
    engine: RuleEngine,
}

impl RulePlaybackProvider {
    pub fn new(mut rule: Rule) -> Result<Self> {
        rule.ensure_identity();
        rule.validate_structure()?;

        let capabilities = PlaybackProviderCapabilities {
            search: true,
            episodes: true,
            // The legacy `Direct` rule mode means "sniff a direct URL from an
            // episode page". It is intentionally not advertised as Direct.
            direct: false,
            sniff: true,
        };
        let descriptor = PlaybackProviderDescriptor {
            id: rule.id.clone(),
            display_name: rule.name.clone(),
            built_in: rule.id.starts_with("builtin:"),
            capabilities,
        };

        Ok(Self {
            descriptor,
            engine: RuleEngine::new(rule),
        })
    }

    pub fn rule(&self) -> &Rule {
        self.engine.rule()
    }

    fn headers(&self) -> PlaybackHeaders {
        let mut headers = PlaybackHeaders::new();
        headers.insert(
            "Referer".into(),
            format!("{}/", self.rule().base_url.trim_end_matches('/')),
        );
        if !self.rule().user_agent.trim().is_empty() {
            headers.insert("User-Agent".into(), self.rule().user_agent.clone());
        }
        headers
    }

    fn allowed_hosts(&self) -> Vec<String> {
        let mut hosts: Vec<String> = self
            .rule()
            .allowed_hosts
            .iter()
            .map(|host| host.trim().trim_matches('.').to_ascii_lowercase())
            .filter(|host| !host.is_empty())
            .collect();
        if let Ok(url) = reqwest::Url::parse(&self.rule().base_url) {
            if let Some(host) = url.host_str() {
                hosts.push(host.to_ascii_lowercase());
            }
        }
        hosts.sort();
        hosts.dedup();
        hosts
    }

    fn validate_candidate_url(&self, raw: &str) -> Result<()> {
        let base = reqwest::Url::parse(&self.rule().base_url)
            .map_err(|_| ProviderError::Parse("Invalid rule base URL".into()))?;
        let host = base
            .host_str()
            .ok_or_else(|| ProviderError::Parse("Rule base URL has no host".into()))?;
        validate_scoped_url(raw, &[host.to_string()])
    }

    fn validate_episode_url(&self, raw: &str) -> Result<()> {
        validate_scoped_url(raw, &self.allowed_hosts())
    }
}

#[async_trait]
impl PlaybackProvider for RulePlaybackProvider {
    fn descriptor(&self) -> &PlaybackProviderDescriptor {
        &self.descriptor
    }

    async fn search(&self, query: PlaybackSearch) -> Result<Vec<PlaybackCandidate>> {
        let keyword = query.query.trim();
        if keyword.is_empty() {
            return Err(ProviderError::Parse(
                "Playback search query is required".into(),
            ));
        }

        let exact_titles: BTreeSet<String> = std::iter::once(keyword)
            .chain(query.alternative_titles.iter().map(String::as_str))
            .map(normalized_title)
            .filter(|title| !title.is_empty())
            .collect();
        let mut candidates = Vec::new();
        let mut searched = BTreeSet::new();
        let mut seen = BTreeSet::new();
        for term in
            std::iter::once(keyword).chain(query.alternative_titles.iter().map(String::as_str))
        {
            if searched.len() >= 4 {
                break;
            }
            if term.trim().is_empty() || !searched.insert(normalized_title(term)) {
                continue;
            }
            for result in self.engine.search(term).await? {
                if self.validate_candidate_url(&result.url).is_err() {
                    continue;
                }
                if !seen.insert(result.url.clone()) {
                    continue;
                }
                candidates.push(PlaybackCandidate {
                    id: encode_opaque_id(&self.descriptor.id, "candidate", &result.url),
                    exact_match: exact_titles.contains(&normalized_title(&result.name)),
                    title: result.name,
                    episode_count: None,
                    year: None,
                });
            }
            if candidates.iter().any(|candidate| candidate.exact_match) {
                break;
            }
        }
        candidates.sort_by_key(|candidate| !candidate.exact_match);
        if let Some(limit) = query.limit {
            candidates.truncate(limit);
        }
        Ok(candidates)
    }

    async fn episodes(&self, candidate_id: &str) -> Result<Vec<PlaybackRoad>> {
        let candidate_url = decode_opaque_id(&self.descriptor.id, "candidate", candidate_id)?;
        self.validate_candidate_url(&candidate_url)?;
        let roads = self.engine.get_episodes(&candidate_url).await?;

        Ok(roads
            .into_iter()
            .enumerate()
            .map(|(road_index, road)| {
                let road_identity = format!("{road_index}|{}", road.name);
                PlaybackRoad {
                    id: encode_opaque_id(&self.descriptor.id, "road", &road_identity),
                    label: road.name,
                    episodes: road
                        .episodes
                        .into_iter()
                        .filter(|episode| self.validate_episode_url(&episode.url).is_ok())
                        .map(|episode| PlaybackEpisode {
                            id: encode_opaque_id(&self.descriptor.id, "episode", &episode.url),
                            episode_number: parse_episode_number(&episode.name),
                            label: episode.name,
                        })
                        .collect(),
                }
            })
            .collect())
    }

    async fn resolve(&self, request: PlaybackResolveRequest) -> Result<Vec<PlaybackSource>> {
        // Validate that every token belongs to this contract even though a
        // rule only needs the episode URL to create its resolve plan.
        let candidate = decode_opaque_id(&self.descriptor.id, "candidate", &request.candidate_id)?;
        self.validate_candidate_url(&candidate)?;
        let _road = decode_opaque_id(&self.descriptor.id, "road", &request.road_id)?;
        let episode_url = decode_opaque_id(&self.descriptor.id, "episode", &request.episode_id)?;
        self.validate_episode_url(&episode_url)?;
        let headers = self.headers();
        let allowed_hosts = self.allowed_hosts();

        // Older rules may call this "embed". Both modes now extract media in
        // the background; a provider can never replace the app's player UI.
        let plan = ResolvePlan::Sniff {
            page_url: episode_url,
            headers,
            allowed_hosts,
        };
        Ok(vec![PlaybackSource {
            name: self.descriptor.display_name.clone(),
            plan,
        }])
    }
}

fn encode_opaque_id(provider_id: &str, kind: &str, value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 2);
    for byte in value.as_bytes() {
        let _ = write!(encoded, "{byte:02x}");
    }
    format!("{kind}:{:016x}:{encoded}", opaque_scope(provider_id))
}

fn decode_opaque_id(provider_id: &str, expected_kind: &str, value: &str) -> Result<String> {
    let prefix = format!("{expected_kind}:{:016x}:", opaque_scope(provider_id));
    let encoded = value.strip_prefix(&prefix).ok_or_else(|| {
        ProviderError::Parse(format!("Invalid opaque {expected_kind} identifier"))
    })?;
    if encoded.is_empty() || encoded.len() % 2 != 0 {
        return Err(ProviderError::Parse(format!(
            "Invalid opaque {expected_kind} identifier"
        )));
    }

    let bytes = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|_| {
                ProviderError::Parse(format!("Invalid opaque {expected_kind} identifier"))
            })?;
            u8::from_str_radix(pair, 16).map_err(|_| {
                ProviderError::Parse(format!("Invalid opaque {expected_kind} identifier"))
            })
        })
        .collect::<Result<Vec<_>>>()?;
    String::from_utf8(bytes)
        .map_err(|_| ProviderError::Parse(format!("Invalid opaque {expected_kind} identifier")))
}

fn opaque_scope(provider_id: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in provider_id.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(super) fn validate_scoped_url(raw: &str, allowed_hosts: &[String]) -> Result<()> {
    let url = reqwest::Url::parse(raw)
        .map_err(|_| ProviderError::Parse("Invalid playback rule URL".into()))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(ProviderError::Parse(
            "Playback rule URLs must use credential-free HTTP(S)".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| ProviderError::Parse("Playback rule URL has no host".into()))?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    if !allowed_hosts.iter().any(|allowed| {
        let allowed = allowed.trim().trim_matches('.').to_ascii_lowercase();
        !allowed.is_empty() && (host == allowed || host.ends_with(&format!(".{allowed}")))
    }) {
        return Err(ProviderError::Parse(
            "Playback rule URL host is outside the provider scope".into(),
        ));
    }
    if host == "localhost" || host.ends_with(".localhost") {
        return Err(ProviderError::Parse(
            "Local playback rule URLs are not allowed".into(),
        ));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_local_ip(ip) {
            return Err(ProviderError::Parse(
                "Private playback rule URLs are not allowed".into(),
            ));
        }
    }
    Ok(())
}

fn is_private_or_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip == Ipv4Addr::UNSPECIFIED
        }
        IpAddr::V6(ip) => {
            ip.to_ipv4_mapped()
                .is_some_and(|mapped| is_private_or_local_ip(IpAddr::V4(mapped)))
                || ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip == Ipv6Addr::LOCALHOST
        }
    }
}

fn parse_episode_number(label: &str) -> Option<f64> {
    let start = label.find(|character: char| character.is_ascii_digit())?;
    let mut seen_decimal = false;
    let number: String = label[start..]
        .chars()
        .take_while(|character| {
            if character.is_ascii_digit() {
                true
            } else if *character == '.' && !seen_decimal {
                seen_decimal = true;
                true
            } else {
                false
            }
        })
        .collect();
    number.trim_end_matches('.').parse().ok()
}

fn normalized_title(value: &str) -> String {
    let mut normalized: String = value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    for season in 1..=30 {
        for suffix in ["st", "nd", "rd", "th"] {
            let ordinal = format!("{season}{suffix}season");
            if normalized.contains(&ordinal) {
                normalized = normalized.replace(&ordinal, &format!("season{season}"));
            }
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtin_rules;

    #[test]
    fn age_descriptor_has_stable_id_and_truthful_capabilities() {
        let provider = RulePlaybackProvider::new(builtin_rules::agedm()).unwrap();
        let descriptor = provider.descriptor();

        assert_eq!(descriptor.id, "builtin:age");
        assert_eq!(descriptor.display_name, "AGE动漫");
        assert!(descriptor.built_in);
        assert!(descriptor.capabilities.search);
        assert!(descriptor.capabilities.episodes);
        assert!(descriptor.capabilities.sniff);
        assert!(!descriptor.capabilities.direct);
    }

    #[test]
    fn opaque_ids_round_trip_without_exposing_a_raw_url() {
        let url = "https://example.com/play/1?episode=2";
        let id = encode_opaque_id("custom:test", "episode", url);

        assert!(id.starts_with("episode:"));
        assert!(!id.contains("example.com"));
        assert_eq!(
            decode_opaque_id("custom:test", "episode", &id).unwrap(),
            url
        );
        assert!(decode_opaque_id("custom:other", "episode", &id).is_err());
        assert!(decode_opaque_id("custom:test", "candidate", &id).is_err());
    }

    #[test]
    fn episode_numbers_are_explicit_and_specials_remain_none() {
        assert_eq!(parse_episode_number("第01集"), Some(1.0));
        assert_eq!(parse_episode_number("12.5"), Some(12.5));
        assert_eq!(parse_episode_number("OVA"), None);
    }

    #[test]
    fn exact_title_matching_normalizes_season_ordinals() {
        assert_eq!(
            normalized_title("Example 2nd Season"),
            normalized_title("Example Season 2")
        );
    }

    #[tokio::test]
    async fn age_rule_resolves_to_a_serializable_sniff_plan() {
        let provider = RulePlaybackProvider::new(builtin_rules::agedm()).unwrap();
        let plan = provider
            .resolve(PlaybackResolveRequest {
                candidate_id: encode_opaque_id(
                    "builtin:age",
                    "candidate",
                    "https://www.agedm.io/detail/example",
                ),
                road_id: encode_opaque_id("builtin:age", "road", "0|AGE"),
                episode_id: encode_opaque_id(
                    "builtin:age",
                    "episode",
                    "https://www.agedm.io/play/example/1",
                ),
            })
            .await
            .unwrap();
        let value = serde_json::to_value(&plan[0].plan).unwrap();

        assert_eq!(value["kind"], "sniff");
        assert_eq!(value["pageUrl"], "https://www.agedm.io/play/example/1");
        assert_eq!(value["headers"]["Referer"], "https://www.agedm.io/");
        assert!(value["allowedHosts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|host| host == "www.agedm.io"));
        assert!(value.get("page_url").is_none());
        assert!(value.get("allowed_hosts").is_none());
    }

    #[test]
    fn direct_plan_serialization_is_camel_case() {
        let plan = ResolvePlan::Direct {
            url: "https://media.example/episode.m3u8".into(),
            mime_type: Some("application/x-mpegURL".into()),
            subtitles: Vec::new(),
            headers: PlaybackHeaders::new(),
            allowed_hosts: vec!["media.example".into()],
        };
        let value = serde_json::to_value(plan).unwrap();

        assert_eq!(value["kind"], "direct");
        assert_eq!(value["mimeType"], "application/x-mpegURL");
        assert_eq!(value["allowedHosts"][0], "media.example");
        assert!(value.get("mime_type").is_none());
    }
}
