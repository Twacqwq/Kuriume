//! Bounded, host-scoped HTTP for built-in anonymous playback providers.
use reqwest::{Client, Response, Url};
use scraper::Selector;
use std::time::Duration;

use crate::playback_matching::score_candidate;
use crate::{PlaybackCandidate, PlaybackSearch, ProviderError, Result};

pub(super) fn client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Kuriume/0.1",
        )
        .build()
        .expect("valid provider client")
}

pub(super) fn scoped_url(raw: &str, hosts: &[&str]) -> Result<Url> {
    crate::playback::validate_scoped_url(
        raw,
        &hosts.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
    )?;
    let url = Url::parse(raw).map_err(|_| ProviderError::Parse("Invalid source URL".into()))?;
    if url.scheme() != "https" {
        return Err(ProviderError::Parse("Source must use HTTPS".into()));
    }
    Ok(url)
}

pub(super) async fn text(mut response: Response) -> Result<String> {
    if !response.status().is_success() {
        return Err(ProviderError::Source(format!(
            "Source returned HTTP {}",
            response.status().as_u16()
        )));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| ProviderError::Network(e.without_url().to_string()))?
    {
        if body.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(ProviderError::Parse("Source response is too large".into()));
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| ProviderError::Parse("Invalid source encoding".into()))
}

pub(super) async fn get(client: &Client, raw: &str, host: &str) -> Result<(String, Url)> {
    let mut url = scoped_url(raw, &[host])?;
    for _ in 0..4 {
        let response = client.get(url.clone()).send().await?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| ProviderError::Parse("Source redirect has no destination".into()))?;
            url = scoped_url(
                url.join(location)
                    .map_err(|_| ProviderError::Parse("Invalid source redirect".into()))?
                    .as_str(),
                &[host],
            )?;
            continue;
        }
        return Ok((text(response).await?, url));
    }
    Err(ProviderError::Source("Too many source redirects".into()))
}

pub(super) fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("static provider selector")
}

pub(super) fn positive_id(value: &str, prefix: &str) -> Result<u64> {
    value
        .strip_prefix(prefix)
        .and_then(|id| id.parse::<u64>().ok())
        .filter(|id| *id > 0)
        .ok_or_else(|| ProviderError::Parse("Invalid provider identifier".into()))
}

pub(super) fn rank(
    query: &PlaybackSearch,
    mut candidate: PlaybackCandidate,
    aliases: &[String],
) -> (i32, PlaybackCandidate) {
    let titles: Vec<_> = std::iter::once(query.query.as_str())
        .chain(query.alternative_titles.iter().map(String::as_str))
        .collect();
    let matched = std::iter::once(candidate.title.as_str())
        .chain(aliases.iter().map(String::as_str))
        .map(|title| {
            score_candidate(
                title,
                candidate.year,
                candidate.episode_count,
                &titles,
                query.year,
                query.episode_count,
                query.episode_number,
            )
        })
        .max_by_key(|m| (m.high_confidence, m.score))
        .expect("candidate title");
    candidate.exact_match = matched.high_confidence;
    (matched.score, candidate)
}

pub(super) fn ranked(
    mut found: Vec<(i32, PlaybackCandidate)>,
    query: &PlaybackSearch,
) -> Vec<PlaybackCandidate> {
    found.sort_by(|a, b| b.1.exact_match.cmp(&a.1.exact_match).then(b.0.cmp(&a.0)));
    let floor = found.first().map_or(25, |(best, _)| (best - 55).max(25));
    found
        .into_iter()
        .filter(|(score, _)| *score >= floor)
        .take(query.limit.unwrap_or(20).clamp(1, 20))
        .map(|(_, c)| c)
        .collect()
}
