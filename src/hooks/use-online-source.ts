/**
 * Hook for searching and selecting online anime sources.
 *
 * Used in the source picker dialog to list search results from online sources,
 * pick an anime, fetch its episode roads, and select an episode URL for playback.
 */
import { onlineSourceApi, type OnlineRoad, type OnlineSearchResult } from "@/lib/online-source";
import { useCallback, useEffect, useState } from "react";

export interface OnlineSourceState {
  /** Available online source names (e.g. "AGE动漫"). */
  sources: string[];
  /** Whether source list is loading. */
  sourcesLoading: boolean;
  /** Currently selected online source name. */
  selectedSource: string | null;
  /** Search results from the selected source. */
  searchResults: OnlineSearchResult[];
  /** Whether search is in progress. */
  searching: boolean;
  /** Error message if any. */
  error: string | null;
  /** Selected anime's episode roads. */
  roads: OnlineRoad[];
  /** Whether episodes are loading. */
  loadingEpisodes: boolean;
  /** Currently selected road index. */
  selectedRoadIndex: number;
}

const INITIAL: OnlineSourceState = {
  sources: [],
  sourcesLoading: true,
  selectedSource: null,
  searchResults: [],
  searching: false,
  error: null,
  roads: [],
  loadingEpisodes: false,
  selectedRoadIndex: 0,
};

export function useOnlineSource(animeTitle: string | undefined) {
  const [state, setState] = useState<OnlineSourceState>(INITIAL);

  const set = (patch: Partial<OnlineSourceState>) =>
    setState((s) => ({ ...s, ...patch }));

  // Load available online sources on mount
  useEffect(() => {
    let cancelled = false;
    onlineSourceApi.list().then((sources) => {
      if (cancelled) return;
      set({
        sources,
        sourcesLoading: false,
        selectedSource: sources[0] ?? null,
      });
    }).catch(() => {
      if (cancelled) return;
      set({ sourcesLoading: false });
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-search when source or anime title changes
  useEffect(() => {
    if (!state.selectedSource || !animeTitle) return;
    let cancelled = false;

    console.log("[online-src] search effect run, source:", state.selectedSource, "title:", animeTitle);
    set({ searching: true, error: null, searchResults: [], roads: [], selectedRoadIndex: 0 });

    onlineSourceApi.search(state.selectedSource, animeTitle).then((results) => {
      console.log("[online-src] search done, cancelled:", cancelled, "results:", results.length);
      if (cancelled) return;
      set({ searching: false, searchResults: results });
    }).catch((e) => {
      console.error("[online-src] search error, cancelled:", cancelled, e);
      if (cancelled) return;
      set({ searching: false, error: String(e) });
    });

    return () => {
      console.log("[online-src] search effect cleanup");
      cancelled = true;
    };
  }, [state.selectedSource, animeTitle]);

  // Auto-fetch episodes when search results arrive (pick first result)
  useEffect(() => {
    if (!state.selectedSource || state.searchResults.length === 0) return;
    const firstResult = state.searchResults[0];
    let cancelled = false;

    console.log("[online-src] episodes effect run, url:", firstResult.url);
    set({ loadingEpisodes: true, roads: [], selectedRoadIndex: 0, error: `effect triggered, url=${firstResult.url}` });

    // Use setTimeout to decouple from React rendering cycle — works around
    // potential iOS WKWebView IPC timing issues with back-to-back invokes.
    const timer = setTimeout(async () => {
      console.log("[online-src] episodes setTimeout fired, cancelled:", cancelled);
      if (cancelled) {
        set({ error: "timer cancelled by cleanup" });
        return;
      }

      const { invoke } = await import("@tauri-apps/api/core");

      // Test 1: direct HTTP fetch test via echo command
      try {
        const echoResult = await invoke<string>("online_source_echo", {
          source: state.selectedSource!,
          pageUrl: firstResult.url,
        });
        set({ error: `HTTP test: ${echoResult}` });
      } catch (echoErr) {
        set({ loadingEpisodes: false, error: `HTTP test FAIL: ${echoErr}` });
        return;
      }

      // Test 2: actual episodes command with timeout
      try {
        const episodesPromise = onlineSourceApi.getEpisodes(state.selectedSource!, firstResult.url);
        const timeoutPromise = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("TIMEOUT 15s")), 15000)
        );
        set({ error: `episodes invoke sent...` });
        const roads = await Promise.race([episodesPromise, timeoutPromise]);
        if (cancelled) return;
        set({ loadingEpisodes: false, roads, error: `DONE! ${roads.length} roads` });
      } catch (e) {
        if (cancelled) return;
        set({ loadingEpisodes: false, error: `episodes error: ${String(e)}` });
      }
    }, 500);

    return () => {
      console.log("[online-src] episodes effect cleanup");
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.selectedSource, state.searchResults]);

  const selectSource = useCallback((name: string) => {
    set({ selectedSource: name });
  }, []);

  const selectAnime = useCallback((result: OnlineSearchResult) => {
    if (!state.selectedSource) return;
    set({ loadingEpisodes: true, roads: [], selectedRoadIndex: 0 });

    onlineSourceApi.getEpisodes(state.selectedSource, result.url).then((roads) => {
      set({ loadingEpisodes: false, roads });
    }).catch((e) => {
      set({ loadingEpisodes: false, error: String(e) });
    });
  }, [state.selectedSource]);

  const selectRoad = useCallback((index: number) => {
    set({ selectedRoadIndex: index });
  }, []);

  /** Get the episode play URL for a given episode number (1-based). */
  const getEpisodeUrl = useCallback((episodeNumber: number): string | undefined => {
    const road = state.roads[state.selectedRoadIndex];
    if (!road) return undefined;
    // Try exact match by index (episodes are usually ordered)
    const ep = road.episodes[episodeNumber - 1];
    return ep?.url;
  }, [state.roads, state.selectedRoadIndex]);

  return {
    ...state,
    selectSource,
    selectAnime,
    selectRoad,
    getEpisodeUrl,
  };
}
