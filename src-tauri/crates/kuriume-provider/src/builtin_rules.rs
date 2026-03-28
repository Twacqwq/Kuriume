//! Built-in rule configs for known online anime streaming sites.
//!
//! Each function returns a [`Rule`] ready to be registered in the engine.

use crate::rule::{Rule, RuleSelectors};

/// AGE动漫 — <https://www.agedm.io>
pub fn agedm() -> Rule {
    Rule {
        name: "AGE动漫".into(),
        base_url: "https://www.agedm.io".into(),
        search_url: "https://www.agedm.io/search?query={keyword}".into(),
        user_agent: String::new(),
        selectors: RuleSelectors {
            search_list: "#cata_video_list .cata_video_item".into(),
            search_name: ".card-title a".into(),
            search_link: ".card-title a".into(),
            episode_road: ".tab-content .tab-pane".into(),
            episode_item: ".video_detail_spisode_link".into(),
            road_name: ".nav-pills .nav-item button".into(),
        },
    }
}

/// Returns all built-in rules.
pub fn all() -> Vec<Rule> {
    vec![agedm()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_rules_are_valid() {
        for rule in all() {
            assert!(!rule.name.is_empty());
            assert!(!rule.base_url.is_empty());
            assert!(rule.search_url.contains("{keyword}"));
        }
    }
}
