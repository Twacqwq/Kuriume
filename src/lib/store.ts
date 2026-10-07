import type { AnimeInfo } from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";

export type DisplayLanguage = "en" | "zh";

export interface Settings {
  default_volume: number;
  default_speed: number;
  auto_next: boolean;
  display_language: DisplayLanguage;
}

export const settingsApi = {
  get: () => invoke<Settings>("get_settings"),
  setDefaultVolume: (volume: number) =>
    invoke<void>("set_default_volume", { volume }),
  setDefaultSpeed: (speed: number) =>
    invoke<void>("set_default_speed", { speed }),
  setAutoNext: (enabled: boolean) =>
    invoke<void>("set_auto_next", { enabled }),
  setDisplayLanguage: (language: DisplayLanguage) =>
    invoke<void>("set_display_language", { language }),
};

export interface StoredMedia {
  id: string;
  provider: string;
  external_id: string;
  title: string;
  cover: string | null;
  banner: string | null;
  total_episodes: number;
}

export const mediaApi = {
  ensure: (media: AnimeInfo, language: DisplayLanguage = "en") =>
    invoke<StoredMedia>("media_ensure", {
      input: {
        provider: "anilist",
        external_id: String(media.anilist_id),
        title:
          language === "zh"
            ? media.title_cn || media.title_en || media.title
            : media.title_en || media.title,
        cover: media.cover,
        banner: media.banner,
        total_episodes: media.total_episodes,
      },
    }),
};

export interface ExternalIdentity {
  media_id: string;
  provider: "anilist" | "tmdb_tv" | "tmdb_movie";
  external_id: string;
  scope: string;
  confidence: number;
  verified_at: string;
}

export const externalIdentityApi = {
  list: (mediaId: string) =>
    invoke<ExternalIdentity[]>("external_identity_list", { mediaId }),
  upsert: (params: {
    mediaId: string;
    provider: "tmdb_tv" | "tmdb_movie";
    externalId: string;
    scope: string;
    confidence?: number;
  }) =>
    invoke<ExternalIdentity>("external_identity_upsert", {
      ...params,
      confidence: params.confidence ?? 1,
    }),
  remove: (mediaId: string, provider: "tmdb_tv" | "tmdb_movie") =>
    invoke<void>("external_identity_remove", { mediaId, provider }),
};

export const LIBRARY_STATUSES = [
  { id: "following", zh: "追番", en: "Following" },
  { id: "completed", zh: "已看完", en: "Completed" },
] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number]["id"];

export interface LibraryEntry {
  media_id: string;
  provider: string;
  external_id: string;
  title: string;
  cover: string | null;
  banner: string | null;
  total_episodes: number;
  status: LibraryStatus;
  added_at: string;
  updated_at: string;
}

export const libraryApi = {
  add: (mediaId: string, status: LibraryStatus = "following") =>
    invoke<LibraryEntry>("library_add", { mediaId, status }),
  remove: (mediaId: string) =>
    invoke<void>("library_remove", { mediaId }),
  get: (mediaId: string) =>
    invoke<LibraryEntry | null>("library_get", { mediaId }),
  setStatus: (mediaId: string, status: LibraryStatus) =>
    invoke<void>("library_set_status", { mediaId, status }),
  list: (status?: LibraryStatus) =>
    invoke<LibraryEntry[]>("library_list", { status: status ?? null }),
};

export interface WatchHistoryEntry {
  media_id: string;
  provider: string;
  external_id: string;
  episode: number;
  media_title: string;
  episode_title: string;
  cover: string | null;
  position: number;
  duration: number;
  source_id: string | null;
  watched_at: string;
}

export function historyListQueryKey(limit = 200, offset = 0) {
  return ["history-list", { limit, offset }] as const;
}

export const historyApi = {
  upsert: (params: {
    mediaId: string;
    episode: number;
    episodeTitle: string;
    position: number;
    duration: number;
    sourceId: string | null;
  }) => invoke<void>("history_upsert", params),
  list: (limit = 200, offset = 0) =>
    invoke<WatchHistoryEntry[]>("history_list", { limit, offset }),
  remove: (mediaId: string, episode?: number) =>
    invoke<void>("history_remove", {
      mediaId,
      episode: episode ?? null,
    }),
  clear: () => invoke<void>("history_clear"),
};

export interface SourceBinding {
  media_id: string;
  source_id: string;
  remote_media_url: string;
  remote_title: string;
  road_index: number;
  verified_at: string;
}

export const sourceBindingApi = {
  get: (mediaId: string, sourceId: string) =>
    invoke<SourceBinding | null>("source_binding_get", { mediaId, sourceId }),
  list: (mediaId: string) =>
    invoke<SourceBinding[]>("source_binding_list", { mediaId }),
  upsert: (params: {
    mediaId: string;
    sourceId: string;
    remoteMediaUrl: string;
    remoteTitle: string;
    roadIndex: number;
  }) => invoke<SourceBinding>("source_binding_upsert", params),
  remove: (mediaId: string, sourceId: string) =>
    invoke<void>("source_binding_remove", { mediaId, sourceId }),
};

export function catalogId(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}
