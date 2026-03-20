use kuriume_provider::{
    AnimeProvider, Bangumi, GetEpisodesQuery, GetListQuery, PagedResult, SearchQuery, SortBy,
};

#[test]
fn bangumi_provider_name() {
    let provider = Bangumi::new();
    assert_eq!(provider.name(), "Bangumi");
}

#[test]
fn bangumi_default_trait() {
    let provider = Bangumi::default();
    assert_eq!(provider.name(), "Bangumi");
}

/// Fetch the anime list for 2024 and verify the paged response.
#[tokio::test]
async fn get_list_basic() {
    let provider = Bangumi::new();
    let query = GetListQuery {
        year: Some(0),
        month: Some(0),
        limit: 5,
        offset: 0,
        soft: Some(SortBy::Rank),
        typ: 2, // anime type
    };

    let result: PagedResult<_> = provider
        .get_list(query)
        .await
        .expect("should fetch anime list");

    assert!(result.total > 0, "total should be > 0");
    assert!(
        !result.data.is_empty(),
        "data should not be empty for 2024 anime"
    );
    assert!(result.data.len() <= 5, "should respect limit");

    // Every item should have an id and title
    for item in &result.data {
        assert!(!item.id.is_empty());
        assert!(!item.title.is_empty());
    }
}

/// Verify pagination offset works by fetching two consecutive pages.
#[tokio::test]
async fn get_list_pagination() {
    let provider = Bangumi::new();

    let page1 = provider
        .get_list(GetListQuery {
            year: Some(2024),
            month: Some(1),
            limit: 3,
            offset: 0,
            soft: Some(SortBy::Rank),
            typ: 2,
        })
        .await
        .expect("page 1");

    let page2 = provider
        .get_list(GetListQuery {
            year: Some(2024),
            month: Some(1),
            limit: 3,
            offset: 3,
            soft: Some(SortBy::Rank),
            typ: 2,
        })
        .await
        .expect("page 2");

    // The two pages should return different items (by id).
    if !page1.data.is_empty() && !page2.data.is_empty() {
        let ids1: Vec<_> = page1.data.iter().map(|a| &a.id).collect();
        let ids2: Vec<_> = page2.data.iter().map(|a| &a.id).collect();
        for id in &ids2 {
            assert!(
                !ids1.contains(id),
                "page 2 should not overlap with page 1, duplicate id: {id}"
            );
        }
    }
}

/// Verify SortBy::Date is accepted without errors.
#[tokio::test]
async fn get_list_sort_by_date() {
    let provider = Bangumi::new();
    let result = provider
        .get_list(GetListQuery {
            year: Some(2024),
            month: Some(0),
            limit: 3,
            offset: 0,
            soft: Some(SortBy::Date),
            typ: 2,
        })
        .await;

    assert!(result.is_ok(), "sort by date should not fail: {result:?}");
}

#[test]
fn sort_by_as_str() {
    assert_eq!(SortBy::Rank.as_str(), "rank");
    assert_eq!(SortBy::Date.as_str(), "date");
}

#[test]
fn sort_by_default_is_rank() {
    let default: SortBy = Default::default();
    assert_eq!(default.as_str(), "rank");
}

#[tokio::test]
async fn get_episodes() {
    let provider = Bangumi::new();

    let result = provider
        .get_episodes(GetEpisodesQuery {
            id: 493016.to_string(),
            limit: 13,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(result.len(), 13);
}

#[tokio::test]
async fn get_characters() {
    let provider = Bangumi::new();

    let result = provider.get_characters(&493016.to_string()).await.unwrap();
    assert!(!result.is_empty())
}

/// Search anime by keyword and verify results.
#[tokio::test]
async fn search_basic() {
    let provider = Bangumi::new();
    let query = SearchQuery {
        keyword: "葬送的芙莉莲".to_string(),
        limit: 5,
        offset: 0,
    };

    let result: PagedResult<_> = provider
        .search(query)
        .await
        .expect("search should succeed");

    assert!(result.total > 0, "should find results for this keyword");
    assert!(!result.data.is_empty(), "data should not be empty");
    assert!(result.data.len() <= 5, "should respect limit");

    // The top result should be related to the search keyword
    let first = &result.data[0];
    assert!(!first.id.is_empty());
    assert!(!first.title.is_empty());
}

/// Fetch the weekly broadcast calendar.
#[tokio::test]
async fn get_calendar() {
    let provider = Bangumi::new();
    let calendar = provider
        .get_calendar()
        .await
        .expect("should fetch calendar");

    // The calendar should contain 7 weekday entries
    assert_eq!(calendar.len(), 7, "calendar should have 7 days");

    for entry in &calendar {
        // Each entry should have a valid weekday id (1–7)
        assert!(
            (1..=7).contains(&entry.weekday.id),
            "weekday id should be 1–7, got {}",
            entry.weekday.id
        );
        assert!(!entry.weekday.cn.is_empty(), "weekday cn should not be empty");

        // Each day should have at least some items
        assert!(!entry.items.is_empty(), "day {} should have items", entry.weekday.cn);

        // Spot-check item fields
        for item in &entry.items {
            assert!(!item.id.is_empty());
            assert!(!item.title.is_empty());
        }
    }
}
