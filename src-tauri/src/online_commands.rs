//! Unified playback-source registry and Tauri command boundary.

use crate::media_proxy::MediaProxyState;
use crate::store_commands::StoreState;
use kuriume_provider::{
    Anime1, HiAnime, PlaybackCandidate, PlaybackProvider, PlaybackProviderDescriptor,
    PlaybackResolveRequest, PlaybackRoad, PlaybackSearch, PlaybackSubtitle, ResolvePlan, Rule,
    RulePlaybackProvider, Xifan,
};
use serde::Serialize;
use std::collections::HashMap;
#[cfg(desktop)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, State};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
static SNIFFER_COUNTER: AtomicU64 = AtomicU64::new(0);

// ── State ────────────────────────────────────────────────────────

/// Playback providers keyed by stable machine ID. `order` is kept separately
/// because provider order is part of the product contract: Anime1, Xifan Next,
/// AGE, HiAnime, then imported rules. The first provider is the default.
pub struct OnlineSourceState {
    providers: Mutex<HashMap<String, Arc<dyn PlaybackProvider>>>,
    order: Mutex<Vec<String>>,
    rules: Mutex<HashMap<String, Rule>>,
}

impl OnlineSourceState {
    pub fn new() -> Self {
        let state = Self {
            providers: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
            rules: Mutex::new(HashMap::new()),
        };

        state.register_provider(Arc::new(Anime1::new()));
        state.register_provider(Arc::new(Xifan::new()));
        for rule in kuriume_provider::builtin_rules::all() {
            state.add_rule(rule);
        }
        state.register_provider(Arc::new(HiAnime::new()));

        state
    }

    fn register_provider(&self, provider: Arc<dyn PlaybackProvider>) {
        let id = provider.descriptor().id.clone();
        let mut providers = self.providers.lock().unwrap();
        let is_new = !providers.contains_key(&id);
        providers.insert(id.clone(), provider);
        drop(providers);

        if is_new {
            self.order.lock().unwrap().push(id);
        }
    }

    /// Register a rule and its provider adapter. Kept infallible for startup
    /// compatibility; imported rules are validated before reaching this path.
    pub fn add_rule(&self, rule: Rule) {
        if let Err(error) = self.add_rule_checked(rule) {
            eprintln!("Skipped invalid playback rule: {error}");
        }
    }

    fn add_rule_checked(&self, rule: Rule) -> Result<PlaybackProviderDescriptor, String> {
        let provider =
            RulePlaybackProvider::new(rule.clone()).map_err(|error| error.to_string())?;
        let descriptor = provider.descriptor().clone();
        self.rules
            .lock()
            .unwrap()
            .insert(descriptor.id.clone(), rule);
        self.register_provider(Arc::new(provider));
        Ok(descriptor)
    }

    /// Remove a rule by stable ID. A display-name lookup remains only for
    /// loading databases written before stable IDs were introduced.
    pub fn remove_rule(&self, identity: &str) {
        let id = self.resolve_rule_id(identity);
        let Some(id) = id else {
            return;
        };
        self.rules.lock().unwrap().remove(&id);
        self.providers.lock().unwrap().remove(&id);
        self.order.lock().unwrap().retain(|entry| entry != &id);
    }

    fn resolve_rule_id(&self, identity: &str) -> Option<String> {
        let rules = self.rules.lock().unwrap();
        if rules.contains_key(identity) {
            return Some(identity.to_string());
        }
        rules
            .iter()
            .find(|(_, rule)| rule.name == identity)
            .map(|(id, _)| id.clone())
    }

    fn provider(&self, id: &str) -> Result<Arc<dyn PlaybackProvider>, String> {
        self.providers
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Playback provider not found: {id}"))
    }

    fn descriptor(&self, id: &str) -> Option<PlaybackProviderDescriptor> {
        self.providers
            .lock()
            .unwrap()
            .get(id)
            .map(|provider| provider.descriptor().clone())
    }

    fn list_descriptors(&self) -> Vec<PlaybackProviderDescriptor> {
        let providers = self.providers.lock().unwrap();
        self.order
            .lock()
            .unwrap()
            .iter()
            .filter_map(|id| providers.get(id))
            .map(|provider| provider.descriptor().clone())
            .collect()
    }

    /// Get a snapshot of all rules.
    pub fn list_rules(&self) -> Vec<Rule> {
        let rules = self.rules.lock().unwrap();
        self.order
            .lock()
            .unwrap()
            .iter()
            .filter_map(|id| rules.get(id).cloned())
            .collect()
    }

    fn get_rule(&self, identity: &str) -> Option<Rule> {
        let id = self.resolve_rule_id(identity)?;
        self.rules.lock().unwrap().get(&id).cloned()
    }
}

impl Default for OnlineSourceState {
    fn default() -> Self {
        Self::new()
    }
}

// ── Commands ─────────────────────────────────────────────────────

/// List providers in user-facing priority order. The first entry is the
/// default provider.
#[command]
pub(crate) async fn playback_source_list(
    state: State<'_, OnlineSourceState>,
) -> Result<Vec<PlaybackProviderDescriptor>, String> {
    Ok(state.list_descriptors())
}

#[command]
pub(crate) async fn playback_source_list_rules(
    state: State<'_, OnlineSourceState>,
) -> Result<Vec<Rule>, String> {
    Ok(state.list_rules())
}

#[command]
pub(crate) async fn playback_source_add_rule(
    app: AppHandle,
    state: State<'_, OnlineSourceState>,
    store: State<'_, StoreState>,
    mut rule: Rule,
) -> Result<PlaybackProviderDescriptor, String> {
    rule.ensure_identity();
    validate_source_rule(&rule)?;
    if rule.id.starts_with("builtin:")
        || state
            .descriptor(&rule.id)
            .is_some_and(|descriptor| descriptor.built_in)
    {
        return Err("Built-in source rules cannot be replaced".into());
    }
    let rule_json = serde_json::to_string(&rule).map_err(|error| error.to_string())?;
    let rule_id = rule.id.clone();
    let legacy_name = rule.name.clone();
    store.with_store(&app, |database| {
        // Remove a pre-stable-ID row before writing the canonical ID key.
        database
            .source_rule_remove(&legacy_name)
            .map_err(|error| error.to_string())?;
        database
            .source_rule_upsert(&rule_id, &rule_json)
            .map_err(|error| error.to_string())
    })?;
    state.add_rule_checked(rule)
}

#[command]
pub(crate) async fn playback_source_remove_rule(
    app: AppHandle,
    state: State<'_, OnlineSourceState>,
    store: State<'_, StoreState>,
    provider_id: &str,
) -> Result<(), String> {
    let descriptor = state
        .descriptor(provider_id)
        .ok_or_else(|| format!("Playback provider not found: {provider_id}"))?;
    if descriptor.built_in {
        return Err("Built-in source rules cannot be removed".into());
    }
    let rule = state
        .get_rule(provider_id)
        .ok_or_else(|| "Imported source rule not found".to_string())?;
    store.with_store(&app, |database| {
        database
            .source_rule_remove(provider_id)
            .map_err(|error| error.to_string())?;
        database
            .source_rule_remove(&rule.name)
            .map_err(|error| error.to_string())
    })?;
    state.remove_rule(provider_id);
    Ok(())
}

#[command]
pub(crate) async fn playback_source_search(
    state: State<'_, OnlineSourceState>,
    provider_id: &str,
    query: PlaybackSearch,
) -> Result<Vec<PlaybackCandidate>, String> {
    if query.query.trim().is_empty() || query.query.chars().count() > 200 {
        return Err("Search keyword must contain 1–200 characters".into());
    }
    if query.alternative_titles.len() > 8
        || query
            .alternative_titles
            .iter()
            .any(|title| title.chars().count() > 200)
    {
        return Err("Alternative titles exceed V1 limits".into());
    }
    state
        .provider(provider_id)?
        .search(query)
        .await
        .map_err(|error| error.to_string())
}

#[command]
pub(crate) async fn playback_source_episodes(
    state: State<'_, OnlineSourceState>,
    provider_id: &str,
    candidate_id: &str,
) -> Result<Vec<PlaybackRoad>, String> {
    if candidate_id.is_empty() || candidate_id.len() > 16_384 {
        return Err("Invalid candidate identifier".into());
    }
    state
        .provider(provider_id)?
        .episodes(candidate_id)
        .await
        .map_err(|error| error.to_string())
}

// ── Video URL sniffer ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlayableAsset {
    Direct {
        url: String,
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
        subtitles: Vec<PlaybackSubtitle>,
    },
}

#[derive(Serialize)]
pub struct PlayableSource {
    name: String,
    asset: PlayableAsset,
}

/// Background extraction only. The original episode page stays the top frame
/// so player frames retain their expected context; nothing is shown to users.
const SNIFFER_SCRIPT: &str = include_str!("media-sniffer.js");

#[cfg(desktop)]
async fn sniff_video_url_impl(
    app: AppHandle,
    episode_url: String,
    allowed_hosts: Vec<String>,
    user_agent: Option<String>,
) -> Result<(String, &'static str), String> {
    validate_provider_url(&episode_url, &allowed_hosts, "sniff")?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(16);
    let label = format!(
        "sniffer-{}",
        SNIFFER_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(episode_url.parse().map_err(|_| "Invalid episode URL")?),
    )
    .title("Media resolver")
    .visible(false)
    .focused(false);
    if let Some(user_agent) = user_agent {
        builder = builder.user_agent(&user_agent);
    }
    let window = builder
        .initialization_script_for_all_frames(SNIFFER_SCRIPT)
        .on_navigation(move |url| {
            let allowed = (url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc"))
                || validate_provider_url(url.as_str(), &allowed_hosts, "sniff").is_ok();
            if !allowed {
                eprintln!(
                    "[media-resolver] blocked undeclared navigation host: {}",
                    url.host_str().unwrap_or("opaque")
                );
            }
            allowed
        })
        .on_page_load(|_, payload| {
            eprintln!(
                "[media-resolver] {:?}: {}",
                payload.event(),
                payload.url().host_str().unwrap_or("opaque")
            );
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_document_title_changed(move |_, title| {
            if let Some(url) = title.strip_prefix("__KURIUME_MEDIA__:") {
                if url.len() <= 8_192 && validate_public_http_url(url).is_ok() {
                    let _ = tx.try_send(url.to_string());
                }
            }
        })
        .build()
        .map_err(|error| format!("Cannot start media resolver: {error}"))?;

    // A website reporting a URL is not proof of playable media. Ignore HTML,
    // failed requests and single TS segments, and keep listening within a
    // bounded session. The remote page has no application IPC capabilities.
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let mut seen = std::collections::HashSet::new();
        while let Some(url) = rx.recv().await {
            if seen.len() >= 16 {
                break;
            }
            if seen.insert(url.clone()) {
                match probe_media_url(&url).await {
                    Ok(mime) => return Ok((url, mime)),
                    Err(_) => {
                        eprintln!("[media-resolver] candidate did not return accessible MP4/HLS")
                    }
                }
            }
        }
        Err("No supported media found on this source".to_string())
    })
    .await;
    let _ = window.close();
    result.unwrap_or_else(|_| Err("Video URL sniffing timed out (30s)".into()))
}

#[cfg(mobile)]
async fn sniff_video_url_impl(
    app: AppHandle,
    episode_url: String,
    allowed_hosts: Vec<String>,
    user_agent: Option<String>,
) -> Result<(String, &'static str), String> {
    validate_provider_url(&episode_url, &allowed_hosts, "sniff")?;
    tokio::time::timeout(std::time::Duration::from_secs(36), async move {
        let urls = tauri_plugin_mobile::sniff(
            app,
            serde_json::json!({
                "url": episode_url, "allowedHosts": allowed_hosts,
                "userAgent": user_agent, "script": SNIFFER_SCRIPT,
            }),
        )
        .await?;
        for url in urls.into_iter().take(16) {
            if url.len() <= 8_192 {
                if let Ok(mime) = probe_media_url(&url).await {
                    return Ok((url, mime));
                }
            }
        }
        Err("No supported media found on this source".into())
    })
    .await
    .map_err(|_| "Source resolution timed out".to_string())?
}

async fn probe_media_url(raw: &str) -> Result<&'static str, String> {
    let url = validate_public_http_url(raw)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .header("Range", "bytes=0-4095")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err("Media redirected unexpectedly".into());
    }
    let mut bytes = Vec::new();
    while bytes.len() < 4_096 {
        let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? else {
            break;
        };
        bytes.extend_from_slice(&chunk[..chunk.len().min(4_096 - bytes.len())]);
    }
    if bytes.starts_with(b"#EXTM3U") {
        Ok("application/x-mpegURL")
    } else if is_supported_media_prefix(&bytes) {
        Ok("video/mp4")
    } else {
        Err("Source returned no MP4/HLS media".into())
    }
}

fn is_supported_media_prefix(bytes: &[u8]) -> bool {
    bytes.starts_with(b"#EXTM3U") || bytes.get(4..8) == Some(b"ftyp")
}

/// Resolve opaque source identities into the least-privileged player asset.
/// Provider URLs never arrive as command parameters from the renderer.
#[command]
pub(crate) async fn playback_source_resolve(
    app: AppHandle,
    state: State<'_, OnlineSourceState>,
    media_proxy: State<'_, MediaProxyState>,
    provider_id: &str,
    request: PlaybackResolveRequest,
) -> Result<Vec<PlayableSource>, String> {
    validate_resolve_request(&request)?;
    let sources = state
        .provider(provider_id)?
        .resolve(request)
        .await
        .map_err(|error| error.to_string())?;

    let mut result = Vec::new();
    let mut last_error = None;
    for source in sources.into_iter().take(3) {
        let sniff = matches!(source.plan, ResolvePlan::Sniff { .. });
        // A resolved transport need not wait for slower background websites.
        if sniff && !result.is_empty() {
            continue;
        }
        match prepare_playback_asset(&app, &media_proxy, source.plan).await {
            Ok(asset) => result.push(PlayableSource {
                name: source.name,
                asset,
            }),
            Err(error) => last_error = Some(error),
        }
    }
    if result.is_empty() {
        return Err(last_error.unwrap_or_else(|| "No playable sources for this episode".into()));
    }
    Ok(result)
}

async fn prepare_playback_asset(
    app: &AppHandle,
    media_proxy: &MediaProxyState,
    plan: ResolvePlan,
) -> Result<PlayableAsset, String> {
    match plan {
        ResolvePlan::Direct {
            url,
            mime_type,
            mut subtitles,
            headers,
            allowed_hosts,
        } => {
            validate_provider_url(&url, &allowed_hosts, "media")?;
            for subtitle in &subtitles {
                validate_provider_url(&subtitle.url, &allowed_hosts, "subtitle")?;
            }
            if !headers.is_empty() {
                for subtitle in &mut subtitles {
                    subtitle.url = media_proxy.register(
                        &subtitle.url,
                        headers.clone(),
                        &allowed_hosts,
                        Some("text/vtt"),
                    )?;
                }
            }
            let url = if headers.is_empty() {
                url
            } else {
                media_proxy.register(&url, headers, &allowed_hosts, mime_type.as_deref())?
            };
            Ok(PlayableAsset::Direct {
                url,
                mime_type,
                subtitles,
            })
        }
        ResolvePlan::Sniff {
            page_url,
            headers,
            allowed_hosts,
        } => {
            validate_provider_url(&page_url, &allowed_hosts, "sniff")?;
            let (url, mime) = sniff_video_url_impl(
                app.clone(),
                page_url,
                allowed_hosts,
                headers.get("User-Agent").cloned(),
            )
            .await?;
            validate_public_http_url(&url)?;
            Ok(PlayableAsset::Direct {
                mime_type: Some(mime.into()),
                url,
                subtitles: Vec::new(),
            })
        }
    }
}

fn validate_resolve_request(request: &PlaybackResolveRequest) -> Result<(), String> {
    for (name, value) in [
        ("candidate", &request.candidate_id),
        ("road", &request.road_id),
        ("episode", &request.episode_id),
    ] {
        if value.is_empty() || value.len() > 16_384 {
            return Err(format!("Invalid {name} identifier"));
        }
    }
    Ok(())
}

fn validate_provider_url(raw: &str, allowed_hosts: &[String], kind: &str) -> Result<(), String> {
    if allowed_hosts.is_empty() || allowed_hosts.len() > 32 {
        return Err(format!("Provider declared invalid {kind} hosts"));
    }
    let url = validate_public_http_url(raw)?;
    let host = url
        .host_str()
        .ok_or_else(|| format!("Provider {kind} URL has no host"))?
        .to_ascii_lowercase();
    if !host_is_declared(&host, allowed_hosts) {
        return Err(format!("Provider {kind} URL host is not declared"));
    }
    Ok(())
}

pub(crate) fn validate_source_rule(rule: &Rule) -> Result<(), String> {
    rule.validate_structure()
        .map_err(|error| error.to_string())?;
    if rule.id.chars().count() > 128
        || rule.name.chars().count() > 80
        || rule.version.chars().count() > 40
        || rule.base_url.len() > 2_048
        || rule.search_url.len() > 4_096
        || rule.allowed_hosts.len() > 32
    {
        return Err("Source rule exceeds V1 size limits".into());
    }
    for field in [&rule.author, &rule.license] {
        if field
            .as_deref()
            .is_some_and(|value| value.chars().count() > 200)
        {
            return Err("Source rule attribution exceeds V1 size limits".into());
        }
    }
    if let Some(homepage) = &rule.homepage {
        validate_public_http_url(homepage)?;
    }
    let base = validate_public_http_url(&rule.base_url)?;
    let search = validate_public_http_url(&rule.search_url.replace("{keyword}", "kuriume"))?;
    let base_host = base
        .host_str()
        .ok_or_else(|| "Source base URL has no host".to_string())?;
    let search_host = search
        .host_str()
        .ok_or_else(|| "Search URL has no host".to_string())?;
    if !host_is_declared(search_host, &[base_host.to_string()]) {
        return Err("Search URL must belong to the source base host".into());
    }
    for host in &rule.allowed_hosts {
        let host = host.trim().trim_start_matches('.');
        if host.is_empty() || host.contains('/') || host.contains(':') {
            return Err(format!("Invalid allowed host: {host}"));
        }
        validate_public_http_url(&format!("https://{host}"))?;
    }
    Ok(())
}

fn validate_public_http_url(raw: &str) -> Result<tauri::Url, String> {
    let url = raw
        .parse::<tauri::Url>()
        .map_err(|_| "Invalid source URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only credential-free HTTP(S) source URLs are supported".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Source URL has no host".to_string())?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("Local source URLs are not allowed".into());
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        let private = match ip {
            std::net::IpAddr::V4(ip) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_broadcast()
                    || ip.is_documentation()
                    || ip.is_unspecified()
            }
            std::net::IpAddr::V6(ip) => {
                ip.to_ipv4_mapped().is_some_and(|mapped| {
                    mapped.is_private()
                        || mapped.is_loopback()
                        || mapped.is_link_local()
                        || mapped.is_broadcast()
                        || mapped.is_documentation()
                        || mapped.is_unspecified()
                }) || ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local()
            }
        };
        if private {
            return Err("Private and local source URLs are not allowed".into());
        }
    }
    Ok(url)
}

fn host_is_declared(host: &str, allowed_hosts: &[String]) -> bool {
    allowed_hosts.iter().any(|allowed| {
        let allowed = allowed.trim().trim_start_matches('.').to_ascii_lowercase();
        !allowed.is_empty() && (host == allowed || host.ends_with(&format!(".{allowed}")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffer_accepts_media_bytes_not_a_webpage_or_transport_segment() {
        assert!(is_supported_media_prefix(b"#EXTM3U\n#EXT-X-VERSION:3"));
        assert!(is_supported_media_prefix(b"\0\0\0\x18ftypisom"));
        assert!(!is_supported_media_prefix(
            b"<html>Verification required</html>"
        ));
        assert!(!is_supported_media_prefix(&[0x47; 188]));
    }

    #[test]
    fn built_in_providers_follow_product_order_and_exclude_retired_sources() {
        let state = OnlineSourceState::new();
        let ids: Vec<String> = state
            .list_descriptors()
            .into_iter()
            .map(|descriptor| descriptor.id)
            .collect();

        assert_eq!(
            ids,
            [
                "builtin:anime1",
                "builtin:xifan",
                "builtin:age",
                "builtin:hianime"
            ]
        );
        assert!(state.provider("builtin:allanime").is_err());
        assert!(state.provider("builtin:mx").is_err());
    }

    #[test]
    fn playable_asset_is_media_only_with_camel_case_fields() {
        let direct = serde_json::to_value(PlayableAsset::Direct {
            url: "kuriume-media://localhost/session".into(),
            mime_type: Some("video/mp4".into()),
            subtitles: Vec::new(),
        })
        .unwrap();

        assert_eq!(direct["kind"], "direct");
        assert_eq!(direct["mimeType"], "video/mp4");
        assert!(direct.get("mime_type").is_none());
        assert!(direct["subtitles"].as_array().unwrap().is_empty());
    }

    #[test]
    fn provider_urls_must_match_a_declared_public_host() {
        assert!(validate_provider_url(
            "https://media.example/episode.mp4",
            &["media.example".into()],
            "media"
        )
        .is_ok());
        assert!(validate_provider_url(
            "https://other.example/episode.mp4",
            &["media.example".into()],
            "media"
        )
        .is_err());
        assert!(validate_provider_url(
            "http://127.0.0.1/episode.mp4",
            &["127.0.0.1".into()],
            "media"
        )
        .is_err());
    }
}
