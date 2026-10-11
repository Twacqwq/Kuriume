import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_DISPLAY_LANGUAGE, settingsQueryOptions, type DisplayLanguage } from "@/lib/store";
import type { AnimeInfo, CalendarEntry, PagedResult } from "@/lib/types";

export const CURRENT_YEAR = new Date().getFullYear();
export const SEASON_PAGE_SIZE = 30;
export const BROWSE_CACHE = {
  staleTime: 30 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
};

export async function currentDisplayLanguage(): Promise<DisplayLanguage> {
  const settings = await queryClient.ensureQueryData(settingsQueryOptions);
  return settings.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
}

// A warm tab must have a synchronous loader: even an already-resolved promise
// can trigger the router's pending UI. Only the first settings read may block.
export function ensureCatalogSettings() {
  if (!queryClient.getQueryData(settingsQueryOptions.queryKey)) {
    return currentDisplayLanguage().then(() => undefined);
  }
}

export async function fetchSeason(
  offset: number,
  language: DisplayLanguage,
): Promise<PagedResult<AnimeInfo>> {
  return invoke<PagedResult<AnimeInfo>>("get_list", {
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
}

export const spotlightQuery = (language: DisplayLanguage) => ({
  queryKey: ["home-season-page", CURRENT_YEAR, language],
  // IPC cannot abort. Let an in-flight load populate the cache after tab changes.
  queryFn: () => fetchSeason(0, language),
  ...BROWSE_CACHE,
});

export const calendarQueryOptions = (language: DisplayLanguage) => ({
  queryKey: ["calendar", "AniList", language],
  queryFn: () => invoke<CalendarEntry[]>("get_calendar", { provider: "AniList", language }),
  ...BROWSE_CACHE,
});

export async function prefetchBrowseData() {
  const language = await currentDisplayLanguage();
  // Independent requests: a slow calendar must not delay the first home render.
  await Promise.all([
    queryClient.prefetchQuery(spotlightQuery(language)),
    queryClient.prefetchQuery(calendarQueryOptions(language)),
  ]);
}

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
  await Promise.all([
    queryClient.fetchQuery(spotlightQuery(language)),
    queryClient.fetchQuery(calendarQueryOptions(language)),
  ]);
}
