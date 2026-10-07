import { useDisplayLanguage } from "@/hooks/use-display-language";
import { displayAnimeTitle } from "@/lib/display-language";
import { catalogId, type DisplayLanguage } from "@/lib/store";
import { storedTitleQueryKey } from "@/lib/stored-title-query";
import type { AnimeInfo } from "@/lib/types";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

const TITLE_REQUEST_CONCURRENCY = 2;
let activeTitleRequests = 0;
const waitingTitleRequests: Array<() => void> = [];

function acquireTitleRequest(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waitingTitleRequests.indexOf(start);
      if (index >= 0) waitingTitleRequests.splice(index, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const start = () => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        waitingTitleRequests.shift()?.();
        return;
      }
      activeTitleRequests += 1;
      resolve(() => {
        activeTitleRequests -= 1;
        waitingTitleRequests.shift()?.();
      });
    };
    if (signal.aborted) {
      abort();
    } else if (activeTitleRequests < TITLE_REQUEST_CONCURRENCY) {
      start();
    } else {
      signal.addEventListener("abort", abort, { once: true });
      waitingTitleRequests.push(start);
    }
  });
}

function findMedia(data: unknown, id: string): AnimeInfo | undefined {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findMedia(item, id);
      if (found) return found;
    }
  } else if (data && typeof data === "object") {
    const value = data as Record<string, unknown>;
    if (value.id === id && typeof value.title_en === "string") {
      return data as AnimeInfo;
    }
    // Catalog responses are pages, infinite pages, or calendar day groups.
    return findMedia(value.data ?? value.pages ?? value.items, id);
  }
  return undefined;
}

function cachedCatalogMedia(
  client: QueryClient,
  id: string,
  language: DisplayLanguage,
): AnimeInfo | undefined {
  const detailKey = ["anime-detail", id, language];
  const detail = client.getQueryData<AnimeInfo>(detailKey);
  if (
    detail && !client.getQueryState(detailKey)?.isInvalidated &&
    (language === "en" || detail.title_cn)
  ) return detail;
  const catalogs = client.getQueriesData({
    predicate: (query) =>
      ["anime-list", "home-season-page", "search", "calendar"].includes(
        String(query.queryKey[0]),
      ) && query.queryKey.includes(language) && !query.state.isInvalidated,
  });
  for (const [, data] of catalogs) {
    const media = findMedia(data, id);
    if (media && (language === "en" || media.title_cn)) return media;
  }
  return undefined;
}

/** Mount only while its title is visible, so offscreen history cannot enqueue requests. */
export function useStoredMediaTitle(
  provider: string,
  externalId: string,
  fallback: string,
): string {
  const language = useDisplayLanguage();
  const client = useQueryClient();
  const catalogProvider = provider.toLowerCase();
  const id = catalogId(catalogProvider, externalId);
  const cached = cachedCatalogMedia(client, id, language);
  const { data } = useQuery({
    queryKey: storedTitleQueryKey(id, language),
    queryFn: async ({ signal }) => {
      const release = await acquireTitleRequest(signal);
      try {
        const media = await invoke<AnimeInfo>("get_detail", {
          provider: "AniList",
          id,
          language,
        });
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return media;
      } finally {
        release();
      }
    },
    enabled: catalogProvider === "anilist" && !cached,
    // A list card can provide a title immediately without being written into
    // the full-detail cache or pretending its synopsis has been fetched.
    placeholderData: cached,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const current = cached ?? data;
  return current ? displayAnimeTitle(current, language) : fallback;
}
