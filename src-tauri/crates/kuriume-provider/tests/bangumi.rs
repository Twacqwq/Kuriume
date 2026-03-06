use kuriume_provider::{AnimeProvider, Bangumi, GetListQuery, PagedResult, SortBy};

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
        year: 0,
        month: 0,
        limit: 5,
        offset: 0,
        soft: SortBy::Rank,
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
            year: 2024,
            month: 1,
            limit: 3,
            offset: 0,
            soft: SortBy::Rank,
            typ: 2,
        })
        .await
        .expect("page 1");

    let page2 = provider
        .get_list(GetListQuery {
            year: 2024,
            month: 1,
            limit: 3,
            offset: 3,
            soft: SortBy::Rank,
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
            year: 2024,
            month: 0,
            limit: 3,
            offset: 0,
            soft: SortBy::Date,
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
