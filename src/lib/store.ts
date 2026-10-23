import { mediaKind, type AnimeInfo, type MediaKind } from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";

export type DisplayLanguage = "en" | "zh";
export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = "zh";

/**
 * The catalog used for browsing, search and the schedule. Requests go to the
 * catalog named in an ID ("anilist:1", "bangumi:1"); a saved item from the
 * other catalog is first mapped to the chosen one (see `catalogApi`).
 */
export type CatalogSource = "anilist" | "bangumi";
export const DEFAULT_CATALOG_SOURCE: CatalogSource = "anilist";
/** Provider names the Rust catalog commands take. */
export const CATALOG_PROVIDERS = { anilist: "AniList", bangumi: "Bangumi" } as const;
export type CatalogProviderName = (typeof CATALOG_PROVIDERS)[CatalogSource];

/**
 * Manga always come from Bangumi for now: its book catalog is Chinese-first
 * and lists series. The 数据源 setting chooses the anime catalog only.
 */
export const MANGA_CATALOG_SOURCE: CatalogSource = "bangumi";

/** The catalog a kind of work is browsed and searched in. */
export function catalogSourceForKind(kind: MediaKind, animeSource: CatalogSource): CatalogSource {
  return kind === "manga" ? MANGA_CATALOG_SOURCE : animeSource;
}

export function catalogSourceOf(id: string): CatalogSource {
  return id.startsWith("bangumi:") ? "bangumi" : "anilist";
}

export function catalogProviderFor(id: string): CatalogProviderName {
  return CATALOG_PROVIDERS[catalogSourceOf(id)];
}

/** "bangumi:400602" → "400602". */
export function catalogExternalId(id: string): string {
  const separator = id.indexOf(":");
  return separator >= 0 ? id.slice(separator + 1) : id;
}

/** Whether a library/history row (provider + external ID) is this catalog item. */
export function isCatalogEntry(entry: { provider: string; external_id: string }, id: string): boolean {
  return `${entry.provider}:${entry.external_id}` === id;
}

export interface Settings {
  default_volume: number;
  default_speed: number;
  auto_next: boolean;
  display_language: DisplayLanguage;
  /** Absent from databases saved before data sources existed. */
  catalog_source?: CatalogSource;
}

export const settingsApi = {
  get: () => invoke<Settings>("get_settings"),
  setDisplayLanguage: (language: DisplayLanguage) =>
    invoke<void>("set_display_language", { language }),
  setCatalogSource: (source: CatalogSource) =>
    invoke<void>("set_catalog_source", { source }),
};

export const catalogApi = {
  /**
   * The chosen catalog's ID for a saved item from the other catalog, matched
   * by title once and then remembered; null when there is no confident match.
   */
  counterpart: (id: string) => invoke<string | null>("catalog_counterpart", { id }),
  /** Bangumi's entry for an unsaved AniList manga, matched by title; null if none. */
  findMangaCounterpart: (id: string) => invoke<string | null>("find_manga_counterpart", { id }),
};

// One small, process-local entry. Settings change only through our save actions.
export const settingsQueryOptions = {
  queryKey: ["settings"] as const,
  queryFn: settingsApi.get,
  staleTime: Infinity,
  gcTime: Infinity,
};

export interface StoredMedia {
  id: string;
  provider: string;
  external_id: string;
  title: string;
  cover: string | null;
  banner: string | null;
  total_episodes: number;
  kind: MediaKind;
}

export const mediaApi = {
  ensure: (media: AnimeInfo, language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE) =>
    invoke<StoredMedia>("media_ensure", {
      input: {
        provider: catalogSourceOf(media.id),
        external_id: catalogExternalId(media.id),
        title:
          language === "zh"
            ? media.title_cn || media.title_en || media.title
            : media.title_en || media.title,
        cover: media.cover,
        banner: media.banner,
        total_episodes: media.total_episodes,
        kind: mediaKind(media),
      },
    }),
};

export interface ExternalIdentity {
  media_id: string;
  provider: CatalogSource | "tmdb_tv" | "tmdb_movie";
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
  { id: "following", zh: "追番中", en: "Following" },
  { id: "completed", zh: "已看完", en: "Completed" },
] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number]["id"];

/** A library status in the words for one kind of work (or for both). */
export function libraryStatusLabel(status: LibraryStatus, kind: MediaKind | "all", language: DisplayLanguage): string {
  const labels = {
    anime: { following: ["追番中", "Following"], completed: ["已看完", "Completed"] },
    manga: { following: ["追漫中", "Reading"], completed: ["已读完", "Completed"] },
    all: { following: ["在追", "Following"], completed: ["已完成", "Completed"] },
  } as const;
  return labels[kind][status][language === "zh" ? 0 : 1];
}

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
  /** Absent from responses of builds before manga existed. */
  kind?: MediaKind;
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
