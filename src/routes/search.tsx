import { createFileRoute, redirect } from "@tanstack/react-router";
import { AnimeGrid } from "@/components/anime-grid";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import type { DisplayLanguage } from "@/lib/store";
import { invoke } from "@tauri-apps/api/core";
import type { AnimeInfo, PagedResult } from "@/lib/types";

const PAGE_SIZE = 25;

interface SearchParams {
  q?: string;
}

async function fetchSearchResults(
  keyword: string,
  offset: number,
  language: DisplayLanguage,
): Promise<PagedResult<AnimeInfo>> {
  return invoke<PagedResult<AnimeInfo>>("search", {
    provider: "AniList",
    language,
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
    q: typeof search.q === "string" ? search.q.trim() || undefined : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!search.q) throw redirect({ to: "/", replace: true });
  },
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const language = useDisplayLanguage();

  if (!q) return null;

  return (
    <div>
      <AnimeGrid
        key={`${q}:${language}`}
        queryKey={["search", q, language]}
        queryFn={(offset: number) => fetchSearchResults(q, offset, language)}
        initialPageParam={0}
        getNextPageParam={(lastPage) => getNextSearchPageParam(lastPage)}
        title={language === "zh" ? `“${q}” 的搜索结果` : `Results for “${q}”`}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
