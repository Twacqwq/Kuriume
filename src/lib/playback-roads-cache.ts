import type { PlaybackRoad } from "@/lib/online-source";

/**
 * The episode lists (roads) of works matched before, per device, so resuming
 * one can start resolving the episode right away instead of waiting for the
 * provider's episode list first. A cached list is only a head start: the
 * caller still fetches the live list and switches to it when it differs.
 */

const KEY = "kuriume:playback-roads:v1";
/** Works kept; the least recently used drop out. */
const MAX_WORKS = 24;
/** A list larger than this (serialized) is not worth the storage. */
const MAX_LIST_CHARS = 200_000;

type Entry = { key: string; roads: PlaybackRoad[] };
type Store = Pick<Storage, "getItem" | "setItem">;

const entryKey = (providerId: string, candidateId: string) => JSON.stringify([providerId, candidateId]);

function isRoads(value: unknown): value is PlaybackRoad[] {
  return Array.isArray(value) && value.length > 0 && value.every((road) =>
    road && typeof road === "object"
    && typeof road.id === "string" && typeof road.label === "string"
    && Array.isArray(road.episodes) && road.episodes.every((episode: unknown) => {
      const item = episode as { id?: unknown; label?: unknown; episodeNumber?: unknown } | null;
      return !!item && typeof item.id === "string" && typeof item.label === "string"
        && (item.episodeNumber === null || typeof item.episodeNumber === "number");
    }));
}

function readEntries(storage: Store | undefined): Entry[] {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is Entry => !!entry && typeof entry.key === "string" && isRoads(entry.roads));
  } catch {
    return [];
  }
}

export function readCachedRoads(storage: Store | undefined, providerId: string, candidateId: string): PlaybackRoad[] | null {
  const key = entryKey(providerId, candidateId);
  return readEntries(storage).find((entry) => entry.key === key)?.roads ?? null;
}

export function writeCachedRoads(storage: Store | undefined, providerId: string, candidateId: string, roads: readonly PlaybackRoad[]) {
  if (!isRoads(roads)) return;
  const key = entryKey(providerId, candidateId);
  try {
    if (JSON.stringify(roads).length > MAX_LIST_CHARS) return;
    const entries = [{ key, roads: [...roads] }, ...readEntries(storage).filter((entry) => entry.key !== key)].slice(0, MAX_WORKS);
    storage?.setItem(KEY, JSON.stringify(entries));
  } catch { /* storage full or unavailable: the live list still works */ }
}

/** Same roads, episodes and labels, in the same order. */
export function sameRoads(a: readonly PlaybackRoad[], b: readonly PlaybackRoad[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
