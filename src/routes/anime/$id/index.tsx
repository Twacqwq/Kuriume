import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  AnimeDetail,
  type AnimeDetailData,
} from "@/components/anime-detail";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";
import { watchlistApi, type WatchStatus } from "@/lib/store";
import { torrentSourceApi } from "@/lib/torrent-source";

import {
  detailQueryOptions,
  episodesQueryOptions,
  charactersQueryOptions,
} from "@/routes/anime/$id";

function inferStatus(
  info: AnimeInfo,
  episodes: AnimeEpisodes[] = [],
): "连载中" | "已完结" | "未播出" {
  const today = new Date().toISOString().slice(0, 10);

  // Premiere date is in the future → not yet aired
  if (info.air_date && info.air_date > today) return "未播出";

  // Check episode airdates if available
  if (episodes.length > 0) {
    const futureEps = episodes.filter((ep) => ep.airdate && ep.airdate > today);
    if (futureEps.length > 0) return "连载中";
  }

  return "已完结";
}

function toAnimeDetailData(
  info: AnimeInfo,
  episodes: AnimeEpisodes[] = [],
  characters: AnimeCharacters[] = [],
): AnimeDetailData {
  return {
    id: Number(info.id),
    title: info.title_cn || info.title,
    titleOriginal: info.title_cn ? info.title : undefined,
    cover: info.cover ?? "",
    score: info.score ?? 0,
    ratingCount: 0,
    year: info.year ?? 0,
    status: inferStatus(info, episodes),
    totalEpisodes: info.total_episodes,
    currentEpisodes: episodes.length > 0
      ? episodes.filter((ep) => ep.airdate && ep.airdate <= new Date().toISOString().slice(0, 10)).length
      : info.total_episodes,
    genre: [...new Set(info.genres)],
    studio: "",
    director: "",
    description: info.description ?? "",
    episodes,
    characters,
    related: [],
  };
}

export const Route = createFileRoute("/anime/$id/")({
  component: AnimeDetailPage,
});

function AnimeDetailPage() {
  const router = useRouter();
  const { id } = Route.useParams();

  const { data: info } = useQuery(detailQueryOptions(id));
  const { data: episodes } = useQuery({
    ...episodesQueryOptions(id, info?.total_episodes ?? 0),
    enabled: !!info,
  });
  const { data: characters } = useQuery({
    ...charactersQueryOptions(id),
    enabled: !!info,
  });

  const animeTitle = info?.title_cn || info?.title;

  // Background prefetch: warm the torrent source cache for ALL known providers
  // so the source picker dialog can open instantly when the user picks an episode.
  const prefetchEnabled = !!id && !!animeTitle;
  const resolveFn = (provider: string) => async ({ signal }: { signal: AbortSignal }) => {
    if (!id || !animeTitle) return null;
    return torrentSourceApi.resolve(animeTitle, id, signal, provider);
  };
  const resolveOpts = { staleTime: 10 * 60 * 1000, gcTime: 30 * 60 * 1000, retry: 1 as const, enabled: prefetchEnabled };
  useQuery({ queryKey: ["torrent-resolve", "Mikan", id], queryFn: resolveFn("Mikan"), ...resolveOpts });
  useQuery({ queryKey: ["torrent-resolve", "Nyaa", id], queryFn: resolveFn("Nyaa"), ...resolveOpts });
  useQuery({ queryKey: ["torrent-resolve", "DMHY", id], queryFn: resolveFn("DMHY"), ...resolveOpts });

  // ── Watchlist ──
  const qc = useQueryClient();
  const { data: watchEntry } = useQuery({
    queryKey: ["watchlist", id],
    queryFn: () => watchlistApi.get(id),
  });

  const invalidateWatchlist = () => {
    qc.invalidateQueries({ queryKey: ["watchlist", id] });
    qc.invalidateQueries({ queryKey: ["watchlist-list"] });
  };

  const addOrUpdate = useMutation({
    mutationFn: async (status: WatchStatus) => {
      if (watchEntry) {
        await watchlistApi.setStatus(id, status);
      } else {
        await watchlistApi.add(id, info?.title_cn || info?.title || "", info?.cover ?? null, info?.total_episodes ?? 0);
      }
    },
    onSuccess: invalidateWatchlist,
  });

  const remove = useMutation({
    mutationFn: () => watchlistApi.remove(id),
    onSuccess: invalidateWatchlist,
  });

  if (!info) return null;

  return (
    <AnimeDetail
      data={toAnimeDetailData(info, episodes, characters)}
      onBack={() => router.navigate({ to: "/" })}
      watchStatus={watchEntry?.status as WatchStatus | undefined ?? null}
      onWatchStatusChange={(status) => addOrUpdate.mutate(status)}
      onWatchRemove={() => remove.mutate()}
    />
  );
}
