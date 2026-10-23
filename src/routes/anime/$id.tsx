import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { counterpartQueryOptions, listedAnime } from "@/lib/catalog-queries";
import { queryClient } from "@/lib/query-client";
import { useCatalogSource } from "@/hooks/use-display-language";
import { catalogProviderFor, catalogSourceOf, DEFAULT_CATALOG_SOURCE, DEFAULT_DISPLAY_LANGUAGE, settingsQueryOptions, type CatalogSource, type DisplayLanguage } from "@/lib/store";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";

export const detailQueryOptions = (
  id: string,
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
) => ({
  queryKey: ["anime-detail", id, language],
  staleTime: 30 * 60 * 1000,
  // Opened from a list: draw from the list's entry while the lookup runs.
  placeholderData: () => listedAnime(id),
  // Tauri requests cannot be aborted. Consuming a query signal here lets an
  // unmounting card cancel the route loader's shared request during navigation.
  queryFn: () =>
    invoke<AnimeInfo>("get_detail", {
      provider: catalogProviderFor(id),
      id,
      language,
    }),
});

export const episodesQueryOptions = (id: string, limit: number) => ({
  queryKey: ["anime-episodes", id],
  staleTime: 30 * 60 * 1000,
  queryFn: () =>
    invoke<AnimeEpisodes[]>("get_episodes", {
      provider: catalogProviderFor(id),
      query: { id, offset: 0, limit },
    }),
});

export const charactersQueryOptions = (id: string) => ({
  queryKey: ["anime-characters", id],
  staleTime: 60 * 60 * 1000,
  queryFn: () =>
    invoke<AnimeCharacters[]>("get_characters", {
      provider: catalogProviderFor(id),
      id,
    }),
});

/** The same page (details or an episode) for another catalog ID. */
export function sameView(pathname: string, id: string) {
  if (pathname.startsWith("/manga/")) return { to: "/manga/$id" as const, params: { id } };
  const episode = /\/episode\/([^/]+)\/?$/.exec(pathname)?.[1];
  return episode
    ? { to: "/anime/$id/episode/$ep" as const, params: { id, ep: decodeURIComponent(episode) } }
    : { to: "/anime/$id" as const, params: { id } };
}

/**
 * A saved item from the other catalog opens as the chosen catalog's entry.
 * True while that lookup runs or the redirect is pending, so pages hold their
 * catalog requests (the original catalog may be unreachable).
 */
export function useCatalogRedirect(id: string, catalog?: CatalogSource): boolean {
  const animeSource = useCatalogSource();
  const source = catalog ?? animeSource;
  const foreign = catalogSourceOf(id) !== source;
  const { data: target, isPending } = useQuery({ ...counterpartQueryOptions(id, source), enabled: foreign });
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  useEffect(() => {
    if (target) void navigate({ ...sameView(location.pathname, target), search: location.search as never, replace: true });
    // Once per resolved target; the location is read at that moment.
  }, [target]);
  return foreign && (isPending || !!target);
}

export const Route = createFileRoute("/anime/$id")({
  loader: async ({ params, preload, location }) => {
    // "intent" preloading runs this on hover and on every touch that starts a
    // scroll over a card. Preloads may only use the cache: each AniList lookup
    // counts against a 30-per-minute limit (see lib.rs/anilist gate).
    if (preload) return;
    const settings = await queryClient.ensureQueryData(settingsQueryOptions);
    const language = settings.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
    const source = settings.catalog_source ?? DEFAULT_CATALOG_SOURCE;
    if (catalogSourceOf(params.id) !== source) {
      const target = await queryClient.fetchQuery(counterpartQueryOptions(params.id, source));
      if (target) throw redirect({ ...sameView(location.pathname, target), search: location.search as never, replace: true });
    }
    const cached = queryClient.getQueryData<AnimeInfo>([
      "anime-detail",
      params.id,
      language,
    ]);
    // From a list the page can draw at once; the full lookup finishes there.
    const listed = cached ? undefined : listedAnime(params.id);
    if (listed) void queryClient.prefetchQuery(detailQueryOptions(params.id, language));
    const detail =
      cached ??
      listed ??
      (await queryClient.fetchQuery(detailQueryOptions(params.id, language)));
    if (!detail) return;
    // Catalog IDs name anime and manga alike: a manga opens its own page.
    if (detail.kind === "manga") throw redirect({ to: "/manga/$id", params: { id: params.id }, replace: true });

    // Episodes are needed by both the details and player pages. Characters
    // are fetched by the details page itself, never on the way to the player.
    void queryClient.prefetchQuery(
      episodesQueryOptions(params.id, detail.total_episodes),
    );
  },
  component: AnimeLayout,
});

function AnimeLayout() {
  return <Outlet />;
}
