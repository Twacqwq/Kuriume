import { createFileRoute, Outlet } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import { settingsApi, type DisplayLanguage } from "@/lib/store";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";

export const detailQueryOptions = (
  id: string,
  language: DisplayLanguage = "en",
) => ({
  queryKey: ["anime-detail", id, language],
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
  queryFn: () =>
    invoke<AnimeEpisodes[]>("get_episodes", {
      provider: "AniList",
      query: { id, offset: 0, limit },
    }),
});

export const charactersQueryOptions = (id: string) => ({
  queryKey: ["anime-characters", id],
  queryFn: () =>
    invoke<AnimeCharacters[]>("get_characters", {
      provider: "AniList",
      id,
    }),
});

export const Route = createFileRoute("/anime/$id")({
  loader: async ({ params }) => {
    const settings = await queryClient.ensureQueryData({
      queryKey: ["settings"],
      queryFn: settingsApi.get,
      staleTime: Infinity,
    });
    const language = settings.display_language ?? "en";
    const cached = queryClient.getQueryData<AnimeInfo>([
      "anime-detail",
      params.id,
      language,
    ]);
    const detail =
      cached ??
      (await queryClient.fetchQuery(detailQueryOptions(params.id, language)));
    if (!detail) return;

    // Fire-and-forget — don't block route transition for supplementary data
    queryClient.prefetchQuery(
      episodesQueryOptions(params.id, detail.total_episodes),
    );
    queryClient.prefetchQuery(charactersQueryOptions(params.id));
  },
  component: AnimeLayout,
});

function AnimeLayout() {
  return <Outlet />;
}
