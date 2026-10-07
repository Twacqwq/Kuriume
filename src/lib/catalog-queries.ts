import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import { settingsApi, type DisplayLanguage } from "@/lib/store";
import type { AnimeInfo, PagedResult } from "@/lib/types";

export const CURRENT_YEAR = new Date().getFullYear();
export const SEASON_PAGE_SIZE = 30;

export async function currentDisplayLanguage(): Promise<DisplayLanguage> {
  const settings = await queryClient.ensureQueryData({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
    staleTime: Infinity,
  });
  return settings.display_language ?? "en";
}

export async function fetchSeason(
  offset: number,
  language: DisplayLanguage,
  signal?: AbortSignal,
): Promise<PagedResult<AnimeInfo>> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await invoke<PagedResult<AnimeInfo>>("get_list", {
    provider: "AniList",
    language,
    query: {
      limit: SEASON_PAGE_SIZE,
      offset,
      soft: "Rank",
      type: 2,
      year: CURRENT_YEAR,
    },
  });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return result;
}

export const spotlightQuery = (language: DisplayLanguage) => ({
  queryKey: ["home-season-page", CURRENT_YEAR, language],
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchSeason(0, language, signal),
});

const CATALOG_KEYS = new Set([
  "anime-list", "home-season-page", "search", "calendar", "anime-detail",
  "stored-media", "stored-title", "library-list", "history-list",
]);

export async function refreshCatalogLanguage(language: DisplayLanguage) {
  await queryClient.cancelQueries({
    predicate: (query) => CATALOG_KEYS.has(String(query.queryKey[0])),
  });
  await queryClient.invalidateQueries({
    predicate: (query) => CATALOG_KEYS.has(String(query.queryKey[0])),
    refetchType: "none",
  });
  await queryClient.fetchQuery(spotlightQuery(language));
}
