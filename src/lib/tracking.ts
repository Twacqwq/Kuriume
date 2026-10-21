import type { LibraryEntry, WatchHistoryEntry } from "@/lib/store";

/** Same as store.isCatalogEntry; kept local so this module stays dependency-free. */
const isCatalogEntry = (entry: { provider: string; external_id: string }, id: string) => `${entry.provider}:${entry.external_id}` === id;
import type { AnimeInfo } from "@/lib/types";

/** An episode counts as watched once 92 % of it has played (as on the details page). */
export const WATCHED_RATIO = 0.92;

/** Episodes broadcast so far, from the catalog or this week's schedule. */
export function airedEpisodes(media: Pick<AnimeInfo, "aired_episodes" | "schedule" | "status" | "total_episodes">, nowSeconds = Date.now() / 1000): number | null {
  if (media.aired_episodes != null) return media.aired_episodes;
  if (media.schedule) return media.schedule.airing_at <= nowSeconds ? media.schedule.episode : media.schedule.episode - 1;
  if (media.status === "FINISHED" && media.total_episodes > 0) return media.total_episodes;
  return null;
}

/**
 * The highest episode this work has been watched through. Starting episode N
 * implies the ones before it were seen (possibly on another device or source).
 */
export function watchedThrough(history: readonly WatchHistoryEntry[], mediaId: string): number {
  let through = 0;
  for (const entry of history) {
    if (!isCatalogEntry(entry, mediaId)) continue;
    const finished = entry.duration > 0 && entry.position / entry.duration >= WATCHED_RATIO;
    through = Math.max(through, finished ? entry.episode : entry.episode - 1);
  }
  return through;
}

/** Most recent history entry for a work (by catalog ID, e.g. "anilist:1"). */
export function latestEntry(history: readonly WatchHistoryEntry[], mediaId: string): WatchHistoryEntry | undefined {
  let latest: WatchHistoryEntry | undefined;
  for (const entry of history) {
    if (!isCatalogEntry(entry, mediaId)) continue;
    if (!latest || entry.watched_at > latest.watched_at) latest = entry;
  }
  return latest;
}

/** Catalog IDs ("anilist:1", "bangumi:2") of the works being followed. */
export function followedIds(entries: readonly LibraryEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.status === "following").map((entry) => `${entry.provider}:${entry.external_id}`));
}

/** "20:30" in the viewer's time zone. */
export function airingClock(airingAt: number, language: string): string {
  return new Date(airingAt * 1000).toLocaleTimeString(language === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Minutes left in a history entry, rounded up; null when unknown or finished. */
export function minutesLeft(entry: Pick<WatchHistoryEntry, "position" | "duration">): number | null {
  if (!(entry.duration > 0) || entry.position / entry.duration >= WATCHED_RATIO) return null;
  return Math.max(1, Math.ceil((entry.duration - entry.position) / 60));
}
