/**
 * Provider-neutral playback-source bridge.
 *
 * Catalog metadata and playback sources are deliberately separate: callers
 * search a provider, select its opaque candidate/road/episode identities, and
 * ask the desktop security boundary to resolve the final playable asset.
 */
import type { PlayableSource } from "@/lib/playback";
import { invoke } from "@tauri-apps/api/core";

export type PlaybackProviderId = string;

export interface PlaybackProviderCapabilities {
  search: boolean;
  episodes: boolean;
  direct: boolean;
  sniff: boolean;
}

export interface PlaybackProviderDescriptor {
  id: PlaybackProviderId;
  displayName: string;
  builtIn: boolean;
  capabilities: PlaybackProviderCapabilities;
}

export interface PlaybackSearch {
  query: string;
  anilistId?: number | null;
  alternativeTitles?: string[];
  year?: number | null;
  episodeCount?: number | null;
  episodeNumber?: number | null;
  limit?: number | null;
}

export interface PlaybackCandidate {
  id: string;
  title: string;
  exactMatch: boolean;
  episodeCount: number | null;
  year: number | null;
}

export interface PlaybackEpisode {
  id: string;
  label: string;
  episodeNumber: number | null;
}

export interface PlaybackRoad {
  id: string;
  label: string;
  episodes: PlaybackEpisode[];
}

export interface PlaybackResolveRequest {
  candidateId: string;
  roadId: string;
  episodeId: string;
}

export interface RuleSelectors {
  searchList: string;
  searchName: string;
  searchLink: string;
  episodeRoad: string;
  episodeItem: string;
  roadName: string;
}

export interface Rule {
  id: PlaybackProviderId;
  schemaVersion: number;
  name: string;
  version?: string;
  author?: string | null;
  license?: string | null;
  homepage?: string | null;
  baseUrl: string;
  searchUrl: string;
  userAgent: string;
  resolver: "direct" | "embed";
  allowedHosts: string[];
  selectors: RuleSelectors;
}

export const playbackSourceApi = {
  list: () => invoke<PlaybackProviderDescriptor[]>("playback_source_list"),

  listRules: () => invoke<Rule[]>("playback_source_list_rules"),

  addRule: (rule: Rule) =>
    invoke<PlaybackProviderDescriptor>("playback_source_add_rule", { rule }),

  removeRule: (providerId: PlaybackProviderId) =>
    invoke<void>("playback_source_remove_rule", { providerId }),

  search: (providerId: PlaybackProviderId, query: PlaybackSearch) =>
    invoke<PlaybackCandidate[]>("playback_source_search", {
      providerId,
      query,
    }),

  episodes: (providerId: PlaybackProviderId, candidateId: string) =>
    invoke<PlaybackRoad[]>("playback_source_episodes", {
      providerId,
      candidateId,
    }),

  resolve: (
    providerId: PlaybackProviderId,
    request: PlaybackResolveRequest,
  ) =>
    invoke<PlayableSource[]>("playback_source_resolve", {
      providerId,
      request,
    }),

};

/** Existing imports can migrate independently from the old module name. */
export const onlineSourceApi = playbackSourceApi;
