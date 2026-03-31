import { createFileRoute } from "@tanstack/react-router";
import { HeroBanner, type BannerItem } from "@/components/hero-banner";
import { AnimeGrid } from "@/components/anime-grid";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import type { AnimeInfo, PagedResult } from "@/lib/types";

const PAGE_SIZE = 50;
const START_YEAR = new Date().getFullYear();

interface YearPageParam {
  year: number;
  offset: number;
}

async function fetchAnimeList(
  param: YearPageParam,
  signal?: AbortSignal,
): Promise<PagedResult<AnimeInfo>> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await invoke<PagedResult<AnimeInfo>>("get_list", {
    provider: "Bangumi",
    query: {
      limit: PAGE_SIZE,
      offset: param.offset,
      soft: "Rank",
      type: 2,
      year: param.year,
    },
  });

  // Seed each item into the detail cache so detail pages get O(1) hits
  for (const item of result.data) {
    queryClient.setQueryData(["anime-detail", item.id], item);
  }

  return result;
}

function getNextAnimePageParam(
  lastPage: PagedResult<AnimeInfo>,
  _allPages: PagedResult<AnimeInfo>[],
  lastParam: YearPageParam,
): YearPageParam | undefined {
  const nextOffset = lastPage.offset + lastPage.limit;
  if (nextOffset < lastPage.total) {
    return { year: lastParam.year, offset: nextOffset };
  }
  const nextYear = lastParam.year - 1;
  return { year: nextYear, offset: 0 };
}

const bannerQueryOptions = {
  queryKey: ["banner", "Bangumi", START_YEAR],
  queryFn: async ({ signal }: { signal?: AbortSignal }) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await invoke<PagedResult<AnimeInfo>>("get_list", {
      provider: "Bangumi",
      query: { limit: 5, offset: 0, soft: "Rank", type: 2, year: START_YEAR },
    });
    return result.data.map(toBannerItem);
  },
};

const animeListInfiniteQueryOptions = {
  queryKey: ["anime-list", "Bangumi"],
  queryFn: ({ pageParam, signal }: { pageParam: YearPageParam; signal?: AbortSignal }) =>
    fetchAnimeList(pageParam, signal),
  initialPageParam: { year: START_YEAR, offset: 0 } as YearPageParam,
  getNextPageParam: getNextAnimePageParam,
};

export const Route = createFileRoute("/")(
  {
  loader: async () => {
    // Background refetch if data already cached; block otherwise
    const hasBanner = queryClient.getQueryData(bannerQueryOptions.queryKey);
    const hasList = queryClient.getQueryData(["anime-list", "Bangumi"]);
    if (hasBanner && hasList) {
      queryClient.prefetchQuery(bannerQueryOptions);
      queryClient.prefetchInfiniteQuery(animeListInfiniteQueryOptions);
      return;
    }
    await Promise.all([
      queryClient.prefetchQuery(bannerQueryOptions),
      queryClient.prefetchInfiniteQuery(animeListInfiniteQueryOptions),
    ]);
  },
  component: IndexComponent,
});

function toBannerItem(info: AnimeInfo): BannerItem {
  return {
    id: Number(info.id),
    title: info.title_cn || info.title,
    cover: info.cover ?? "",
    score: info.score ?? 0,
    year: info.year ?? 0,
    episodes: info.total_episodes,
    genre: [...new Set(info.genres)],
    description: info.description ?? "",
  };
}

function IndexComponent() {
  const { data: bannerItems = [] } = useQuery(bannerQueryOptions);

  return (
    <div className="md:-mt-8">
      <HeroBanner items={bannerItems} />
      {/* Content area — overlaps banner fade zone */}
      <AnimeGrid
        title="全部番剧"
        queryKey={["anime-list", "Bangumi"]}
        queryFn={fetchAnimeList}
        initialPageParam={{ year: START_YEAR, offset: 0 }}
        getNextPageParam={getNextAnimePageParam}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}