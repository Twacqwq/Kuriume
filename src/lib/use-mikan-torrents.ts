/**
 * React hook that resolves Mikan torrent sources for an anime.
 *
 * Fetches ALL subtitle groups and their torrents in one go using
 * `getAllTorrents`, then organises the data per group → per episode
 * → per resolution.
 *
 * The detail page renders groups as expandable accordion sections.
 * The player page uses `selectedGroupId` + `preferredResolution`
 * to resolve a single torrent source.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  mikanApi,
  extractEpisodeNumber,
  extractResolution,
  type EpisodeTorrentMatch,
  type SubtitleGroupTorrents,
} from "./mikan";

// ── Types ────────────────────────────────────────────────────────

/** Processed data for one subtitle group. */
export interface GroupData {
  id: string;
  name: string;
  /** Available resolutions in this group (sorted by quality). */
  resolutions: string[];
  /** Number of unique episodes available. */
  episodeCount: number;
  /** ep → (resolution → match). */
  episodes: Map<number, Map<string, EpisodeTorrentMatch>>;
}

interface UseMikanTorrentsResult {
  /** Whether initial loading (Mikan ID + all groups) is in progress. */
  isLoading: boolean;
  /** Error message if resolution failed. */
  error: string | null;

  /** All subtitle groups with their processed episode data. */
  groups: GroupData[];

  /** Currently selected/expanded subtitle group ID (for playing). */
  selectedGroupId: string | null;
  /** Currently selected subtitle group name. */
  selectedGroupName: string | null;
  /** Select a subtitle group. */
  selectGroup: (groupId: string) => void;

  /** Currently preferred resolution. */
  preferredResolution: string | null;
  /** Set preferred resolution. */
  setPreferredResolution: (res: string | null) => void;

  /** Get the best torrent source for an episode in the selected group. */
  getTorrentSource: (ep: number) => string | undefined;
  /** Get full match info for an episode in the selected group. */
  getMatch: (ep: number) => EpisodeTorrentMatch | undefined;

  /** Lookup data for a specific group. */
  getGroupData: (groupId: string) => GroupData | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────

const RESOLUTION_ORDER: Record<string, number> = {
  "4K": 0, "1080p": 1, "720p": 2, "576p": 3, "480p": 4, "未知": 99,
};

function sortResolutions(resolutions: string[]): string[] {
  return [...resolutions].sort(
    (a, b) => (RESOLUTION_ORDER[a] ?? 50) - (RESOLUTION_ORDER[b] ?? 50),
  );
}

/**
 * Process raw SubtitleGroupTorrents[] into GroupData[].
 */
function buildGroupData(raw: SubtitleGroupTorrents[]): GroupData[] {
  return raw.map(({ group, torrents }) => {
    const episodes = new Map<number, Map<string, EpisodeTorrentMatch>>();
    const resSet = new Set<string>();

    for (const torrent of torrents) {
      const ep = extractEpisodeNumber(torrent.title);
      if (ep === null) continue;
      const resolution = extractResolution(torrent.title);
      resSet.add(resolution);

      let resMap = episodes.get(ep);
      if (!resMap) {
        resMap = new Map();
        episodes.set(ep, resMap);
      }

      // Keep first match per (episode, resolution)
      if (!resMap.has(resolution)) {
        resMap.set(resolution, {
          ep,
          torrentUrl: torrent.torrent_url,
          magnet: torrent.magnet,
          torrentTitle: torrent.title,
          size: torrent.size,
          groupName: group.name,
          resolution,
        });
      }
    }

    return {
      id: group.id,
      name: group.name,
      resolutions: sortResolutions([...resSet]),
      episodeCount: episodes.size,
      episodes,
    };
  })
  // Sort groups by episode count descending — most complete first
  .sort((a, b) => b.episodeCount - a.episodeCount);
}

// ── Hook ─────────────────────────────────────────────────────────

export function useMikanTorrents(
  bgmId: string | undefined,
  title: string | undefined,
  initialGroupId?: string,
  initialResolution?: string,
): UseMikanTorrentsResult {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId ?? null);
  const [preferredResolution, setPreferredResolution] = useState<string | null>(initialResolution ?? null);

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

  // Step 2: Fetch ALL groups with their torrents in one go
  const {
    data: rawGroupTorrents,
    isLoading: isFetchingAll,
    error: fetchError,
  } = useQuery({
    queryKey: ["mikan-all-torrents", mikanId],
    queryFn: async () => {
      if (!mikanId) return [];
      return mikanApi.getAllTorrents(mikanId);
    },
    enabled: !!mikanId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });

  // Step 3: Process into GroupData[]
  const groups = useMemo(
    () => (rawGroupTorrents ? buildGroupData(rawGroupTorrents) : []),
    [rawGroupTorrents],
  );

  // Auto-select first group if none selected and data is loaded
  const effectiveGroupId = useMemo(() => {
    if (selectedGroupId && groups.some((g) => g.id === selectedGroupId)) {
      return selectedGroupId;
    }
    return groups[0]?.id ?? null;
  }, [selectedGroupId, groups]);

  const selectedGroupData = useMemo(
    () => groups.find((g) => g.id === effectiveGroupId),
    [groups, effectiveGroupId],
  );

  // Effective resolution for source lookup
  const effectiveResolution = useMemo(() => {
    if (!selectedGroupData) return null;
    if (preferredResolution && selectedGroupData.resolutions.includes(preferredResolution)) {
      return preferredResolution;
    }
    return selectedGroupData.resolutions[0] ?? null;
  }, [selectedGroupData, preferredResolution]);

  const isLoading = isResolving || isFetchingAll;
  const error = resolveError
    ? String(resolveError)
    : fetchError
      ? String(fetchError)
      : null;

  const selectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setPreferredResolution(null);
  }, []);

  const getMatch = useCallback(
    (ep: number): EpisodeTorrentMatch | undefined => {
      if (!selectedGroupData) return undefined;
      const resMap = selectedGroupData.episodes.get(ep);
      if (!resMap) return undefined;
      if (effectiveResolution && resMap.has(effectiveResolution)) {
        return resMap.get(effectiveResolution);
      }
      return resMap.values().next().value ?? undefined;
    },
    [selectedGroupData, effectiveResolution],
  );

  const getTorrentSource = useCallback(
    (ep: number): string | undefined => {
      const m = getMatch(ep);
      if (!m) return undefined;
      return m.torrentUrl || m.magnet || undefined;
    },
    [getMatch],
  );

  const getGroupData = useCallback(
    (groupId: string) => groups.find((g) => g.id === groupId),
    [groups],
  );

  return {
    isLoading,
    error,
    groups,
    selectedGroupId: effectiveGroupId,
    selectedGroupName: selectedGroupData?.name ?? null,
    selectGroup,
    preferredResolution: effectiveResolution,
    setPreferredResolution,
    getTorrentSource,
    getMatch,
    getGroupData,
  };
}
