import {
  playbackSourceApi,
  type PlaybackCandidate,
  type PlaybackEpisode,
  type PlaybackProviderDescriptor,
  type PlaybackResolveRequest,
  type PlaybackRoad,
} from "@/lib/online-source";
import {
  initialPlaybackRoad,
  playbackSearchRequest,
  preferredProviderId,
  restoredPlaybackCandidate,
  type PlaybackMatchContext,
} from "@/lib/playback-selection";
import { readCachedRoads, sameRoads, writeCachedRoads } from "@/lib/playback-roads-cache";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface OnlineSourceState {
  providers: PlaybackProviderDescriptor[];
  /** Stable provider IDs retained for source-binding/history compatibility. */
  sources: string[];
  sourcesLoading: boolean;
  selectedSource: string | null;
  searchResults: PlaybackCandidate[];
  selectedAnime: PlaybackCandidate | null;
  searching: boolean;
  roads: PlaybackRoad[];
  loadingEpisodes: boolean;
  selectedRoadIndex: number;
  /** The roads shown came from the device cache; the live list is on its way. */
  refreshing: boolean;
  /** The roads shown came from the device cache and no live list has replaced or confirmed them. */
  cached: boolean;
  /** The work whose saved source preference has been applied. */
  initializedScope: string | null;
  error: string | null;
}

const INITIAL: OnlineSourceState = {
  providers: [],
  sources: [],
  sourcesLoading: true,
  selectedSource: null,
  searchResults: [],
  selectedAnime: null,
  searching: false,
  roads: [],
  loadingEpisodes: false,
  selectedRoadIndex: 0,
  refreshing: false,
  cached: false,
  initializedScope: null,
  error: null,
};

const EMPTY_SELECTION = {
  searchResults: [],
  selectedAnime: null,
  searching: false,
  roads: [],
  loadingEpisodes: false,
  selectedRoadIndex: 0,
  refreshing: false,
  cached: false,
  error: null,
} satisfies Partial<OnlineSourceState>;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useOnlineSource(
  animeTitle: string | undefined,
  alternativeTitles: readonly string[] = [],
  matchContext: PlaybackMatchContext = {},
) {
  const [state, setState] = useState<OnlineSourceState>(INITIAL);
  const [providerReload, setProviderReload] = useState(0);
  const [searchReload, setSearchReload] = useState(0);
  const [manualSearch, setManualSearch] = useState<{
    scope: string;
    query: string;
  } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const contextRef = useRef(matchContext);
  contextRef.current = matchContext;
  const searchRequestRef = useRef(0);
  const episodesRequestRef = useRef(0);
  const initializedScopeRef = useRef<string | null>(null);
  const catalogScope =
    matchContext.catalogId ??
    (matchContext.anilistId != null ? `anilist:${matchContext.anilistId}` : (animeTitle?.trim() ?? ""));
  const manualQuery =
    manualSearch?.scope === catalogScope ? manualSearch.query : null;
  const alternativeTitleKey = alternativeTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .join("\u0000");

  const patch = useCallback((next: Partial<OnlineSourceState>) => {
    stateRef.current = { ...stateRef.current, ...next };
    setState((current) => ({ ...current, ...next }));
  }, []);

  useEffect(
    () => () => {
      searchRequestRef.current += 1;
      episodesRequestRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    searchRequestRef.current += 1;
    episodesRequestRef.current += 1;
    initializedScopeRef.current = null;
    setManualSearch(null);
    patch({ ...EMPTY_SELECTION, selectedSource: null, initializedScope: null });
  }, [catalogScope, patch]);

  useEffect(() => {
    let cancelled = false;
    void playbackSourceApi
      .list()
      .then((providers) => {
        if (cancelled) return;
        patch({
          providers,
          sources: providers.map((provider) => provider.id),
          sourcesLoading: false,
          error: null,
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          patch({ sourcesLoading: false, error: errorMessage(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [patch, providerReload]);

  // Preferences initialize each work once. A new episode's history fetch or
  // a freshly saved binding must never take control away from a user choice.
  useEffect(() => {
    if (
      !catalogScope ||
      matchContext.preferencesReady === false ||
      initializedScopeRef.current === catalogScope ||
      state.providers.length === 0
    )
      return;
    initializedScopeRef.current = catalogScope;
    patch({
      selectedSource: preferredProviderId(
        state.providers,
        contextRef.current.preferredProviderId,
      ),
      initializedScope: catalogScope,
    });
  }, [catalogScope, matchContext.preferencesReady, patch, state.providers]);

  const loadEpisodes = useCallback(
    async (
      providerId: string,
      candidate: PlaybackCandidate,
      preferredRoadId?: string,
    ) => {
      const requestId = ++episodesRequestRef.current;
      patch({
        selectedAnime: candidate,
        loadingEpisodes: true,
        roads: [],
        selectedRoadIndex: 0,
        refreshing: false,
        cached: false,
        error: null,
      });
      try {
        const roads = await playbackSourceApi.episodes(
          providerId,
          candidate.id,
        );
        if (requestId !== episodesRequestRef.current) return false;
        writeCachedRoads(storage(), providerId, candidate.id, roads);
        const binding = contextRef.current.bindings?.find(
          (item) =>
            item.source_id === providerId &&
            item.remote_media_url === candidate.id,
        );
        patch({
          loadingEpisodes: false,
          roads,
          selectedRoadIndex: initialPlaybackRoad(
            roads,
            contextRef.current.episodeNumber ?? 1,
            binding?.road_index,
            preferredRoadId,
          ),
        });
        return true;
      } catch (reason) {
        if (requestId === episodesRequestRef.current) {
          patch({ loadingEpisodes: false, error: errorMessage(reason) });
        }
        return false;
      }
    },
    [patch],
  );

  /**
   * Fetches the live roads behind a cached list. The line on screen stays
   * (by its ID) while it still has this episode, so a refresh that changes
   * nothing for it does not restart playback; otherwise the live list picks
   * the line exactly as an uncached load does. A failed refresh leaves the
   * cached list, which is what played last time.
   */
  const refreshEpisodes = useCallback(
    async (providerId: string, candidate: PlaybackCandidate) => {
      const requestId = ++episodesRequestRef.current;
      try {
        const roads = await playbackSourceApi.episodes(providerId, candidate.id);
        if (requestId !== episodesRequestRef.current) return;
        writeCachedRoads(storage(), providerId, candidate.id, roads);
        const current = stateRef.current;
        if (sameRoads(roads, current.roads)) {
          patch({ refreshing: false, cached: false });
          return;
        }
        const episodeNumber = contextRef.current.episodeNumber ?? 1;
        const onScreen = current.roads[current.selectedRoadIndex]?.id;
        const kept = roads.findIndex((road) => road.id === onScreen && road.episodes.some((episode) => episode.episodeNumber === episodeNumber));
        const binding = contextRef.current.bindings?.find(
          (item) => item.source_id === providerId && item.remote_media_url === candidate.id,
        );
        patch({
          refreshing: false,
          cached: false,
          roads,
          selectedRoadIndex: kept >= 0 ? kept : initialPlaybackRoad(roads, episodeNumber, binding?.road_index),
        });
      } catch {
        if (requestId === episodesRequestRef.current) patch({ refreshing: false });
      }
    },
    [patch],
  );

  useEffect(() => {
    const providerId = state.selectedSource;
    const query = manualQuery ?? animeTitle?.trim();
    const requestId = ++searchRequestRef.current;
    episodesRequestRef.current += 1;
    if (
      !providerId ||
      !query ||
      initializedScopeRef.current !== catalogScope ||
      providerId !== stateRef.current.selectedSource
    )
      return;
    const manual = manualQuery !== null;
    // The work was matched on this source before: open that match right away
    // and search only to fill the picker, without making playback wait for it.
    const remembered = manual
      ? undefined
      : restoredPlaybackCandidate(providerId, [], contextRef.current.bindings);
    if (remembered) {
      // Its episode list from last time, when it has this episode, starts
      // playback without waiting for the provider; the live list follows.
      const cached = readCachedRoads(storage(), providerId, remembered.id);
      const episodeNumber = contextRef.current.episodeNumber ?? 1;
      const binding = contextRef.current.bindings?.find(
        (item) => item.source_id === providerId && item.remote_media_url === remembered.id,
      );
      const cachedIndex = cached ? initialPlaybackRoad(cached, episodeNumber, binding?.road_index) : -1;
      if (cached && cached[cachedIndex]?.episodes.some((episode) => episode.episodeNumber === episodeNumber)) {
        patch({
          ...EMPTY_SELECTION,
          searchResults: [remembered],
          selectedAnime: remembered,
          roads: cached,
          selectedRoadIndex: cachedIndex,
          refreshing: true,
          cached: true,
        });
        void refreshEpisodes(providerId, remembered);
      } else {
        patch({ ...EMPTY_SELECTION, searchResults: [remembered] });
        void loadEpisodes(providerId, remembered);
      }
      void playbackSourceApi
        .search(
          providerId,
          playbackSearchRequest(
            query,
            alternativeTitleKey ? alternativeTitleKey.split("\u0000") : [],
            contextRef.current,
            false,
          ),
        )
        .then((searchResults) => {
          if (requestId !== searchRequestRef.current) return;
          const saved = searchResults.find((candidate) => candidate.id === remembered.id) ?? remembered;
          patch({ searchResults: [saved, ...searchResults.filter((candidate) => candidate.id !== saved.id)] });
        })
        .catch(() => { /* The remembered match is enough to play. */ });
      return () => {
        if (requestId === searchRequestRef.current) searchRequestRef.current += 1;
      };
    }
    patch({ ...EMPTY_SELECTION, searching: true });
    void playbackSourceApi
      .search(
        providerId,
        playbackSearchRequest(
          query,
          alternativeTitleKey ? alternativeTitleKey.split("\u0000") : [],
          contextRef.current,
          manual,
        ),
      )
      .then((searchResults) => {
        if (requestId !== searchRequestRef.current) return;
        const saved = manual
          ? undefined
          : restoredPlaybackCandidate(
              providerId,
              searchResults,
              contextRef.current.bindings,
            );
        const results =
          saved && !searchResults.some((candidate) => candidate.id === saved.id)
            ? [saved, ...searchResults]
            : searchResults;
        patch({ searching: false, searchResults: results });
        const exactMatches = searchResults.filter(
          (candidate) => candidate.exactMatch,
        );
        if (saved) {
          void loadEpisodes(providerId, saved);
        } else if (!manual && exactMatches.length === 1) {
          void loadEpisodes(providerId, exactMatches[0]);
        }
      })
      .catch((reason: unknown) => {
        if (requestId !== searchRequestRef.current) return;
        const saved = manual
          ? undefined
          : restoredPlaybackCandidate(
              providerId,
              [],
              contextRef.current.bindings,
            );
        if (saved) {
          patch({ searching: false, searchResults: [saved] });
          void loadEpisodes(providerId, saved);
        } else {
          patch({ searching: false, error: errorMessage(reason) });
        }
      });
    return () => {
      if (requestId === searchRequestRef.current) searchRequestRef.current += 1;
    };
  }, [
    alternativeTitleKey,
    animeTitle,
    catalogScope,
    loadEpisodes,
    refreshEpisodes,
    manualQuery,
    matchContext.episodeCount,
    matchContext.year,
    patch,
    searchReload,
    state.selectedSource,
  ]);

  const selectSource = useCallback(
    (selectedSource: string) => {
      const current = stateRef.current;
      if (
        selectedSource === current.selectedSource ||
        !current.sources.includes(selectedSource)
      )
        return;
      searchRequestRef.current += 1;
      episodesRequestRef.current += 1;
      initializedScopeRef.current = catalogScope;
      setManualSearch(null);
      patch({ ...EMPTY_SELECTION, selectedSource, initializedScope: catalogScope });
    },
    [catalogScope, patch],
  );

  const selectAnime = useCallback(
    async (selectedAnime: PlaybackCandidate) => {
      const current = stateRef.current;
      const providerId = current.selectedSource;
      if (
        !providerId ||
        !current.searchResults.some(
          (candidate) => candidate.id === selectedAnime.id,
        )
      )
        return false;
      if (current.selectedAnime?.id === selectedAnime.id && !current.error) {
        if (current.loadingEpisodes) return false;
        if (current.roads.length > 0) return true;
      }
      searchRequestRef.current += 1;
      patch({ searching: false });
      return loadEpisodes(providerId, selectedAnime);
    },
    [loadEpisodes, patch],
  );

  const selectRoad = useCallback(
    (selectedRoadIndex: number) => {
      const current = stateRef.current;
      if (
        !Number.isInteger(selectedRoadIndex) ||
        selectedRoadIndex < 0 ||
        selectedRoadIndex >= current.roads.length ||
        selectedRoadIndex === current.selectedRoadIndex
      )
        return;
      patch({ selectedRoadIndex });
    },
    [patch],
  );

  const getEpisode = useCallback(
    (episodeNumber: number): PlaybackEpisode | undefined =>
      state.roads[state.selectedRoadIndex]?.episodes.find(
        (episode) => episode.episodeNumber === episodeNumber,
      ),
    [state.roads, state.selectedRoadIndex],
  );

  const getResolveRequest = useCallback(
    (episodeNumber: number): PlaybackResolveRequest | null => {
      const candidate = state.selectedAnime;
      const road = state.roads[state.selectedRoadIndex];
      const episode = road?.episodes.find(
        (item) => item.episodeNumber === episodeNumber,
      );
      if (!candidate || !road || !episode) return null;
      return {
        candidateId: candidate.id,
        roadId: road.id,
        episodeId: episode.id,
      };
    },
    [state.roads, state.selectedAnime, state.selectedRoadIndex],
  );

  const selectedProvider = useMemo(
    () =>
      state.providers.find(
        (provider) => provider.id === state.selectedSource,
      ) ?? null,
    [state.providers, state.selectedSource],
  );

  const retry = useCallback(() => {
    const current = stateRef.current;
    patch({ error: null });
    if (current.providers.length === 0) {
      patch({ sourcesLoading: true });
      setProviderReload((value) => value + 1);
    } else if (current.selectedSource && current.selectedAnime) {
      void loadEpisodes(
        current.selectedSource,
        current.selectedAnime,
        current.roads[current.selectedRoadIndex]?.id,
      );
    } else {
      searchRequestRef.current += 1;
      episodesRequestRef.current += 1;
      setSearchReload((value) => value + 1);
    }
  }, [loadEpisodes, patch]);

  const search = useCallback(
    (query: string) => {
      const next = query.trim();
      if (!next) return;
      searchRequestRef.current += 1;
      episodesRequestRef.current += 1;
      patch(EMPTY_SELECTION);
      setManualSearch({ scope: catalogScope, query: next });
      setSearchReload((value) => value + 1);
    },
    [catalogScope, patch],
  );

  // The saved source has been applied (or there is nothing to apply), so an
  // empty selection now really means "choose a match".
  const ready =
    state.error !== null ||
    (state.initializedScope !== null && state.initializedScope === catalogScope) ||
    (!state.sourcesLoading && state.providers.length === 0);

  return {
    ...state,
    ready,
    selectedProvider,
    selectSource,
    selectAnime,
    selectRoad,
    getEpisode,
    getResolveRequest,
    retry,
    search,
    manualQuery,
  };
}
