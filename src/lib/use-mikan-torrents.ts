/**
 * React hook that resolves Mikan torrent sources for an anime.
 *
 * Given an anime's Bangumi ID and title, it:
 * 1. Resolves the Mikan bangumi entry (mikan_id) via search + bgm ID match
 * 2. Fetches available subtitle groups
 * 3. When a group is selected, fetches that group's torrents
 * 4. Matches torrents to episode numbers
 * 5. Provides `getTorrentSource(ep)` helper
 *
 * The user must select a subtitle group before torrents are fetched.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  mikanApi,
  extractEpisodeNumber,
  type EpisodeTorrentMatch,
  type MikanTorrentEntry,
  type SubtitleGroup,
} from "./mikan";

// ── Types ────────────────────────────────────────────────────────

interface UseMikanTorrentsResult {
  /** Whether initial resolution (Mikan ID + subtitle groups) is loading. */
  isLoading: boolean;
  /** Whether resolution has been attempted (regardless of success). */
  isReady: boolean;
  /** Error message if resolution failed. */
  error: string | null;
  /** Available subtitle groups for this anime. */
  subtitleGroups: SubtitleGroup[];
  /** Currently selected subtitle group ID. */
  selectedGroupId: string | null;
  /** Currently selected subtitle group name. */
  selectedGroupName: string | null;
  /** Select a subtitle group — triggers torrent fetch for that group. */
  selectGroup: (groupId: string) => void;
  /** Whether torrents for the selected group are loading. */
  isFetchingTorrents: boolean;
  /** Number of episodes matched from selected group. */
  matchedCount: number;
  /**
   * Get the best torrent source for a specific episode.
   * Prefers .torrent URL (instant metadata) over magnet (slow DHT).
   */
  getTorrentSource: (ep: number) => string | undefined;
  /** Get full match info for a specific episode. */
  getMatch: (ep: number) => EpisodeTorrentMatch | undefined;
  /** All matched episodes. */
  matches: Map<number, EpisodeTorrentMatch>;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Match torrents from a single subtitle group to episode numbers.
 */
function matchTorrentsToEpisodes(
  torrents: MikanTorrentEntry[],
  groupName: string,
): Map<number, EpisodeTorrentMatch> {
  const result = new Map<number, EpisodeTorrentMatch>();

  for (const torrent of torrents) {
    const ep = extractEpisodeNumber(torrent.title);
    if (ep === null) continue;

    // Keep first match per episode (torrent list is usually newest-first)
    if (!result.has(ep)) {
      result.set(ep, {
        ep,
        torrentUrl: torrent.torrent_url,
        magnet: torrent.magnet,
        torrentTitle: torrent.title,
        size: torrent.size,
        groupName,
      });
    }
  }

  return result;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useMikanTorrents(
  bgmId: string | undefined,
  title: string | undefined,
  initialGroupId?: string,
): UseMikanTorrentsResult {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId ?? null);

  // Step 1: Resolve Mikan ID from bgm.tv subject ID
  const {
    data: mikanEntry,
    isLoading: isResolving,
    error: resolveError,
  } = useQuery({
    queryKey: ["mikan-resolve", bgmId],
    queryFn: async () => {
      if (!bgmId || !title) return null;
      return mikanApi.resolve(title, bgmId);
    },
    enabled: !!bgmId && !!title,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const mikanId = mikanEntry?.mikan_id;

  // Step 2: Fetch subtitle groups
  const {
    data: subtitleGroups,
    isLoading: isFetchingGroups,
    error: groupsError,
  } = useQuery({
    queryKey: ["mikan-subgroups", mikanId],
    queryFn: async () => {
      if (!mikanId) return [];
      return mikanApi.getSubgroups(mikanId);
    },
    enabled: !!mikanId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Step 3: Fetch torrents for selected group
  const {
    data: groupTorrents,
    isLoading: isFetchingTorrents,
    error: torrentsError,
  } = useQuery({
    queryKey: ["mikan-group-torrents", mikanId, selectedGroupId],
    queryFn: async () => {
      if (!mikanId || !selectedGroupId) return [];
      return mikanApi.getSubgroupTorrents(mikanId, selectedGroupId);
    },
    enabled: !!mikanId && !!selectedGroupId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });

  // Step 4: Match episodes
  const selectedGroup = subtitleGroups?.find((g) => g.id === selectedGroupId);
  const matches =
    groupTorrents && selectedGroup
      ? matchTorrentsToEpisodes(groupTorrents, selectedGroup.name)
      : new Map<number, EpisodeTorrentMatch>();

  const isLoading = isResolving || isFetchingGroups;
  const error = resolveError
    ? String(resolveError)
    : groupsError
      ? String(groupsError)
      : torrentsError
        ? String(torrentsError)
        : null;

  const selectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
  }, []);

  return {
    isLoading,
    isReady: !isLoading && !isFetchingTorrents,
    error,
    subtitleGroups: subtitleGroups ?? [],
    selectedGroupId,
    selectedGroupName: selectedGroup?.name ?? null,
    selectGroup,
    isFetchingTorrents,
    matchedCount: matches.size,
    getTorrentSource: (ep: number) => {
      const m = matches.get(ep);
      if (!m) return undefined;
      return m.torrentUrl || m.magnet || undefined;
    },
    getMatch: (ep: number) => matches.get(ep),
    matches,
  };
}
