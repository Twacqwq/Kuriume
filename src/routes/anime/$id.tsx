import { createFileRoute, Outlet } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";

export const detailQueryOptions = (id: string) => ({
  queryKey: ["anime-detail", id],
  queryFn: () =>
    invoke<AnimeInfo>("get_detail", {
      provider: "Bangumi",
      id,
    }),
});

export const episodesQueryOptions = (id: string, limit: number) => ({
  queryKey: ["anime-episodes", id],
  queryFn: () =>
    invoke<AnimeEpisodes[]>("get_episodes", {
      provider: "Bangumi",
      query: { id, offset: 0, limit },
    }),
});

export const charactersQueryOptions = (id: string) => ({
  queryKey: ["anime-characters", id],
  queryFn: () =>
    invoke<AnimeCharacters[]>("get_characters", {
      provider: "Bangumi",
      id,
    }),
});

export const Route = createFileRoute("/anime/$id")({
  loader: async ({ params }) => {
    const cached = queryClient.getQueryData<AnimeInfo>([
      "anime-detail",
      params.id,
    ]);
    const detail =
      cached ?? (await queryClient.fetchQuery(detailQueryOptions(params.id)));
    if (!detail) return;

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