//! Explicit opt-in checks; a resolving URL alone is not desktop playback proof.
use kuriume_provider::{
    Anime1, PlaybackProvider, PlaybackResolveRequest, PlaybackSearch, ResolvePlan, Xifan,
};

fn query(title: &str, aliases: &[&str], year: u16, count: u32) -> PlaybackSearch {
    PlaybackSearch {
        query: title.into(),
        alternative_titles: aliases.iter().map(|s| s.to_string()).collect(),
        anilist_id: None,
        year: Some(year),
        episode_count: Some(count),
        episode_number: Some(1),
        limit: Some(10),
    }
}

async fn check(provider: &dyn PlaybackProvider, query: PlaybackSearch) {
    let found = provider.search(query).await.unwrap();
    let candidate = found
        .iter()
        .find(|c| c.exact_match)
        .expect("exact catalog match");
    let roads = provider.episodes(&candidate.id).await.unwrap();
    let road = &roads[0];
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .unwrap();
    for number in [1.0, 2.0] {
        let ep = road
            .episodes
            .iter()
            .find(|e| e.episode_number == Some(number))
            .expect("episode number");
        let sources = provider
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
            ..
        } = &sources[0].plan
        else {
            panic!("native media required")
        };
        let original = reqwest::Url::parse(url).unwrap();
        let mut url = original.clone();
        let mut hops = 0;
        let mut response = loop {
            let mut request = client.get(url.clone()).header("Range", "bytes=0-1023");
            for (key, value) in headers {
                if !key.eq_ignore_ascii_case("cookie") || url.origin() == original.origin() {
                    request = request.header(key, value);
                }
            }
            let response = request.send().await.unwrap();
            if !response.status().is_redirection() {
                break response;
            }
            hops += 1;
            assert!(hops <= 3, "bounded media redirects");
            url = url
                .join(response.headers()["location"].to_str().unwrap())
                .unwrap();
            let host = url.host_str().unwrap();
            assert!(
                url.scheme() == "https"
                    && allowed_hosts
                        .iter()
                        .any(|h| host == h || host.ends_with(&format!(".{h}"))),
                "declared CDN only"
            );
        };
        assert!(
            response.status().is_success(),
            "{} media HTTP {}",
            provider.descriptor().display_name,
            response.status()
        );
        let bytes = response.chunk().await.unwrap().unwrap();
        assert!(
            bytes.starts_with(b"#EXTM3U") || bytes.get(4..8) == Some(b"ftyp"),
            "expected MP4 or HLS, not an HTML challenge"
        );
        eprintln!(
            "{} / {} / episode {number}: anonymous media OK",
            provider.descriptor().display_name,
            candidate.title
        );
    }
}

#[tokio::test]
#[ignore = "live anonymous source, explicitly opt in"]
async fn anime1_anonymous_catalog_pagination_and_media() {
    check(
        &Anime1::new(),
        query(
            "葬送的芙莉莲",
            &["Sousou no Frieren", "Frieren: Beyond Journey's End"],
            2023,
            28,
        ),
    )
    .await;
    check(
        &Anime1::new(),
        query(
            "葬送的芙莉蓮 第二季",
            &["Sousou no Frieren 2nd Season"],
            2026,
            10,
        ),
    )
    .await;
}

#[tokio::test]
#[ignore = "live anonymous source, explicitly opt in"]
async fn xifan_anonymous_catalog_and_media() {
    check(
        &Xifan::new(),
        query("葬送的芙莉莲", &["Sousou no Frieren"], 2023, 28),
    )
    .await;
    check(
        &Xifan::new(),
        query(
            "葬送的芙莉莲 第二季",
            &["Sousou no Frieren 2nd Season"],
            2026,
            10,
        ),
    )
    .await;
}
