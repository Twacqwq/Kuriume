//! Header-aware, range-bounded media transport for native playback.
//!
//! Providers with header-dependent assets register a validated remote URL and
//! return only an opaque local URL to the renderer. Authorization query strings
//! never enter frontend state, history, or logs.

use kuriume_provider::PlaybackHeaders;
use reqwest::header::{
    HeaderName, HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    LAST_MODIFIED, RANGE,
};
use ring::rand::{SecureRandom, SystemRandom};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;

#[cfg(target_os = "macos")]
mod loopback;

const SESSION_LIMIT: usize = 64;
const SESSION_TTL_MS: u64 = 12 * 60 * 60 * 1_000;
const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_HLS_BYTES: usize = 32 * 1024 * 1024;
const RESOURCE_LIMIT: usize = 8_192;

#[derive(Clone)]
pub struct MediaProxyState {
    inner: Arc<MediaProxyInner>,
}

struct MediaProxyInner {
    client: reqwest::Client,
    sessions: Mutex<HashMap<String, MediaSession>>,
    #[cfg(target_os = "macos")]
    loopback: Mutex<Option<loopback::Server>>,
}

#[derive(Clone)]
struct MediaSession {
    token: String,
    url: reqwest::Url,
    headers: PlaybackHeaders,
    cookie_origin: String,
    mime_type: String,
    created_at: u64,
    allowed_hosts: Vec<String>,
    resources: Arc<Mutex<HashMap<String, reqwest::Url>>>,
    full_resource: bool,
}

impl MediaProxyState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build media proxy HTTP client");
        Self {
            inner: Arc::new(MediaProxyInner {
                client,
                sessions: Mutex::new(HashMap::new()),
                #[cfg(target_os = "macos")]
                loopback: Mutex::new(None),
            }),
        }
    }

    pub fn register(
        &self,
        raw_url: &str,
        headers: PlaybackHeaders,
        allowed_hosts: &[String],
        mime_type: Option<&str>,
    ) -> Result<String, String> {
        let url = validate_remote_url(raw_url, allowed_hosts)?;
        let created_at = unix_time_ms();
        let token = random_token()?;
        let session = MediaSession {
            token: token.clone(),
            cookie_origin: url.origin().ascii_serialization(),
            url,
            headers,
            mime_type: mime_type.unwrap_or("video/mp4").to_string(),
            created_at,
            allowed_hosts: allowed_hosts.to_vec(),
            resources: Arc::new(Mutex::new(HashMap::new())),
            full_resource: mime_type.is_some_and(|mime| {
                mime.contains("mpegurl") || mime.contains("mpegURL") || mime == "text/vtt"
            }),
        };
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .map_err(|_| "Media proxy state is unavailable".to_string())?;
        sessions
            .retain(|_, session| created_at.saturating_sub(session.created_at) <= SESSION_TTL_MS);
        if sessions.len() >= SESSION_LIMIT {
            if let Some(oldest) = sessions
                .iter()
                .min_by_key(|(_, session)| session.created_at)
                .map(|(token, _)| token.clone())
            {
                sessions.remove(&oldest);
            }
        }
        sessions.insert(token.clone(), session);
        drop(sessions);
        // WKWebView's custom-scheme MP4 path can advance audio/time while
        // dropping almost all video frames. AVFoundation's HTTP path does not.
        // Keep HLS/subtitles on the existing fetch-based custom protocol.
        #[cfg(target_os = "macos")]
        if mime_type.unwrap_or("video/mp4") == "video/mp4" {
            return Ok(format!("http://{}/{token}", self.loopback_address()?));
        }
        Ok(local_media_url(&token))
    }

    pub fn respond(&self, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
        let proxy = self.clone();
        tauri::async_runtime::spawn(async move {
            responder.respond(proxy.response(request).await);
        });
    }

    async fn response(&self, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
        let path = request.uri().path().trim_start_matches('/');
        let (token, resource) = path
            .split_once('/')
            .map_or((path, None), |(token, resource)| (token, Some(resource)));
        let session = self.inner.sessions.lock().ok().and_then(|mut sessions| {
            let now = unix_time_ms();
            sessions.retain(|_, session| now.saturating_sub(session.created_at) <= SESSION_TTL_MS);
            let mut session = sessions.get(token)?.clone();
            if let Some(resource) = resource {
                let url = session.resources.lock().ok()?.get(resource)?.clone();
                session.url = url;
                session.mime_type = "application/octet-stream".into();
                session.full_resource = true;
            }
            Some(session)
        });
        match session {
            Some(session) => proxy_request(self.inner.client.clone(), request, session).await,
            None => error_response(StatusCode::NOT_FOUND, "Media session not found"),
        }
    }
}

impl Default for MediaProxyState {
    fn default() -> Self {
        Self::new()
    }
}

async fn proxy_request(
    client: reqwest::Client,
    request: Request<Vec<u8>>,
    mut session: MediaSession,
) -> Response<Vec<u8>> {
    if request.method() == tauri::http::Method::OPTIONS {
        return cors_response(StatusCode::NO_CONTENT, Vec::new());
    }
    if !matches!(
        *request.method(),
        tauri::http::Method::GET | tauri::http::Method::HEAD
    ) {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }

    let requested_range = request
        .headers()
        .get(RANGE.as_str())
        .and_then(|value| value.to_str().ok());
    let range = if request.method() == tauri::http::Method::GET
        && (!session.full_resource || requested_range.is_some())
    {
        match normalize_range_with_limit(
            requested_range,
            if session.full_resource {
                MAX_HLS_BYTES as u64
            } else {
                MAX_RANGE_BYTES
            },
        ) {
            Ok(range) => Some(range),
            Err(()) => {
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header("access-control-allow-origin", "*")
                    .body(Vec::new())
                    .unwrap_or_default()
            }
        }
    } else {
        None
    };
    let mut redirects = 0;
    let mut upstream = loop {
        let mut upstream = client.request(request.method().clone(), session.url.clone());
        for (name, value) in &session.headers {
            if !matches!(
                name.to_ascii_lowercase().as_str(),
                "origin" | "referer" | "user-agent" | "accept" | "accept-language" | "cookie"
            ) {
                continue;
            }
            // Anonymous media cookies stay in this in-memory session and on the
            // exact initial origin, never another CDN referenced by an HLS playlist.
            if !cookie_is_scoped(name, &session) {
                continue;
            }
            let Ok(name) = HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            if matches!(name, RANGE | CONTENT_LENGTH) {
                continue;
            }
            let Ok(value) = HeaderValue::from_str(value) else {
                continue;
            };
            upstream = upstream.header(name, value);
        }
        if let Some(range) = &range {
            upstream = upstream.header(RANGE, range);
        }
        let upstream = match upstream.send().await {
            Ok(response) => response,
            Err(_) => return error_response(StatusCode::BAD_GATEWAY, "Unable to reach media host"),
        };
        if !upstream.status().is_redirection() {
            break upstream;
        }
        if redirects >= 3 {
            return error_response(StatusCode::BAD_GATEWAY, "Too many media redirects");
        }
        let next = upstream
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok())
            .and_then(|location| session.url.join(location).ok())
            .and_then(|url| validate_remote_url(url.as_str(), &session.allowed_hosts).ok());
        let Some(next) = next else {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "Media redirect left the declared source scope",
            );
        };
        session.url = next;
        redirects += 1;
    };
    if upstream.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let mut builder = Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header("access-control-allow-origin", "*")
            .header("access-control-expose-headers", "Content-Range")
            .header("cache-control", "no-store");
        if let Some(value) = upstream.headers().get(CONTENT_RANGE) {
            builder = builder.header(CONTENT_RANGE.as_str(), value.as_bytes());
        }
        return builder.body(Vec::new()).unwrap_or_default();
    }
    if !upstream.status().is_success() {
        let status =
            StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        return error_response(status, "Media host rejected the request");
    }
    let max_body = if session.full_resource {
        MAX_HLS_BYTES
    } else {
        MAX_RANGE_BYTES as usize
    };
    if request.method() == tauri::http::Method::GET
        && upstream
            .content_length()
            .is_some_and(|length| length > max_body as u64)
    {
        return error_response(
            StatusCode::BAD_GATEWAY,
            "Media host returned an oversized media chunk",
        );
    }

    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers = upstream.headers().clone();
    let mut body = if request.method() == tauri::http::Method::HEAD {
        Vec::new()
    } else {
        let mut body = Vec::new();
        loop {
            match upstream.chunk().await {
                Ok(Some(chunk)) if body.len().saturating_add(chunk.len()) <= max_body => {
                    body.extend_from_slice(&chunk);
                }
                Ok(Some(_)) => {
                    return error_response(StatusCode::BAD_GATEWAY, "Media chunk is too large")
                }
                Ok(None) => break body,
                Err(_) => {
                    return error_response(StatusCode::BAD_GATEWAY, "Unable to read media chunk")
                }
            }
        }
    };

    if body.starts_with(b"#EXTM3U") {
        body = match rewrite_playlist(&body, &session) {
            Ok(body) => body,
            Err(error) => return error_response(StatusCode::BAD_GATEWAY, &error),
        };
        // Rewritten manifests have their own length and must not retain the
        // upstream range, ETag or Content-Length of the original document.
        return Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE.as_str(), "application/vnd.apple.mpegurl")
            .header(CONTENT_LENGTH.as_str(), body.len())
            .header("access-control-allow-origin", "*")
            .header("cache-control", "no-store")
            .body(body)
            .unwrap_or_default();
    }
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or(&session.mime_type);
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE.as_str(), content_type)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header("access-control-allow-headers", "Range")
        .header(
            "access-control-expose-headers",
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag",
        )
        .header("cache-control", "no-store")
        .header(ACCEPT_RANGES.as_str(), "bytes");
    for name in [CONTENT_LENGTH, CONTENT_RANGE, ETAG, LAST_MODIFIED] {
        if let Some(value) = headers.get(&name) {
            builder = builder.header(name.as_str(), value.as_bytes());
        }
    }
    builder.body(body).unwrap_or_else(|_| {
        error_response(StatusCode::INTERNAL_SERVER_ERROR, "Proxy response failed")
    })
}

fn cookie_is_scoped(name: &str, session: &MediaSession) -> bool {
    !name.eq_ignore_ascii_case("cookie")
        || session.url.origin().ascii_serialization() == session.cookie_origin
}

#[cfg(test)]
fn normalize_range(value: Option<&str>) -> Result<String, ()> {
    normalize_range_with_limit(value, MAX_RANGE_BYTES)
}

fn normalize_range_with_limit(value: Option<&str>, limit: u64) -> Result<String, ()> {
    let value = value.unwrap_or("bytes=0-");
    let range = value.strip_prefix("bytes=").ok_or(())?;
    if range.is_empty() || range.contains(',') || range.contains(char::is_whitespace) {
        return Err(());
    }
    let (start, end) = range.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        return Ok(format!("bytes=-{}", suffix.min(limit)));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    let max_end = start.checked_add(limit - 1).ok_or(())?;
    let requested_end = if end.is_empty() {
        max_end
    } else {
        end.parse::<u64>().map_err(|_| ())?
    };
    if requested_end < start {
        return Err(());
    }
    Ok(format!("bytes={start}-{}", requested_end.min(max_end)))
}

fn rewrite_playlist(bytes: &[u8], session: &MediaSession) -> Result<Vec<u8>, String> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("HLS playlist is too large".into());
    }
    let playlist = std::str::from_utf8(bytes).map_err(|_| "Invalid HLS text")?;
    let mut resources = session
        .resources
        .lock()
        .map_err(|_| "Media resources unavailable")?;
    let mut register = |raw: &str| -> Result<String, String> {
        let url = session
            .url
            .join(raw)
            .map_err(|_| "Invalid HLS resource URL")?;
        validate_remote_url(url.as_str(), &session.allowed_hosts)?;
        let digest = ring::digest::digest(&ring::digest::SHA256, url.as_str().as_bytes());
        let id: String = digest.as_ref()[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        if !resources.contains_key(&id) && resources.len() >= RESOURCE_LIMIT {
            return Err("Too many HLS resources".into());
        }
        resources.insert(id.clone(), url);
        Ok(format!("{}/{id}", local_media_url(&session.token)))
    };
    let mut result = String::new();
    for line in playlist.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            // Includes alternate audio/subtitles, initialization maps and keys.
            // A changed/DRM format remains unsupported; no license acquisition.
            if (line.starts_with("#EXT-X-KEY:") || line.starts_with("#EXT-X-SESSION-KEY:"))
                && !line.contains("METHOD=NONE")
                && !line.contains("METHOD=AES-128")
            {
                return Err("Unsupported encrypted HLS stream".into());
            }
            let mut remaining = line;
            while let Some((before, after)) = remaining.split_once("URI=\"") {
                let (uri, rest) = after.split_once('"').ok_or("Invalid HLS URI attribute")?;
                result.push_str(before);
                result.push_str("URI=\"");
                result.push_str(&register(uri)?);
                result.push('"');
                remaining = rest;
            }
            result.push_str(remaining);
        } else if !line.is_empty() {
            result.push_str(&register(line)?);
        }
        result.push('\n');
    }
    Ok(result.into_bytes())
}

fn validate_remote_url(raw: &str, allowed_hosts: &[String]) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid media URL".to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("Only credential-free HTTPS media URLs are supported".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Media URL has no host".to_string())?;
    if !allowed_hosts
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed.trim().trim_matches('.')))
    {
        return Err("Media URL host is not declared by this provider".into());
    }
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("Local media URLs are not allowed".into());
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        if is_private_or_local_ip(ip) {
            return Err("Private and local media URLs are not allowed".into());
        }
    }
    Ok(url)
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

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "Unable to create a media session".to_string())?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push(HEX[(byte >> 4) as usize] as char);
        token.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(token)
}

fn local_media_url(token: &str) -> String {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        format!("http://kuriume-media.localhost/{token}")
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        format!("kuriume-media://localhost/{token}")
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or_default()
}

fn cors_response(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header("access-control-allow-headers", "Range")
        .body(body)
        .unwrap_or_default()
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE.as_str(), "text/plain; charset=utf-8")
        .header("access-control-allow-origin", "*")
        .header("cache-control", "no-store")
        .body(message.as_bytes().to_vec())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use kuriume_provider::{PlaybackProvider, PlaybackResolveRequest, ResolvePlan};

    fn hls_session() -> MediaSession {
        MediaSession {
            token: "test-hls".into(),
            url: "https://media.example/show/master.m3u8".parse().unwrap(),
            headers: PlaybackHeaders::new(),
            cookie_origin: "https://media.example".into(),
            mime_type: "application/vnd.apple.mpegurl".into(),
            created_at: unix_time_ms(),
            allowed_hosts: vec!["media.example".into(), "cdn.example".into()],
            resources: Arc::new(Mutex::new(HashMap::new())),
            full_resource: true,
        }
    }

    #[test]
    fn anonymous_video_cookies_never_follow_cross_origin_resources() {
        let mut session = hls_session();
        assert!(cookie_is_scoped("Cookie", &session));
        session.url = "https://cdn.example/segment.ts".parse().unwrap();
        assert!(!cookie_is_scoped("Cookie", &session));
        assert!(cookie_is_scoped("Referer", &session));
        session.url = "https://media.example:8443/video.mp4".parse().unwrap();
        assert!(!cookie_is_scoped("cookie", &session));
    }

    #[test]
    fn hls_rewrites_relative_playlists_segments_and_uri_attributes() {
        let session = hls_session();
        let input = b"#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio/main.m3u8\"\n720/index.m3u8\n#EXT-X-MAP:URI=\"init.mp4\"\nhttps://cdn.example/segment.ts.jpg\n";
        let first = rewrite_playlist(input, &session).unwrap();
        let second = rewrite_playlist(input, &session).unwrap();
        assert_eq!(
            first, second,
            "resource URLs remain stable across playlist reloads"
        );
        let output = String::from_utf8(first).unwrap();
        assert!(!output.contains("https://"));
        assert_eq!(output.matches(&local_media_url("test-hls")).count(), 4);
        let resources = session.resources.lock().unwrap();
        assert_eq!(resources.len(), 4);
        assert!(resources
            .values()
            .any(|url| url.as_str() == "https://media.example/show/720/index.m3u8"));
    }

    #[test]
    fn hls_cannot_expand_host_scope_or_acquire_drm() {
        let session = hls_session();
        for input in [
            "#EXTM3U\nhttps://evil.example/segment.ts\n",
            "#EXTM3U\nhttp://127.0.0.1/private\n",
            "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"license\"\n",
        ] {
            assert!(rewrite_playlist(input.as_bytes(), &session).is_err());
        }
    }

    #[tokio::test]
    #[ignore = "live anonymous providers through the desktop media transport"]
    async fn live_anonymous_providers_proxy_chain() {
        let providers: Vec<Box<dyn PlaybackProvider>> = vec![
            Box::new(kuriume_provider::Anime1::new()),
            Box::new(kuriume_provider::Xifan::new()),
        ];
        for provider in providers {
            let candidates = provider
                .search(kuriume_provider::PlaybackSearch {
                    query: "葬送的芙莉莲".into(),
                    alternative_titles: vec!["Sousou no Frieren".into()],
                    anilist_id: None,
                    year: Some(2023),
                    episode_count: Some(28),
                    episode_number: Some(1),
                    limit: None,
                })
                .await
                .unwrap();
            let candidate = candidates.iter().find(|c| c.exact_match).unwrap();
            let roads = provider.episodes(&candidate.id).await.unwrap();
            let road = &roads[0];
            let ep = road
                .episodes
                .iter()
                .find(|ep| ep.episode_number == Some(1.0))
                .unwrap();
            let plans = provider
                .resolve(PlaybackResolveRequest {
                    candidate_id: candidate.id.clone(),
                    road_id: road.id.clone(),
                    episode_id: ep.id.clone(),
                })
                .await
                .unwrap();
            let ResolvePlan::Direct {
                url,
                headers,
                allowed_hosts,
                mime_type,
                ..
            } = &plans[0].plan
            else {
                panic!()
            };
            let proxy = MediaProxyState::new();
            let local = proxy
                .register(url, headers.clone(), allowed_hosts, mime_type.as_deref())
                .unwrap();
            #[cfg(target_os = "macos")]
            if local.starts_with("http://127.0.0.1:") {
                let response = reqwest::Client::new()
                    .get(&local)
                    .header("Range", "bytes=0-1023")
                    .header("Origin", "tauri://localhost")
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
                assert_eq!(response.content_length(), Some(1024));
                assert_eq!(
                    response.bytes().await.unwrap().get(4..8),
                    Some(&b"ftyp"[..])
                );
            }
            let token = local.rsplit('/').next().unwrap();
            let mut session = proxy.inner.sessions.lock().unwrap()[token].clone();
            for stage in 0..4 {
                let request = Request::builder().uri(&local).body(Vec::new()).unwrap();
                let response =
                    proxy_request(proxy.inner.client.clone(), request, session.clone()).await;
                assert!(
                    response.status().is_success(),
                    "{} stage {stage}: {} {}",
                    provider.descriptor().display_name,
                    response.status(),
                    String::from_utf8_lossy(response.body())
                );
                if !response.body().starts_with(b"#EXTM3U") {
                    assert!(response.body().len() > 188);
                    assert!(
                        response.body().get(4..8) == Some(b"ftyp") || response.body()[0] == 0x47
                    );
                    eprintln!(
                        "{}: native transport stage {stage} OK",
                        provider.descriptor().display_name
                    );
                    break;
                }
                assert!(stage < 3, "bounded HLS nesting");
                let text = std::str::from_utf8(response.body()).unwrap();
                let child = text
                    .lines()
                    .find(|s| !s.is_empty() && !s.starts_with('#'))
                    .unwrap();
                let key = child.rsplit('/').next().unwrap();
                let url = session.resources.lock().unwrap()[key].clone();
                eprintln!(
                    "{}: HLS child host {}",
                    provider.descriptor().display_name,
                    url.host_str().unwrap()
                );
                session.url = url;
                session.mime_type = "application/octet-stream".into();
                session.full_resource = true;
            }
        }
    }

    #[tokio::test]
    #[ignore = "live HiAnime manifest, child playlist and one bounded media segment"]
    async fn live_hianime_hls_proxy_chain() {
        let provider = kuriume_provider::HiAnime::new();
        let roads = provider
            .episodes("hianime:frieren-beyond-journeys-end-481")
            .await
            .unwrap();
        let plans = provider
            .resolve(PlaybackResolveRequest {
                candidate_id: "hianime:frieren-beyond-journeys-end-481".into(),
                road_id: "sub".into(),
                episode_id: roads[0].episodes[0].id.clone(),
            })
            .await
            .unwrap();
        let ResolvePlan::Direct {
            url,
            headers,
            allowed_hosts,
            mime_type,
            ..
        } = &plans[0].plan
        else {
            panic!()
        };
        let proxy = MediaProxyState::new();
        let local = proxy
            .register(url, headers.clone(), allowed_hosts, mime_type.as_deref())
            .unwrap();
        let token = local.rsplit('/').next().unwrap();
        let mut session = proxy.inner.sessions.lock().unwrap()[token].clone();
        // Exercise the exact handler used by the desktop WebView, without
        // claiming that HTTP success alone proves browser decoding.
        for stage in 0..3 {
            let request = Request::builder().uri(&local).body(Vec::new()).unwrap();
            let response =
                proxy_request(proxy.inner.client.clone(), request, session.clone()).await;
            assert_eq!(response.status(), StatusCode::OK, "stage {stage}");
            if stage == 2 {
                assert!(response.body().len() > 188);
                assert_eq!(response.body()[0], 0x47);
                assert_eq!(response.body()[188], 0x47);
                eprintln!(
                    "HiAnime proxy: master -> variant -> complete TS segment ({} bytes)",
                    response.body().len()
                );
                break;
            }
            let text = std::str::from_utf8(response.body()).unwrap();
            assert!(text.starts_with("#EXTM3U"));
            let child = text
                .lines()
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .unwrap();
            let key = child.rsplit('/').next().unwrap();
            let url = session.resources.lock().unwrap()[key].clone();
            session.url = url;
            session.mime_type = "application/octet-stream".into();
        }
    }

    #[test]
    fn range_requests_are_bounded_to_four_megabytes() {
        assert_eq!(
            normalize_range(Some("bytes=100-")),
            Ok(format!("bytes=100-{}", 100 + MAX_RANGE_BYTES - 1))
        );
        assert_eq!(normalize_range(Some("bytes=8-12")), Ok("bytes=8-12".into()));
        assert_eq!(normalize_range(Some("bytes=-500")), Ok("bytes=-500".into()));
        assert!(normalize_range(Some("bytes=garbage")).is_err());
        assert!(normalize_range(Some("bytes=12-8")).is_err());
        assert!(normalize_range(Some("bytes=0-1,5-6")).is_err());
    }

    #[test]
    fn registered_urls_require_an_exact_declared_public_host() {
        assert!(validate_remote_url(
            "https://media.example/media.mp4?Authorization=redacted",
            &["media.example".into()]
        )
        .is_ok());
        assert!(validate_remote_url(
            "https://media.example.evil.test/media.mp4",
            &["media.example".into()]
        )
        .is_err());
        assert!(validate_remote_url("https://127.0.0.1/media.mp4", &["127.0.0.1".into()]).is_err());
    }
}
