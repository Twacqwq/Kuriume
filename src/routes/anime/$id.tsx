import { createFileRoute, Outlet } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_DISPLAY_LANGUAGE, settingsQueryOptions, type DisplayLanguage } from "@/lib/store";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";

export const detailQueryOptions = (
  id: string,
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
) => ({
  queryKey: ["anime-detail", id, language],
  staleTime: 30 * 60 * 1000,
  // Tauri requests cannot be aborted. Consuming a query signal here lets an
  // unmounting card cancel the route loader's shared request during navigation.
  queryFn: () =>
    invoke<AnimeInfo>("get_detail", {
      provider: "AniList",
      id,
      language,
    }),
});

export const episodesQueryOptions = (id: string, limit: number) => ({
  queryKey: ["anime-episodes", id],
  staleTime: 30 * 60 * 1000,
  queryFn: () =>
    invoke<AnimeEpisodes[]>("get_episodes", {
      provider: "AniList",
      query: { id, offset: 0, limit },
    }),
});

export const charactersQueryOptions = (id: string) => ({
  queryKey: ["anime-characters", id],
  staleTime: 60 * 60 * 1000,
  queryFn: () =>
    invoke<AnimeCharacters[]>("get_characters", {
      provider: "AniList",
      id,
    }),
});

export const Route = createFileRoute("/anime/$id")({
  loader: async ({ params, preload }) => {
    // "intent" preloading runs this on hover and on every touch that starts a
    // scroll over a card. Preloads may only use the cache: each AniList lookup
    // counts against a 30-per-minute limit (see lib.rs/anilist gate).
    if (preload) return;
    const settings = await queryClient.ensureQueryData(settingsQueryOptions);
    const language = settings.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
    const cached = queryClient.getQueryData<AnimeInfo>([
      "anime-detail",
      params.id,
      language,
    ]);
    const detail =
      cached ??
      (await queryClient.fetchQuery(detailQueryOptions(params.id, language)));
    if (!detail) return;

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
