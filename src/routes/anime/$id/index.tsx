import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  AnimeDetail,
  type AnimeDetailData,
} from "@/components/anime-detail";
import { useQuery } from "@tanstack/react-query";
import type { AnimeInfo, AnimeEpisodes, AnimeCharacters } from "@/lib/types";
import {
  detailQueryOptions,
  episodesQueryOptions,
  charactersQueryOptions,
} from "@/routes/anime/$id";

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
    status: "已完结",
    totalEpisodes: info.total_episodes,
    currentEpisodes: info.total_episodes,
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

  if (!info) return null;

  return (
    <AnimeDetail
      data={toAnimeDetailData(info, episodes, characters)}
      onBack={() => router.history.back()}
    />
  );
}
