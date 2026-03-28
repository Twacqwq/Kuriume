/**
 * Online source bridge — Tauri command wrappers for rule-based streaming sites.
 *
 * Manages rules (add/remove/list) and provides search + episode-list for
 * online anime video sites. The actual video URL extraction (m3u8/mp4) is
 * handled by the WebView sniffer hook (`useVideoSniffer`).
 */
import { invoke } from "@tauri-apps/api/core";

// ── Types matching Rust rule module ─────────────────────────────

export interface RuleSelectors {
  searchList: string;
  searchName: string;
  searchLink: string;
  episodeRoad: string;
  episodeItem: string;
  roadName: string;
}

export interface Rule {
  name: string;
  baseUrl: string;
  searchUrl: string;
  userAgent: string;
  selectors: RuleSelectors;
}

export interface OnlineSearchResult {
  name: string;
  url: string;
}

export interface OnlineRoad {
  name: string;
  episodes: OnlineEpisode[];
}

export interface OnlineEpisode {
  name: string;
  url: string;
}

// ── Invoke wrappers ─────────────────────────────────────────────

export const onlineSourceApi = {
  /** List all registered online source names. */
  list: () => invoke<string[]>("online_source_list"),

  /** Get all registered rules. */
  listRules: () => invoke<Rule[]>("online_source_list_rules"),

  /** Add or update a rule. */
  addRule: (rule: Rule) => invoke<void>("online_source_add_rule", { rule }),

  /** Remove a rule by name. */
  removeRule: (name: string) => invoke<void>("online_source_remove_rule", { name }),

  /** Search for anime on a specific online source. */
  search: (source: string, keyword: string) =>
    invoke<OnlineSearchResult[]>("online_source_search", { source, keyword }),

  /** Get episode list (roads) for an anime on a specific online source. */
  getEpisodes: (source: string, pageUrl: string) =>
    invoke<OnlineRoad[]>("online_source_episodes", { source, pageUrl }),

  /**
   * Sniff a video URL from an episode page.
   *
   * Creates a hidden WebView that loads the page, hooks XHR/fetch, and
   * returns the first m3u8/mp4/flv URL found. Times out after 15 seconds.
   */
  sniffVideoUrl: (episodeUrl: string) =>
    invoke<string>("sniff_video_url", { episodeUrl }),
};
