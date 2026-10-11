//! AniList-only search: script variants plus a bundled, ID-based Chinese alias index.
use std::sync::OnceLock;

use super::*;

const SEARCH_BATCH: usize = 50;

#[derive(Deserialize)]
struct AliasSnapshot {
    entries: Vec<(u64, Vec<String>)>,
}

fn aliases() -> &'static [(u64, Vec<String>)] {
    static INDEX: OnceLock<Vec<(u64, Vec<String>)>> = OnceLock::new();
    INDEX.get_or_init(|| {
        let snapshot: AliasSnapshot =
            serde_json::from_str(include_str!("../../data/anilist-chinese.json"))
                .expect("validated bundled AniList aliases");
        snapshot
            .entries
            .into_iter()
            .map(|(id, titles)| (id, titles.iter().map(|title| alias_key(title)).collect()))
            .collect()
    })
}

fn script_variants(keyword: &str) -> Vec<String> {
    let keyword = keyword.trim();
    let mut variants = vec![keyword.to_owned()];
    if keyword.chars().any(is_han) && !contains_kana(keyword) {
        for script in [zhconv::Variant::ZhHans, zhconv::Variant::ZhHant] {
            let value = zhconv::zhconv(keyword, script);
            if !variants.contains(&value) {
                variants.push(value);
            }
        }
    }
    variants
}

fn alias_key(title: &str) -> String {
    let mut title = zhconv::zhconv(title, zhconv::Variant::ZhHans).to_lowercase();
    // Preserve season numbers while equating common Chinese and Roman labels.
    for (index, numeral) in ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
        .iter()
        .enumerate()
    {
        for suffix in ["季", "期"] {
            title = title.replace(&format!("第{numeral}{suffix}"), &(index + 1).to_string());
            title = title.replace(
                &format!("第{}{suffix}", index + 1),
                &(index + 1).to_string(),
            );
        }
    }
    title
        .split(|c: char| !c.is_alphanumeric())
        .map(|part| match part {
            "ii" | "ⅱ" => "2",
            "iii" | "ⅲ" => "3",
            "iv" | "ⅳ" => "4",
            "v" | "ⅴ" => "5",
            "vi" | "ⅵ" => "6",
            _ => part,
        })
        .collect()
}

fn matching_alias_ids(keyword: &str) -> Vec<u64> {
    if !keyword.chars().any(is_han) || contains_kana(keyword) {
        return Vec::new();
    }
    let key = alias_key(keyword);
    if key.chars().count() < 2 {
        return Vec::new();
    }
    let tokens: Vec<_> = keyword
        .split_whitespace()
        .map(alias_key)
        .filter(|s| !s.is_empty())
        .collect();
    let mut matches: Vec<_> = aliases()
        .iter()
        .filter_map(|(id, titles)| {
            let rank = titles
                .iter()
                .filter_map(|title| {
                    let rank = if title == &key {
                        0
                    } else if title.starts_with(&key) {
                        1
                    } else if title.contains(&key) {
                        2
                    } else if tokens.len() > 1 && tokens.iter().all(|token| title.contains(token)) {
                        3
                    } else {
                        return None;
                    };
                    Some((rank, title.chars().count()))
                })
                .min()?;
            Some((rank, *id))
        })
        .collect();
    matches.sort_unstable();
    matches.into_iter().map(|(_, id)| id).collect()
}

#[derive(Deserialize)]
struct SearchIdPage {
    #[serde(rename = "pageInfo")]
    page_info: PageInfo,
    media: Vec<SearchId>,
}

#[derive(Deserialize)]
struct SearchId {
    id: u64,
}

// Interleave ranks, not entire pages, so script duplicates don't shift page 2.
// ponytail: replay ID batches for deep offsets; cache cursors if deep scrolling
// becomes costly. Typical searches need only one small ID batch.
fn merge_id_pages(streams: &[Vec<u64>], ids: &mut Vec<u64>, seen: &mut BTreeSet<u64>) {
    for rank in 0..SEARCH_BATCH {
        for stream in streams {
            if let Some(&id) = stream.get(rank) {
                if seen.insert(id) {
                    ids.push(id);
                }
            }
        }
    }
}

impl AniList {
    pub(super) async fn search_catalog(
        &self,
        query: SearchQuery,
    ) -> Result<PagedResult<AnimeInfo>> {
        let limit = query.limit.clamp(1, 50);
        let offset = query.offset;
        let keyword = query.keyword.trim();
        if keyword.is_empty() {
            return Ok(PagedResult {
                data: Vec::new(),
                total: 0,
                limit,
                offset,
            });
        }
        let variants = script_variants(keyword);
        let local_ids = matching_alias_ids(keyword);
        if variants.len() == 1 && local_ids.is_empty() && offset.is_multiple_of(limit) {
            // Retain a single request for ordinary English/Japanese searches.
            return self
                .page(
                    offset / limit + 1,
                    limit,
                    None,
                    Some(keyword),
                    "SEARCH_MATCH",
                    None,
                )
                .await;
        }

        let target = u64::from(offset) + u64::from(limit) + 1;
        let mut ids = Vec::new();
        let mut seen = BTreeSet::new();
        let mut active = vec![true; variants.len()];
        let mut page = 1;
        let mut local_offset = 0;
        let mut more = true;
        // ID-only batches keep GraphQL complexity and response sizes low; only
        // the requested display page gets full metadata. No cross-site mapping.
        while (ids.len() as u64) < target && more {
            let batch: Vec<_> = local_ids
                .iter()
                .skip(local_offset)
                .take(SEARCH_BATCH)
                .copied()
                .collect();
            local_offset += batch.len();
            let mut declarations = vec!["$page:Int!".to_owned()];
            let mut variables = json!({ "page": page });
            let mut fields = Vec::new();
            if !batch.is_empty() {
                declarations.push("$ids:[Int!]!".into());
                variables["ids"] = json!(batch);
                fields.push("local:Page(perPage:50){pageInfo{total hasNextPage} media(type:ANIME,isAdult:false,id_in:$ids){id}}".to_owned());
            }
            for (index, variant) in variants.iter().enumerate().filter(|(i, _)| active[*i]) {
                declarations.push(format!("$s{index}:String!"));
                variables[format!("s{index}")] = json!(variant);
                fields.push(format!("r{index}:Page(page:$page,perPage:50){{pageInfo{{total hasNextPage}} media(type:ANIME,isAdult:false,search:$s{index},sort:SEARCH_MATCH){{id}}}}"));
            }
            // GraphQL rejects unused variables once only local aliases remain.
            if !active.iter().any(|value| *value) {
                declarations.remove(0);
                variables.as_object_mut().unwrap().remove("page");
            }
            let mut response: HashMap<String, SearchIdPage> = self
                .graphql(
                    format!("query({}){{{}}}", declarations.join(","), fields.join("\n")),
                    variables,
                )
                .await?;
            let mut streams = Vec::new();
            if !batch.is_empty() {
                let local = response.remove("local").ok_or_else(incomplete_search)?;
                let valid: BTreeSet<_> = local.media.into_iter().map(|item| item.id).collect();
                // AniList verifies type/adult availability; preserve local relevance.
                streams.push(batch.into_iter().filter(|id| valid.contains(id)).collect());
            }
            for (index, is_active) in active.iter_mut().enumerate() {
                if !*is_active {
                    continue;
                }
                let result = response
                    .remove(&format!("r{index}"))
                    .ok_or_else(incomplete_search)?;
                *is_active = result.page_info.has_next_page && !result.media.is_empty();
                streams.push(result.media.into_iter().map(|item| item.id).collect());
            }
            merge_id_pages(&streams, &mut ids, &mut seen);
            more = local_offset < local_ids.len() || active.iter().any(|value| *value);
            page += 1;
        }
        // total is a continuation bound until every stream ends, never the sum
        // of overlapping language counts or AniList's estimated search total.
        let total = ids.len() as u64 + u64::from(more);
        let selected: Vec<_> = ids
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect();
        let data = if selected.is_empty() {
            Vec::new()
        } else {
            let response: PageResponse = self.graphql(format!(
                "query($ids:[Int!]!) {{ Page(perPage:50) {{ pageInfo {{ total hasNextPage }} media(type:ANIME,isAdult:false,id_in:$ids) {{ {MEDIA_FIELDS} }} }} }}"
            ), json!({"ids": selected})).await?;
            let mut by_id: HashMap<_, _> = response
                .page
                .media
                .into_iter()
                .map(|media| (media.id, media))
                .collect();
            selected
                .iter()
                .filter_map(|id| by_id.remove(id))
                .map(AnimeInfo::from)
                .collect()
        };
        Ok(PagedResult {
            data,
            total,
            limit,
            offset,
        })
    }
}

fn incomplete_search() -> ProviderError {
    ProviderError::Source("AniList returned incomplete search results".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_scripts_without_rewriting_original_or_duplicating_requests() {
        assert_eq!(
            script_variants(" 葬送的芙莉莲 "),
            ["葬送的芙莉莲", "葬送的芙莉蓮"]
        );
        assert_eq!(script_variants("鬼滅之刃"), ["鬼滅之刃", "鬼灭之刃"]);
        assert_eq!(script_variants("Frieren"), ["Frieren"]);
        assert_eq!(script_variants("葬送のフリーレン"), ["葬送のフリーレン"]);
    }

    #[test]
    fn bundled_aliases_match_names_and_keep_seasons_distinct() {
        assert_eq!(matching_alias_ids("葬送的芙莉莲")[0], 154587);
        assert_eq!(
            matching_alias_ids("葬送的芙莉蓮"),
            matching_alias_ids("葬送的芙莉莲")
        );
        assert!(matching_alias_ids("无职转生 第三季").contains(&178789));
        assert!(matching_alias_ids("无职转生第三季").contains(&178789));
        assert!(!matching_alias_ids("无职转生第二季").contains(&178789));
        assert!(matching_alias_ids("史莱姆").contains(&182205));
        assert!(matching_alias_ids("魔").is_empty());
        assert!(matching_alias_ids("中文不存在的作品名xyz").is_empty());
        let ids: BTreeSet<_> = aliases().iter().map(|(id, _)| *id).collect();
        assert_eq!(ids.len(), aliases().len());
        assert!(ids.len() > 8000);
    }

    #[test]
    fn merged_pagination_deduplicates_overlapping_scripts_without_dropping_later_batches() {
        let mut ids = Vec::new();
        let mut seen = BTreeSet::new();
        merge_id_pages(
            &[vec![1, 2, 3], vec![1, 4, 2], vec![2, 4, 5]],
            &mut ids,
            &mut seen,
        );
        assert_eq!(ids, [1, 2, 4, 3, 5]);
        assert_eq!(&ids[2..4], [4, 3]);
        merge_id_pages(&[vec![3, 6], vec![5, 7]], &mut ids, &mut seen);
        assert_eq!(ids, [1, 2, 4, 3, 5, 6, 7]);

        let mut ids = Vec::new();
        let mut seen = BTreeSet::new();
        merge_id_pages(
            &[(1..=50).collect(), (1..=50).collect()],
            &mut ids,
            &mut seen,
        );
        assert_eq!(ids.len(), 50);
        merge_id_pages(
            &[(51..=100).collect(), (41..=90).collect()],
            &mut ids,
            &mut seen,
        );
        assert_eq!(ids, (1..=100).collect::<Vec<_>>());
    }
}
