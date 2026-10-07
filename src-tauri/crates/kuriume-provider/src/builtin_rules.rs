//! Built-in rule configs for known online anime streaming sites.
//!
//! Each function returns a [`Rule`] ready to be registered in the engine.

use crate::rule::{Rule, RuleResolver, RuleSelectors};

/// AGE动漫 — <https://www.agedm.io>
pub fn agedm() -> Rule {
    Rule {
        id: "builtin:age".into(),
        schema_version: Rule::CURRENT_SCHEMA_VERSION,
        name: "AGE动漫".into(),
        version: "1".into(),
        author: Some("Kuriume Contributors".into()),
        license: Some("GPL-3.0".into()),
        homepage: Some("https://github.com/Twacqwq/Kuriume".into()),
        base_url: "https://www.agedm.io".into(),
        search_url: "https://www.agedm.io/search?query={keyword}".into(),
        user_agent: String::new(),
        resolver: RuleResolver::Direct,
        allowed_hosts: vec!["agedm.io".into(), "jx.wuzhoupai.com".into()],
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

    #[test]
    fn agedm_has_a_stable_identity() {
        let rule = agedm();

        assert_eq!(rule.id, "builtin:age");
        assert_eq!(rule.schema_version, Rule::CURRENT_SCHEMA_VERSION);
        rule.validate_structure().unwrap();
    }
}
