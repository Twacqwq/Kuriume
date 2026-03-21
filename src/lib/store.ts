/**
 * Store API — Tauri command wrappers for settings & media cache.
 */
import { invoke } from "@tauri-apps/api/core";

// ── Types ───────────────────────────────────────────────────────

export interface Settings {
  cache_dir: string;
  cache_enabled: boolean;
  hwdec: string;
  default_volume: number;
  default_speed: number;
  buffer_size: number;
  auto_next: boolean;
}

export interface MediaEntry {
  id: number;
  bgm_id: string;
  episode: number;
  anime_title: string;
  group_name: string;
  resolution: string;
  file_path: string;
  file_size: number;
  torrent_source: string;
  cached_at: string;
}

// ── Settings API ────────────────────────────────────────────────

export const settingsApi = {
  get: () => invoke<Settings>("get_settings"),

  setCacheDir: (dir: string) =>
    invoke<void>("set_cache_dir", { dir }),

  /** Change cache directory and optionally migrate existing files. */
  migrateDir: (newDir: string, migrate: boolean) =>
    invoke<void>("cache_migrate_dir", { newDir, migrate }),

  setCacheEnabled: (enabled: boolean) =>
    invoke<void>("set_cache_enabled", { enabled }),

  setHwdec: (mode: string) =>
    invoke<void>("set_hwdec", { mode }),

  setDefaultVolume: (volume: number) =>
    invoke<void>("set_default_volume", { volume }),

  setDefaultSpeed: (speed: number) =>
    invoke<void>("set_default_speed", { speed }),

  setBufferSize: (size: number) =>
    invoke<void>("set_buffer_size", { size }),

  setAutoNext: (enabled: boolean) =>
    invoke<void>("set_auto_next", { enabled }),
};

// ── Cache API ───────────────────────────────────────────────────

export const cacheApi = {
  /** Look up a cached local file for an anime episode. */
  lookup: (bgmId: string, episode: number, groupName?: string, resolution?: string) =>
    invoke<MediaEntry | null>("cache_lookup", {
      bgmId,
      episode,
      groupName: groupName ?? null,
      resolution: resolution ?? null,
    }),

  /** Register a downloaded file into the cache. */
  register: (params: {
    bgmId: string;
    episode: number;
    animeTitle: string;
    groupName: string;
    resolution: string;
    filePath: string;
    fileSize: number;
    torrentSource: string;
  }) => invoke<number>("cache_register", params),

  /** Remove a cache entry and delete the file. */
  remove: (id: number) => invoke<void>("cache_remove", { id }),

  /** List all cached entries for an anime. */
  list: (bgmId: string) =>
    invoke<MediaEntry[]>("cache_list", { bgmId }),

  /** Get total cache size in bytes. */
  totalSize: () => invoke<number>("cache_total_size"),

  /** Clear all cache entries and delete files. Optionally also clear torrent temp files. */
  clearAll: (includeTempFiles = true) =>
    invoke<void>("cache_clear_all", { includeTemp: includeTempFiles }),

  /** Move a downloaded file to the organized cache directory and register it. */
  organize: (params: {
    sourcePath: string;
    bgmId: string;
    episode: number;
    animeTitle: string;
    groupName: string;
    resolution: string;
    torrentSource: string;
  }) => invoke<MediaEntry>("cache_organize", params),
};

// ── Watchlist types ─────────────────────────────────────────────

export type WatchStatus = "unwatched" | "watching" | "completed";

export interface WatchlistEntry {
  id: number;
  bgm_id: string;
  anime_title: string;
  cover: string | null;
  total_episodes: number;
  status: WatchStatus;
  added_at: string;
  updated_at: string;
}

// ── Watchlist API ───────────────────────────────────────────────

export const watchlistApi = {
  add: (bgmId: string, animeTitle: string, cover: string | null, totalEpisodes: number) =>
    invoke<WatchlistEntry>("watchlist_add", {
      bgmId,
      animeTitle,
      cover,
      totalEpisodes,
    }),

  remove: (bgmId: string) =>
    invoke<void>("watchlist_remove", { bgmId }),

  get: (bgmId: string) =>
    invoke<WatchlistEntry | null>("watchlist_get", { bgmId }),

  setStatus: (bgmId: string, status: WatchStatus) =>
    invoke<void>("watchlist_set_status", { bgmId, status }),

  list: (status?: WatchStatus) =>
    invoke<WatchlistEntry[]>("watchlist_list", { status: status ?? null }),
};

// ── Watch History types ─────────────────────────────────────────

export interface WatchHistoryEntry {
  id: number;
  bgm_id: string;
  episode: number;
  anime_title: string;
  episode_title: string;
  cover: string | null;
  position: number;
  duration: number;
  group_id: string | null;
  resolution: string | null;
  subtitle: string | null;
  watched_at: string;
}

// ── Watch History API ───────────────────────────────────────────

export const historyApi = {
  upsert: (params: {
    bgmId: string;
    episode: number;
    animeTitle: string;
    episodeTitle: string;
    cover: string | null;
    position: number;
    duration: number;
    groupId: string | null;
    resolution: string | null;
    subtitle: string | null;
  }) => invoke<void>("history_upsert", params),

  list: (limit: number, offset: number) =>
    invoke<WatchHistoryEntry[]>("history_list", { limit, offset }),

  remove: (bgmId: string) =>
    invoke<void>("history_remove", { bgmId }),

  clear: () => invoke<void>("history_clear"),
};
