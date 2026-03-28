//! Integration tests for the agedm.io rule against the live site.
//!
//! These tests require network access and may fail if the site changes layout.
//! Run with: cargo test -p kuriume-provider --test agedm -- --nocapture

use kuriume_provider::{builtin_rules, RuleEngine};

fn engine() -> RuleEngine {
    RuleEngine::new(builtin_rules::agedm())
}

#[tokio::test]
async fn search_returns_results() {
    let results = engine().search("孤独摇滚").await.unwrap();
    assert!(!results.is_empty(), "search should return at least one result");

    let first = &results[0];
    assert!(
        first.name.contains("孤独摇滚"),
        "first result name should contain the keyword: got '{}'",
        first.name
    );
    assert!(
        first.url.contains("/detail/"),
        "result URL should be a detail link: got '{}'",
        first.url
    );

    println!("Search results:");
    for r in &results {
        println!("  {} -> {}", r.name, r.url);
    }
}

#[tokio::test]
async fn get_episodes_returns_roads() {
    let roads = engine()
        .get_episodes("https://www.agedm.io/detail/20220121")
        .await
        .unwrap();

    assert!(!roads.is_empty(), "should have at least one road");

    for road in &roads {
        println!("Road: {} ({} episodes)", road.name, road.episodes.len());
        assert!(!road.episodes.is_empty());
        for ep in &road.episodes {
            println!("  {} -> {}", ep.name, ep.url);
            assert!(ep.url.contains("/play/"), "episode URL should contain /play/");
        }
    }

    // Verify the first road has at least the expected episodes
    let first_road = &roads[0];
    assert!(
        first_road.episodes.len() >= 12,
        "孤独摇滚 should have at least 12 episodes, got {}",
        first_road.episodes.len()
    );

    // Verify road names come from the nav pills (not generic)
    let first_name = &roads[0].name;
    println!("First road name: {first_name}");
    // agedm.io names their playlists with source names like "VIP 西瓜", "红牛" etc.
    assert!(
        !first_name.starts_with("播放列表"),
        "road name should come from nav pills, not be generic"
    );
}
