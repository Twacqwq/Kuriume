/**
 * Torrent source bridge — Tauri command wrappers + episode matching.
 *
 * Resolves Bangumi subject IDs to torrent sources (Mikan, etc.) and matches
 * torrent entries to specific episodes by parsing title patterns.
 */
import { invoke } from "@tauri-apps/api/core";

// ── Types matching Rust torrent_provider models ─────────────────

export interface TorrentSourceEntry {
  provider_id: string;
  title: string;
  cover: string | null;
  bgm_id: string | null;
}

export interface SubtitleGroup {
  id: string;
  name: string;
}

export interface TorrentEntry {
  title: string;
  episode_hash: string;
  torrent_url: string;
  magnet: string;
  size: string;
  publish_date: string;
}

export interface GroupTorrents {
  group: SubtitleGroup;
  torrents: TorrentEntry[];
}

// ── Invoke wrappers ─────────────────────────────────────────────

/**
 * Wrap an invoke call so that if the TanStack Query signal is already
 * aborted (component unmounted / query cancelled), we skip the invoke
 * entirely, preventing orphan Tauri callback IDs.
 */
function abortableInvoke<T>(cmd: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return invoke<T>(cmd, args);
}

/** Default torrent provider name. */
const DEFAULT_PROVIDER = "Mikan";

export const torrentSourceApi = {
  /** List all registered torrent provider names. */
  listProviders: () => invoke<string[]>("torrent_source_list_providers"),

  /** Resolve a bgm.tv anime to a torrent source. */
  resolve: (keyword: string, bgmId: string, signal?: AbortSignal, provider = DEFAULT_PROVIDER) =>
    abortableInvoke<TorrentSourceEntry | null>("torrent_source_resolve", { provider, keyword, bgmId }, signal),

  /** List subtitle/release groups for an anime. */
  getGroups: (animeId: string, provider = DEFAULT_PROVIDER) =>
    invoke<SubtitleGroup[]>("torrent_source_get_groups", { provider, animeId }),

  /** Get torrents for a specific release group. */
  getGroupTorrents: (animeId: string, groupId: string, provider = DEFAULT_PROVIDER) =>
    invoke<TorrentEntry[]>("torrent_source_get_group_torrents", {
      provider,
      animeId,
      groupId,
    }),

  /** Get all release groups with their torrents. */
  getAllTorrents: (animeId: string, signal?: AbortSignal, provider = DEFAULT_PROVIDER) =>
    abortableInvoke<GroupTorrents[]>("torrent_source_get_all_torrents", { provider, animeId }, signal),
};

// Keep backward-compatible alias so existing callsites can migrate gradually.
export const mikanApi = torrentSourceApi;

/** Known provider names — used for prefetch and static tab rendering. */
export const KNOWN_PROVIDERS = ["Mikan", "Nyaa", "DMHY"] as const;
export type ProviderName = (typeof KNOWN_PROVIDERS)[number];

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
  /** Detected subtitle language (e.g. "简中", "繁中", "双语"). */
  subtitle: string;
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

// ── Subtitle language extraction ─────────────────────────────────

const SUBTITLE_UNKNOWN = "未知";

/**
 * Extract subtitle language info from a torrent title.
 *
 * Common patterns in anime fansub titles:
 * - 「简日双语」「繁日双语」「简繁日」「简繁」
 * - 「CHS」「CHT」「CHS&CHT」「GB」「BIG5」
 * - 「简体」「繁体」「简中」「繁中」
 * - 「内嵌/内封」「外挂」
 */
export function extractSubtitleLang(title: string): string {
  const t = title;

  // Dual / Multi-language
  if (/简日双语|简日内嵌|简日/i.test(t)) return "简日双语";
  if (/繁日双语|繁日内嵌|繁日/i.test(t)) return "繁日双语";
  if (/简繁日|简繁&?日|CHS&?CHT&?JP/i.test(t)) return "简繁日";
  if (/简繁内嵌|简繁内封|简繁外挂|简繁|CHS&?CHT/i.test(t)) return "简繁";
  if (/双语/i.test(t)) return "双语";

  // Simplified Chinese
  if (/简体|简中|\bCHS\b|\bGB\b|简内嵌|简/i.test(t)) return "简中";
  // Traditional Chinese
  if (/繁体|繁中|\bCHT\b|\bBIG5\b|繁内嵌|繁/i.test(t)) return "繁中";

  return SUBTITLE_UNKNOWN;
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
  groupTorrents: GroupTorrents[],
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
          subtitle: extractSubtitleLang(torrent.title),
        });
      }
    }
  }

  return result;
}
