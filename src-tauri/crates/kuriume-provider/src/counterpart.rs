//! Finding a work in one catalog from the titles another catalog saved for
//! it, so entries added under AniList still open when Bangumi is the chosen
//! source (and the other way round).
use std::collections::HashSet;

use crate::anilist::title_key;
use crate::error::Result;
use crate::models::{AnimeInfo, MediaKind, SearchQuery};
use crate::provider::AnimeProvider;

/// Searches cost catalog requests; a few distinct titles are plenty.
const MAX_SEARCHES: usize = 3;
const RESULTS_PER_SEARCH: u32 = 20;

/// The `catalog` entry of `kind` whose titles equal one of `titles` (after
/// normalisation), or `None`. Only exact title matches count: a wrong match
/// would merge two works' history, so no match is the safer answer.
pub async fn find_counterpart(
    catalog: &dyn AnimeProvider,
    kind: MediaKind,
    titles: &[String],
    total_episodes: u32,
) -> Result<Option<AnimeInfo>> {
    let wanted: HashSet<String> = titles
        .iter()
        .map(|title| title_key(title))
        .filter(|key| !key.is_empty())
        .collect();
    let mut searched = HashSet::new();
    for keyword in titles.iter().map(|title| title.trim()) {
        let key = title_key(keyword);
        if key.is_empty() || !searched.insert(key) {
            continue;
        }
        if searched.len() > MAX_SEARCHES {
            break;
        }
        let query = SearchQuery {
            keyword: keyword.to_owned(),
            offset: 0,
            limit: RESULTS_PER_SEARCH,
            kind,
        };
        let page = catalog.search(query, None).await?;
        let candidates = page
            .data
            .into_iter()
            .filter(|info| info.kind == kind)
            .collect();
        if let Some(found) = best_match(candidates, &wanted, total_episodes) {
            return Ok(Some(found));
        }
    }
    Ok(None)
}

/// Among title matches, prefer the one with the same episode count: it tells
/// a TV series from a same-named film or remake.
fn best_match(
    candidates: Vec<AnimeInfo>,
    wanted: &HashSet<String>,
    total_episodes: u32,
) -> Option<AnimeInfo> {
    let mut matches: Vec<AnimeInfo> = candidates
        .into_iter()
        .filter(|candidate| names(candidate).any(|key| wanted.contains(&key)))
        .collect();
    if total_episodes > 0 {
        if let Some(index) = matches
            .iter()
            .position(|candidate| candidate.total_episodes == total_episodes)
        {
            return Some(matches.swap_remove(index));
        }
    }
    matches.into_iter().next()
}

fn names(info: &AnimeInfo) -> impl Iterator<Item = String> + '_ {
    [
        Some(&info.title),
        Some(&info.title_en),
        info.title_cn.as_ref(),
        info.title_native.as_ref(),
    ]
    .into_iter()
    .flatten()
    .chain(info.search_titles.iter())
    .map(|title| title_key(title))
    .filter(|key| !key.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, title_cn: &str, episodes: u32) -> AnimeInfo {
        serde_json::from_value(serde_json::json!({
            "id": id, "anilist_id": 0, "mal_id": null, "title": "", "title_en": "",
            "title_cn": title_cn, "title_native": null, "cover": null, "banner": null,
            "score": null, "year": null, "total_episodes": episodes, "air_date": null,
            "genres": [], "description": null, "description_cn": null, "description_ja": null,
            "status": null, "format": null, "studios": []
        }))
        .unwrap()
    }

    fn keys(titles: &[&str]) -> HashSet<String> {
        titles.iter().map(|title| title_key(title)).collect()
    }

    #[test]
    fn matches_titles_across_script_and_season_labels() {
        let found = best_match(
            vec![
                info("bangumi:1", "葬送的芙莉莲 第二季", 12),
                info("bangumi:2", "葬送的芙莉莲", 28),
            ],
            &keys(&["葬送的芙莉蓮"]),
            28,
        );
        assert_eq!(found.unwrap().id, "bangumi:2");
        let second = best_match(
            vec![info("bangumi:1", "葬送的芙莉莲 第二季", 12)],
            &keys(&["葬送的芙莉莲 2"]),
            0,
        );
        assert_eq!(second.unwrap().id, "bangumi:1");
    }

    #[test]
    fn prefers_the_same_episode_count_and_rejects_partial_titles() {
        let candidates = vec![
            info("bangumi:1", "水果篮子", 26),
            info("bangumi:2", "水果篮子", 25),
        ];
        assert_eq!(
            best_match(candidates, &keys(&["水果篮子"]), 25).unwrap().id,
            "bangumi:2"
        );
        assert!(best_match(
            vec![info("bangumi:3", "孤独摇滚！剧场总集篇", 1)],
            &keys(&["孤独摇滚！"]),
            12
        )
        .is_none());
    }
}
