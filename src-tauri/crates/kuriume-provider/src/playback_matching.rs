//! Shared conservative title matching when a provider has no catalog-ID match.
//!
//! Season and split-cour markers are compared independently. Metadata can rank
//! a title match, but never turn a merely similar franchise into an exact one.

use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CandidateMatch {
    pub score: i32,
    pub high_confidence: bool,
}

#[derive(Debug, Default)]
struct ParsedTitle {
    words: Vec<String>,
    season: Option<u16>,
    part: Option<u16>,
}

impl ParsedTitle {
    fn base_key(&self) -> String {
        self.words.concat()
    }

    fn search_title(&self) -> String {
        let mut title = self.words.join(" ");
        if let Some(season) = self.season {
            title.push_str(&format!(" season {season}"));
        }
        if let Some(part) = self.part {
            title.push_str(&format!(" part {part}"));
        }
        title
    }
}

/// Raw aliases are tried before variants, so one title cannot crowd all other
/// languages out of the request budget. Results are capped at six requests.
pub(super) fn search_terms(titles: &[&str]) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = BTreeSet::new();
    let mut push = |term: String| {
        let term = term.trim().to_string();
        if !term.is_empty() && seen.insert(term.to_lowercase()) {
            terms.push(term);
        }
    };
    for title in titles.iter().take(4) {
        push(title.trim().to_string());
    }
    for title in titles.iter().take(3) {
        push(parse_title(title).search_title());
    }
    // A short franchise query also recalls sources whose season naming differs
    // from the catalog. The scorer below keeps this broader recall conservative.
    if let Some(title) = titles.first() {
        let parsed = parse_title(title);
        if parsed.season.is_some() || parsed.part.is_some() {
            push(parsed.words.join(" "));
        }
    }
    terms.truncate(6);
    terms
}

pub(super) fn score_candidate(
    candidate: &str,
    candidate_year: Option<u16>,
    available_episodes: Option<u32>,
    titles: &[&str],
    expected_year: Option<u16>,
    expected_episodes: Option<u32>,
    requested_episode: Option<u32>,
) -> CandidateMatch {
    let candidate = parse_title(candidate);
    let aliases: Vec<_> = titles
        .iter()
        .filter(|title| !title.trim().is_empty())
        .map(|title| parse_title(title))
        .collect();
    let seasons: BTreeSet<_> = aliases.iter().filter_map(|title| title.season).collect();
    let parts: BTreeSet<_> = aliases.iter().filter_map(|title| title.part).collect();
    let aliases_conflict = seasons.len() > 1 || parts.len() > 1;
    let candidate_base = candidate.base_key();
    let same_base = !candidate_base.is_empty()
        && aliases
            .iter()
            .any(|alias| alias.base_key() == candidate_base);
    let similarity = aliases
        .iter()
        .map(|alias| title_similarity(&alias.words, &candidate.words))
        .max()
        .unwrap_or(0);
    let expected_season = seasons.first().copied();
    let expected_part = parts.first().copied();
    let season_compatible = match (expected_season, candidate.season) {
        (None, None | Some(1)) | (Some(1), None) => true,
        (Some(expected), Some(actual)) => expected == actual,
        _ => false,
    };
    let part_compatible = expected_part == candidate.part;
    let exact = same_base && season_compatible && part_compatible && !aliases_conflict;
    let mut score = if exact { 140 } else { similarity };
    if !season_compatible {
        score -= 70;
    }
    if !part_compatible {
        score -= 60;
    }
    if aliases_conflict {
        score -= 20;
    }

    let year_compatible = match (expected_year, candidate_year) {
        (Some(expected), Some(actual)) => {
            let distance = expected.abs_diff(actual);
            score += match distance {
                0 => 18,
                1 => 3,
                _ => -40,
            };
            distance <= 1
        }
        _ => true,
    };
    // availableEpisodes means released episodes, not the season's final total.
    // An ongoing, correctly identified season must not lose to a completed one.
    if let (Some(expected), Some(available)) = (expected_episodes, available_episodes) {
        if expected > 0 && available == expected {
            score += 8;
        }
    }
    let episode_available = match (requested_episode, available_episodes) {
        (Some(requested), Some(available)) => requested <= available,
        _ => true,
    };
    if !episode_available {
        score -= 10;
    }

    CandidateMatch {
        score,
        high_confidence: exact && year_compatible && episode_available,
    }
}

#[cfg(test)]
pub(super) fn normalized_title(value: &str) -> String {
    let title = parse_title(value);
    let mut key = title.base_key();
    if let Some(season) = title.season {
        key.push_str(&format!("|season:{season}"));
    }
    if let Some(part) = title.part {
        key.push_str(&format!("|part:{part}"));
    }
    key
}

fn title_similarity(left: &[String], right: &[String]) -> i32 {
    let left: BTreeSet<_> = left.iter().collect();
    let right: BTreeSet<_> = right.iter().collect();
    if left.is_empty() || right.is_empty() {
        return 0;
    }
    let intersection = left.intersection(&right).count();
    i32::try_from(intersection * 160 / (left.len() + right.len())).unwrap_or(0)
}

fn parse_title(value: &str) -> ParsedTitle {
    // Normalize only matching keys; preserve the source's display title.
    let value = season_markers(&zhconv::zhconv(value, zhconv::Variant::ZhHans));
    // Apostrophes are removed rather than split: JoJo's and Jojos are aliases.
    let value: String = value
        .chars()
        .filter(|character| !matches!(character, '\'' | '’' | '‘' | '`' | '´'))
        .collect();
    let raw: Vec<_> = value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let words: Vec<_> = raw.iter().map(|word| word.to_lowercase()).collect();
    let mut used = vec![false; words.len()];
    let mut parsed = ParsedTitle::default();

    for (index, word) in words.iter().enumerate() {
        let marker = match word.as_str() {
            "season" => Some(false),
            "part" | "cour" => Some(true),
            _ => None,
        };
        if let Some(is_part) = marker {
            let next = words
                .get(index + 1)
                .and_then(|word| parse_number(word))
                .map(|number| (index + 1, number));
            let previous = index.checked_sub(1).and_then(|previous| {
                // "2nd Season" is unambiguous; bare preceding numbers also
                // cover "Season 2 Part 2" only when not already consumed.
                (!used[previous])
                    .then(|| parse_number(&words[previous]).map(|number| (previous, number)))
                    .flatten()
            });
            if let Some((number_index, number)) = next.or(previous) {
                used[index] = true;
                used[number_index] = true;
                if is_part {
                    parsed.part = Some(number);
                } else {
                    parsed.season = Some(number);
                }
            }
            continue;
        }
        // "S2" and "Part2" are whole tokens, never substring matches.
        for (prefix, is_part) in [
            ("season", false),
            ("s", false),
            ("part", true),
            ("cour", true),
        ] {
            if let Some(number) = word
                .strip_prefix(prefix)
                .filter(|number| number.chars().all(|character| character.is_ascii_digit()))
                .and_then(parse_number)
            {
                used[index] = true;
                if is_part {
                    parsed.part = Some(number);
                } else {
                    parsed.season = Some(number);
                }
                break;
            }
        }
    }

    if parsed.season.is_none() {
        for (index, word) in raw.iter().enumerate().skip(1) {
            if used[index] || words[index - 1] == "lupin" {
                continue;
            }
            // Roman season suffixes occur at the end, before a subtitle,
            // or immediately before a Part/Cour marker. Other occurrences
            // remain title words ("V Gundam", "III something", "Lupin III").
            let at_end = index + 1 == words.len();
            let before_part = words
                .get(index + 1)
                .is_some_and(|next| matches!(next.as_str(), "part" | "cour"));
            let before_subtitle = value
                .split_once(':')
                .is_some_and(|(prefix, _)| prefix.trim_end().ends_with(word));
            if !(at_end || before_part || before_subtitle) {
                continue;
            }
            let roman = if *word == "x" {
                None
            } else {
                roman_number(&word.to_uppercase())
            };
            if let Some(number) = roman {
                parsed.season = Some(number);
                used[index] = true;
                break;
            }
        }
    }
    parsed.words = words
        .into_iter()
        .enumerate()
        .filter_map(|(index, word)| (!used[index]).then_some(word))
        .collect();
    parsed
}

fn season_markers(value: &str) -> String {
    // Chinese catalog aliases and Japanese 第N期 must agree with Season N;
    // otherwise a correct translated title is rejected merely for its script.
    let mut value = value.to_owned();
    let digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    for n in (1..=30).rev() {
        let han = if n < 10 {
            digits[n].to_string()
        } else {
            format!(
                "{}十{}",
                if n >= 20 { digits[n / 10] } else { "" },
                if n % 10 > 0 { digits[n % 10] } else { "" }
            )
        };
        for number in [n.to_string(), han] {
            for suffix in ["季", "期"] {
                value = value.replace(&format!("第{number}{suffix}"), &format!(" season {n} "));
            }
        }
    }
    value
}

fn parse_number(value: &str) -> Option<u16> {
    let value = value
        .strip_suffix("st")
        .or_else(|| value.strip_suffix("nd"))
        .or_else(|| value.strip_suffix("rd"))
        .or_else(|| value.strip_suffix("th"))
        .unwrap_or(value);
    match value {
        "i" => return Some(1),
        "v" => return Some(5),
        _ => {}
    }
    value
        .parse::<u16>()
        .ok()
        .filter(|number| (1..=99).contains(number))
        .or_else(|| roman_number(&value.to_uppercase()))
}

fn roman_number(value: &str) -> Option<u16> {
    // I and V are frequently ordinary title words; only recognize them after
    // an explicit Season/Part/Cour marker in parse_number.
    match value {
        "II" => Some(2),
        "III" => Some(3),
        "IV" => Some(4),
        "VI" => Some(6),
        "VII" => Some(7),
        "VIII" => Some(8),
        "IX" => Some(9),
        "X" => Some(10),
        "XI" => Some(11),
        "XII" => Some(12),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translated_season_markers_do_not_conflict_with_english_aliases() {
        let titles = ["葬送的芙莉莲 第二季", "Sousou no Frieren 2nd Season"];
        assert!(
            score_candidate(
                titles[0],
                Some(2026),
                Some(10),
                &titles,
                Some(2026),
                Some(10),
                Some(1)
            )
            .high_confidence
        );
        assert!(
            !score_candidate(
                "葬送的芙莉莲 第三季",
                Some(2026),
                Some(10),
                &titles,
                Some(2026),
                Some(10),
                Some(1)
            )
            .high_confidence
        );
        assert_eq!(
            normalized_title("葬送のフリーレン 第2期"),
            normalized_title("葬送のフリーレン Season 2")
        );
    }

    fn score(candidate: &str, titles: &[&str]) -> CandidateMatch {
        score_candidate(
            candidate,
            Some(2026),
            Some(10),
            titles,
            Some(2026),
            Some(24),
            Some(1),
        )
    }

    #[test]
    fn mushoku_roman_and_numbered_seasons_agree_without_matching_an_older_season() {
        let titles = ["Mushoku Tensei III: Isekai Ittara Honki Dasu"];
        assert!(
            score(
                "Mushoku Tensei: Isekai Ittara Honki Dasu 3rd Season",
                &titles
            )
            .high_confidence
        );
        assert!(!score("Mushoku Tensei II: Isekai Ittara Honki Dasu", &titles).high_confidence);
        assert!(!score("Mushoku Tensei: Isekai Ittara Honki Dasu", &titles).high_confidence);
    }

    #[test]
    fn parts_and_seasons_are_independent() {
        let titles = ["Mushoku Tensei II: Isekai Ittara Honki Dasu Part 2"];
        assert!(
            score(
                "Mushoku Tensei: Isekai Ittara Honki Dasu Season 2 Cour 2",
                &titles
            )
            .high_confidence
        );
        assert!(!score("Mushoku Tensei II: Isekai Ittara Honki Dasu", &titles).high_confidence);
        assert!(
            !score(
                "Mushoku Tensei: Isekai Ittara Honki Dasu Season 2 Part 1",
                &titles
            )
            .high_confidence
        );
        assert!(
            !score(
                "Mushoku Tensei III: Isekai Ittara Honki Dasu Part 2",
                &titles
            )
            .high_confidence
        );
    }

    #[test]
    fn season_ten_is_not_season_one() {
        assert!(score("Example Season 10", &["Example 10th Season"]).high_confidence);
        assert!(!score("Example Season 10", &["Example Season 1"]).high_confidence);
        assert!(!score("Example Season 20", &["Example Season 2"]).high_confidence);
        assert_ne!(
            normalized_title("Example S10"),
            normalized_title("Example S1")
        );
        assert_eq!(
            normalized_title("Example iii"),
            normalized_title("Example Season 3")
        );
    }

    #[test]
    fn neutral_alias_cannot_override_an_explicit_season_or_part() {
        assert!(
            !score(
                "Mushoku Tensei",
                &["Mushoku Tensei 3rd Season", "Mushoku Tensei"]
            )
            .high_confidence
        );
        assert!(!score("Example", &["Example Part 2", "Example"]).high_confidence);
        assert!(
            !score(
                "Example Season 2",
                &["Example Season 2", "Example Season 3"]
            )
            .high_confidence
        );
    }

    #[test]
    fn a_correct_airing_show_remains_first_without_claiming_an_unreleased_episode() {
        let titles = ["Tensei Shitara Slime Datta Ken 4th Season"];
        let correct = score_candidate(
            titles[0],
            Some(2026),
            Some(10),
            &titles,
            Some(2026),
            Some(24),
            Some(12),
        );
        let unrelated = score("Tensei Shitara Dragon no Tamago Datta", &titles);
        assert!(!correct.high_confidence);
        assert!(correct.score > unrelated.score + 55);
        assert!(
            score_candidate(
                titles[0],
                Some(2026),
                Some(10),
                &titles,
                Some(2026),
                Some(24),
                Some(10)
            )
            .high_confidence
        );
    }

    #[test]
    fn year_and_token_overlap_do_not_confirm_a_remake_or_different_franchise() {
        assert!(
            !score_candidate(
                "Kanon",
                Some(2002),
                Some(13),
                &["Kanon"],
                Some(2006),
                Some(24),
                Some(1)
            )
            .high_confidence
        );
        assert!(
            !score(
                "Tensei Shitara Dragon no Tamago Datta",
                &["Tensei Shitara Slime Datta Ken"]
            )
            .high_confidence
        );
        assert!(!score("", &[""]).high_confidence);
    }

    #[test]
    fn roman_franchise_names_and_apostrophes_are_preserved() {
        assert!(score("Lupin III Part 6", &["Lupin III Cour 6"]).high_confidence);
        assert!(!score("Lupin Part 6", &["Lupin III Part 6"]).high_confidence);
        assert_eq!(
            normalized_title("JoJo’s Bizarre Adventure"),
            normalized_title("Jojos Bizarre Adventure")
        );
    }

    #[test]
    fn query_variants_preserve_alias_coverage_and_have_a_bounded_budget() {
        let titles = [
            "Mushoku Tensei III: Isekai Ittara Honki Dasu",
            "Mushoku Tensei: Jobless Reincarnation Season 3",
            "无职转生 第三季",
        ];
        let terms = search_terms(&titles);
        assert!(terms.len() <= 6);
        assert_eq!(&terms[..3], &titles);
        assert!(terms.iter().any(|term| term.contains("season 3")));
        assert_eq!(search_terms(&["Example", "example", ""]), vec!["Example"]);
    }
}
