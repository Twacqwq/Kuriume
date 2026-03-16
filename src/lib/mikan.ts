/**
 * Mikan (蜜柑计划) bridge — Tauri command wrappers + episode matching.
 *
 * Resolves Bangumi subject IDs to Mikan torrent sources and matches
 * torrent entries to specific episodes by parsing title patterns.
 */
import { invoke } from "@tauri-apps/api/core";

// ── Types matching Rust models ──────────────────────────────────

export interface MikanBangumiEntry {
  mikan_id: string;
  title: string;
  cover: string | null;
  bgm_id: string | null;
}

export interface SubtitleGroup {
  id: string;
  name: string;
}

export interface MikanTorrentEntry {
  title: string;
  episode_hash: string;
  torrent_url: string;
  magnet: string;
  size: string;
  publish_date: string;
}

export interface SubtitleGroupTorrents {
  group: SubtitleGroup;
  torrents: MikanTorrentEntry[];
}

// ── Invoke wrappers ─────────────────────────────────────────────

export const mikanApi = {
  /** Search Mikan for anime matching the keyword. */
  search: (keyword: string) =>
    invoke<MikanBangumiEntry[]>("mikan_search", { keyword }),

  /** Resolve a Mikan entry by searching and matching bgm.tv ID. */
  resolve: (keyword: string, bgmId: string) =>
    invoke<MikanBangumiEntry | null>("mikan_resolve", { keyword, bgmId }),

  /** List subtitle groups for a Mikan bangumi. */
  getSubgroups: (mikanId: string) =>
    invoke<SubtitleGroup[]>("mikan_get_subgroups", { mikanId }),

  /** Get torrents for a specific subtitle group. */
  getSubgroupTorrents: (mikanId: string, subgroupId: string) =>
    invoke<MikanTorrentEntry[]>("mikan_get_subgroup_torrents", {
      mikanId,
      subgroupId,
    }),

  /** Get all subtitle groups with their torrents. */
  getAllTorrents: (mikanId: string) =>
    invoke<SubtitleGroupTorrents[]>("mikan_get_all_torrents", { mikanId }),
};

// ── Episode number extraction ───────────────────────────────────

/**
 * Extract episode number(s) from a torrent title string.
 *
 * Handles common anime fansub naming patterns:
 * - `[Group] Title [01] [1080p]`
 * - `[Group] Title - 01 [1080p]`
 * - `[Group] Title - 01v2 [1080p]`
 * - `[Group] Title S01E01 [1080p]`
 * - `[Group] Title 第01话`
 * - `[Group] Title EP01`
 *
 * Returns the first matched episode number, or null if none found.
 */
export function extractEpisodeNumber(title: string): number | null {
  // Strip leading group tags like [GroupName] to avoid matching group IDs
  const stripped = title.replace(/^\s*(\[[^\]]*\]\s*)+/, "");

  // Ordered patterns from most specific to least
  const patterns: RegExp[] = [
    // S01E03, S1E3
    /S\d{1,2}E(\d{1,4})/i,
    // EP03, EP3
    /EP(\d{1,4})/i,
    // 第03话, 第3集, 第03話
    /第(\d{1,4})[话集話]/,
    // - 03 (with dash separator)
    /[-–]\s*(\d{1,4})(?:v\d)?\s*(?:\[|\(|$|\.mkv|\.mp4)/i,
    // [03] (standalone number in brackets, after title)
    /\[(\d{1,4})(?:v\d)?\]/,
    // Space + number at reasonable position (last resort)
    /\s(\d{1,3})(?:v\d)?\s*(?:\[|\(|$|\.mkv|\.mp4)/i,
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]) {
      const num = Number.parseInt(match[1], 10);
      // Sanity check: skip numbers that look like resolution (1080, 720, etc.)
      if (num > 0 && num < 1000 && ![720, 1080, 2160, 480, 576].includes(num)) {
        return num;
      }
    }
  }

  return null;
}

// ── Episode ↔ Torrent matching ──────────────────────────────────

export interface EpisodeTorrentMatch {
  /** Episode number. */
  ep: number;
  /** .torrent file download URL (preferred — instant metadata). */
  torrentUrl: string;
  /** Magnet URI (fallback — requires slow DHT resolution). */
  magnet: string;
  /** Torrent title for display. */
  torrentTitle: string;
  /** File size. */
  size: string;
  /** Subtitle group name. */
  groupName: string;
  /** Detected resolution (e.g. "1080p", "720p", "4K"). */
  resolution: string;
}

// ── Resolution extraction ───────────────────────────────────────

const RESOLUTION_UNKNOWN = "未知";

/**
 * Extract video resolution from a torrent title string.
 *
 * Handles common fansub naming patterns:
 * - `[1080P]`, `1080p`, `[BD 1080p]`
 * - `[720P]`, `720p`
 * - `[4K]`, `[2160p]`, `2160P`
 * - `[480P]`, `480p`
 *
 * Returns a normalised label (e.g. "1080p") or "未知".
 */
export function extractResolution(title: string): string {
  // 4K / UHD
  if (/4K|2160[pP]/i.test(title)) return "4K";
  // 1080
  if (/1080[pPiI]/i.test(title)) return "1080p";
  // 720
  if (/720[pPiI]/i.test(title)) return "720p";
  // 480 / 576
  if (/480[pPiI]/i.test(title)) return "480p";
  if (/576[pPiI]/i.test(title)) return "576p";

  return RESOLUTION_UNKNOWN;
}

/**
 * Given all subtitle groups' torrents, build a map from episode number
 * to the best torrent match.
 *
 * "Best" heuristic: prefer the first group that has the most torrents
 * (likely the most complete fansub), then pick the latest (highest quality)
 * entry per episode.
 */
export function matchEpisodesToTorrents(
  groupTorrents: SubtitleGroupTorrents[],
): Map<number, EpisodeTorrentMatch> {
  const result = new Map<number, EpisodeTorrentMatch>();

  if (groupTorrents.length === 0) return result;

  // Sort groups by torrent count descending — prefer the most complete group
  const sorted = [...groupTorrents].sort(
    (a, b) => b.torrents.length - a.torrents.length,
  );

  // Process each group; first match per episode wins (from the best group)
  for (const { group, torrents } of sorted) {
    for (const torrent of torrents) {
      const ep = extractEpisodeNumber(torrent.title);
      if (ep === null) continue;

      // Only set if this episode hasn't been matched yet
      if (!result.has(ep)) {
        result.set(ep, {
          ep,
          torrentUrl: torrent.torrent_url,
          magnet: torrent.magnet,
          torrentTitle: torrent.title,
          size: torrent.size,
          groupName: group.name,
          resolution: extractResolution(torrent.title),
        });
      }
    }
  }

  return result;
}
