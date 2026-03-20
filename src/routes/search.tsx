import { createFileRoute } from "@tanstack/react-router";
import { AnimeGrid } from "@/components/anime-grid";
import { invoke } from "@tauri-apps/api/core";
import { Search } from "lucide-react";
import type { AnimeInfo, PagedResult } from "@/lib/types";

const PAGE_SIZE = 25;

interface SearchParams {
  q?: string;
}

async function fetchSearchResults(
  keyword: string,
  offset: number,
): Promise<PagedResult<AnimeInfo>> {
  return invoke<PagedResult<AnimeInfo>>("search", {
    provider: "Bangumi",
    query: { keyword, limit: PAGE_SIZE, offset },
  });
}

function getNextSearchPageParam(
  lastPage: PagedResult<AnimeInfo>,
): number | undefined {
  const nextOffset = lastPage.offset + lastPage.limit;
  if (nextOffset < lastPage.total) return nextOffset;
  return undefined;
}

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();

  if (!q) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 pt-[20vh] text-muted-foreground">
        <Search size={40} strokeWidth={1.5} />
        <p className="text-sm">输入关键词开始搜索</p>
      </div>
    );
  }

  return (
    <div>
      <AnimeGrid
        queryKey={["search", q]}
        queryFn={(offset: number) => fetchSearchResults(q, offset)}
        initialPageParam={0}
        getNextPageParam={(lastPage) => getNextSearchPageParam(lastPage)}
        title={`"${q}" 的搜索结果`}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
