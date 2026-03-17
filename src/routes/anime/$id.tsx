import { createFileRoute, Outlet } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "@/lib/query-client";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";

function abortableInvoke<T>(cmd: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return invoke<T>(cmd, args);
}

export const detailQueryOptions = (id: string) => ({
  queryKey: ["anime-detail", id],
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    abortableInvoke<AnimeInfo>("get_detail", {
      provider: "Bangumi",
      id,
    }, signal),
});

export const episodesQueryOptions = (id: string, limit: number) => ({
  queryKey: ["anime-episodes", id],
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    abortableInvoke<AnimeEpisodes[]>("get_episodes", {
      provider: "Bangumi",
      query: { id, offset: 0, limit },
    }, signal),
});

export const charactersQueryOptions = (id: string) => ({
  queryKey: ["anime-characters", id],
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    abortableInvoke<AnimeCharacters[]>("get_characters", {
      provider: "Bangumi",
      id,
    }, signal),
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