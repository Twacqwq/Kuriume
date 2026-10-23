import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import { CATALOG_PROVIDERS, catalogApi, catalogProviderFor, catalogSourceOf, DEFAULT_CATALOG_SOURCE, DEFAULT_DISPLAY_LANGUAGE, libraryApi, settingsQueryOptions, type CatalogSource, type DisplayLanguage } from "@/lib/store";
import type { AnimeInfo, CalendarEntry, PagedResult, RelatedMedia } from "@/lib/types";

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

export async function currentCatalogSource(): Promise<CatalogSource> {
  const settings = await queryClient.ensureQueryData(settingsQueryOptions);
  return settings.catalog_source ?? DEFAULT_CATALOG_SOURCE;
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
  source: CatalogSource = DEFAULT_CATALOG_SOURCE,
): Promise<PagedResult<AnimeInfo>> {
  return invoke<PagedResult<AnimeInfo>>("get_list", {
    provider: CATALOG_PROVIDERS[source],
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

export const MANGA_PAGE_SIZE = 30;
/** The manga page's orders: what is popular now, and the newest series. */
export type MangaSort = "popular" | "new";

export async function fetchMangaList(
  offset: number,
  sort: MangaSort,
  language: DisplayLanguage,
  source: CatalogSource = DEFAULT_CATALOG_SOURCE,
): Promise<PagedResult<AnimeInfo>> {
  return invoke<PagedResult<AnimeInfo>>("get_list", {
    provider: CATALOG_PROVIDERS[source],
    language,
    query: {
      limit: MANGA_PAGE_SIZE,
      offset,
      soft: sort === "new" ? "Date" : "Rank",
      kind: "manga",
    },
  });
}

export const mangaListKey = (sort: MangaSort, language: DisplayLanguage, source: CatalogSource) =>
  ["manga-list", source, sort, language] as const;

/** Anime and manga linked to a work: its original, adaptations, sequels. */
export const relationsQueryOptions = (id: string) => ({
  queryKey: ["catalog-relations", id],
  staleTime: 60 * 60 * 1000,
  queryFn: () => invoke<RelatedMedia[]>("get_relations", { provider: catalogProviderFor(id), id }),
});

export const spotlightQuery = (language: DisplayLanguage, source: CatalogSource = DEFAULT_CATALOG_SOURCE) => ({
  queryKey: ["home-season-page", CURRENT_YEAR, language, source],
  // IPC cannot abort. Let an in-flight load populate the cache after tab changes.
  queryFn: () => fetchSeason(0, language, source),
  ...BROWSE_CACHE,
});

export const calendarQueryOptions = (language: DisplayLanguage, source: CatalogSource = DEFAULT_CATALOG_SOURCE) => ({
  queryKey: ["calendar", CATALOG_PROVIDERS[source], language],
  queryFn: () => invoke<CalendarEntry[]>("get_calendar", { provider: CATALOG_PROVIDERS[source], language }),
  ...BROWSE_CACHE,
});

export async function prefetchBrowseData() {
  const language = await currentDisplayLanguage();
  const source = await currentCatalogSource();
  // Independent requests: a slow calendar must not delay the first home render.
  await Promise.all([
    queryClient.prefetchQuery(spotlightQuery(language, source)),
    queryClient.prefetchQuery(calendarQueryOptions(language, source)),
  ]);
}

const CATALOG_KEYS = new Set([
  "anime-list", "home-season-page", "search", "calendar", "anime-detail",
  "stored-media", "stored-title", "library-list", "history-list", "catalog-counterpart",
  "manga-list", "catalog-relations",
]);

/** After a language or data-source change: drop catalog caches, reload home and schedule. */
export async function refreshCatalog(language: DisplayLanguage, source: CatalogSource = DEFAULT_CATALOG_SOURCE) {
  await queryClient.cancelQueries({
    predicate: (query) => CATALOG_KEYS.has(String(query.queryKey[0])),
  });
  await queryClient.invalidateQueries({
    predicate: (query) => CATALOG_KEYS.has(String(query.queryKey[0])),
    refetchType: "none",
  });
  await Promise.all([
    queryClient.fetchQuery(spotlightQuery(language, source)),
    queryClient.fetchQuery(calendarQueryOptions(language, source)),
  ]);
}

export const refreshCatalogLanguage = refreshCatalog;

/**
 * Where a catalog ID should open under `source`: itself, or the chosen
 * catalog's entry for the same saved work. Lookup failures fall back to the
 * ID itself, so a mapping problem never blocks opening the item.
 */
export const counterpartQueryOptions = (id: string, source: CatalogSource) => ({
  queryKey: ["catalog-counterpart", id, source],
  staleTime: Infinity,
  queryFn: async () => {
    if (catalogSourceOf(id) === source) return null;
    try {
      return await catalogApi.counterpart(id);
    } catch {
      return null;
    }
  },
});

/** Bounds the catalog searches one pass may make. */
const LINK_BATCH = 30;
let linking: Promise<void> | undefined;

/**
 * Give followed works an ID in the chosen catalog, one at a time and best
 * effort, so today's updates and the schedule recognise them after the data
 * source changes. Already-linked works cost no request.
 */
export function linkFollowedToCatalog(): Promise<void> {
  linking ??= (async () => {
    const source = await currentCatalogSource();
    const library = await libraryApi.list("following").catch(() => []);
    const pending = library.filter((entry) => entry.provider !== source).slice(0, LINK_BATCH);
    let linked = false;
    for (const entry of pending) {
      const id = `${entry.provider}:${entry.external_id}`;
      if (await queryClient.fetchQuery(counterpartQueryOptions(id, source))) linked = true;
    }
    if (linked) {
      await queryClient.invalidateQueries({
        predicate: (query) => ["library-list", "history-list", "library-entry"].includes(String(query.queryKey[0])),
      });
    }
  })().finally(() => { linking = undefined; });
  return linking;
}

const LISTING_KEYS = new Set(["anime-list", "home-season-page", "search", "search-suggest", "calendar", "manga-list", "catalog-relations"]);

/**
 * The entry for `id` from a list already on screen (home, search, schedule):
 * enough to draw the details page at once while its own lookup finishes. No
 * request is made, so catalog rate limits are unaffected.
 */
export function listedAnime(id: string): AnimeInfo | undefined {
  const scan = (value: unknown, depth = 0): AnimeInfo | undefined => {
    if (!value || typeof value !== "object" || depth > 4) return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = scan(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (record.id === id && typeof record.title === "string") return value as AnimeInfo;
    for (const key of ["data", "pages", "items", "media"]) {
      const found = scan(record[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  for (const [key, data] of queryClient.getQueriesData({ predicate: (query) => LISTING_KEYS.has(String(query.queryKey[0])) })) {
    if (!key) continue;
    const found = scan(data);
    if (found) return found;
  }
  return undefined;
}
