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
  extractSubtitleLang,
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
  /** Available subtitle languages in this group (sorted). */
  subtitles: string[];
  /** Number of unique episodes available. */
  episodeCount: number;
  /**
   * ep → (variant key → match).
   * Variant key = `${resolution}|${subtitle}`.
   */
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

  /** Currently preferred subtitle language. */
  preferredSubtitle: string | null;
  /** Set preferred subtitle language. */
  setPreferredSubtitle: (sub: string | null) => void;

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

const SUBTITLE_ORDER: Record<string, number> = {
  "简日双语": 0, "简中": 1, "简繁": 2, "简繁日": 3, "双语": 4,
  "繁日双语": 5, "繁中": 6, "未知": 99,
};

function sortSubtitles(subtitles: string[]): string[] {
  return [...subtitles].sort(
    (a, b) => (SUBTITLE_ORDER[a] ?? 50) - (SUBTITLE_ORDER[b] ?? 50),
  );
}

/** Build the compound map key for a resolution+subtitle variant. */
function variantKey(resolution: string, subtitle: string): string {
  return `${resolution}|${subtitle}`;
}

/**
 * Process raw SubtitleGroupTorrents[] into GroupData[].
 *
 * @param totalEpisodes - Total episode count from Bangumi metadata.
 *   When there is only 1 episode (MV, OVA, movie), torrents without
 *   an explicit episode number are assigned to episode 1.
 */
function buildGroupData(raw: SubtitleGroupTorrents[], totalEpisodes?: number): GroupData[] {
  return raw.map(({ group, torrents }) => {
    const episodes = new Map<number, Map<string, EpisodeTorrentMatch>>();
    const resSet = new Set<string>();
    const subSet = new Set<string>();

    for (const torrent of torrents) {
      let ep = extractEpisodeNumber(torrent.title);
      // For single-episode anime, treat unnumbered torrents as episode 1
      if (ep === null && totalEpisodes === 1) ep = 1;
      if (ep === null) continue;
      const resolution = extractResolution(torrent.title);
      const subtitle = extractSubtitleLang(torrent.title);
      resSet.add(resolution);
      subSet.add(subtitle);

      let varMap = episodes.get(ep);
      if (!varMap) {
        varMap = new Map();
        episodes.set(ep, varMap);
      }

      const key = variantKey(resolution, subtitle);
      // Keep first match per (episode, resolution, subtitle)
      if (!varMap.has(key)) {
        varMap.set(key, {
          ep,
          torrentUrl: torrent.torrent_url,
          magnet: torrent.magnet,
          torrentTitle: torrent.title,
          size: torrent.size,
          groupName: group.name,
          resolution,
          subtitle,
        });
      }
    }

    return {
      id: group.id,
      name: group.name,
      resolutions: sortResolutions([...resSet]),
      subtitles: sortSubtitles([...subSet]),
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
  totalEpisodes?: number,
  initialSubtitle?: string,
): UseMikanTorrentsResult {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId ?? null);
  const [preferredResolution, setPreferredResolution] = useState<string | null>(initialResolution ?? null);
  const [preferredSubtitle, setPreferredSubtitle] = useState<string | null>(initialSubtitle ?? null);

  // Step 1: Resolve Mikan ID from bgm.tv subject ID
  const {
    data: mikanEntry,
    isLoading: isResolving,
    error: resolveError,
  } = useQuery({
    queryKey: ["mikan-resolve", bgmId],
    queryFn: async ({ signal }) => {
      if (!bgmId || !title) return null;
      return mikanApi.resolve(title, bgmId, signal);
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
    queryFn: async ({ signal }) => {
      if (!mikanId) return [];
      return mikanApi.getAllTorrents(mikanId, signal);
    },
    enabled: !!mikanId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });

  // Step 3: Process into GroupData[]
  const groups = useMemo(
    () => (rawGroupTorrents ? buildGroupData(rawGroupTorrents, totalEpisodes) : []),
    [rawGroupTorrents, totalEpisodes],
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

  // Effective subtitle for source lookup
  const effectiveSubtitle = useMemo(() => {
    if (!selectedGroupData) return null;
    if (preferredSubtitle && selectedGroupData.subtitles.includes(preferredSubtitle)) {
      return preferredSubtitle;
    }
    return selectedGroupData.subtitles[0] ?? null;
  }, [selectedGroupData, preferredSubtitle]);

  const isLoading = isResolving || isFetchingAll;
  const error = resolveError
    ? String(resolveError)
    : fetchError
      ? String(fetchError)
      : null;

  const selectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setPreferredResolution(null);
    setPreferredSubtitle(null);
  }, []);

  const getMatch = useCallback(
    (ep: number): EpisodeTorrentMatch | undefined => {
      if (!selectedGroupData) return undefined;
      const varMap = selectedGroupData.episodes.get(ep);
      if (!varMap) return undefined;
      // Try exact resolution+subtitle match first
      if (effectiveResolution && effectiveSubtitle) {
        const key = variantKey(effectiveResolution, effectiveSubtitle);
        if (varMap.has(key)) return varMap.get(key);
      }
      // Fallback: match resolution only
      if (effectiveResolution) {
        for (const [k, v] of varMap) {
          if (k.startsWith(effectiveResolution + "|")) return v;
        }
      }
      // Fallback: first available
      return varMap.values().next().value ?? undefined;
    },
    [selectedGroupData, effectiveResolution, effectiveSubtitle],
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
    preferredSubtitle: effectiveSubtitle,
    setPreferredSubtitle,
    getTorrentSource,
    getMatch,
    getGroupData,
  };
}
