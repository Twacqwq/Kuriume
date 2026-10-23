import { AnimeGrid } from "@/components/anime-grid";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import {
  ensureCatalogSettings,
  fetchMangaList,
  MANGA_PAGE_SIZE,
  mangaListKey,
  type MangaSort,
} from "@/lib/catalog-queries";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { createFileRoute, useRouter } from "@tanstack/react-router";

const SORTS: { id: MangaSort; zh: string; en: string }[] = [
  { id: "popular", zh: "热门", en: "Popular" },
  { id: "new", zh: "新作", en: "New" },
];

export const Route = createFileRoute("/manga")({
  validateSearch: (search: Record<string, unknown>): { sort?: MangaSort } => ({
    sort: search.sort === "new" ? "new" : undefined,
  }),
  loader: ensureCatalogSettings,
  component: MangaPage,
});

function MangaPage() {
  const language = useDisplayLanguage();
  const sort: MangaSort = Route.useSearch().sort ?? "popular";
  const router = useRouter();
  const queryKey = [...mangaListKey(sort, language)];

  return (
    <div className="min-h-full pb-8 md:pb-16">
      <PullToRefresh onRefresh={() => queryClient.refetchQueries({ queryKey })} />
      <div className="mx-auto max-w-7xl px-4 pt-4 md:px-6 md:pt-14 lg:px-10">
        <h1 className="sr-only text-3xl font-bold tracking-tight md:not-sr-only">{language === "zh" ? "漫画" : "Manga"}</h1>
        <nav aria-label={language === "zh" ? "漫画排序" : "Manga order"} className="flex gap-1 border-b border-border/60 md:mt-6">
          {SORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={sort === item.id ? "page" : undefined}
              onClick={() => void router.navigate({ to: "/manga", search: { sort: item.id === "new" ? "new" : undefined }, replace: true })}
              className={cn(
                "relative flex min-h-12 flex-1 items-center justify-center rounded-t-md px-4 py-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable motion-reduce:transition-none sm:flex-none",
                sort === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item[language]}
              {sort === item.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </nav>
      </div>
      <AnimeGrid
        key={`${sort}:${language}`}
        kind="manga"
        queryKey={queryKey}
        queryFn={(offset: number) => fetchMangaList(offset, sort, language)}
        initialPageParam={0}
        getNextPageParam={(lastPage) => {
          const next = lastPage.offset + lastPage.limit;
          return next < lastPage.total ? next : undefined;
        }}
        pageSize={MANGA_PAGE_SIZE}
      />
    </div>
  );
}
