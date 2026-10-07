import { AnimeGrid } from "@/components/anime-grid";
import { HeroBanner } from "@/components/hero-banner";
import { StoredMediaTitle } from "@/components/stored-media-title";
import { Button } from "@/components/ui/button";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { displayAnimeTitle } from "@/lib/display-language";
import {
  currentDisplayLanguage,
  CURRENT_YEAR,
  fetchSeason,
  SEASON_PAGE_SIZE,
  spotlightQuery,
} from "@/lib/catalog-queries";
import { historyApi, historyListQueryKey } from "@/lib/store";
import { queryClient } from "@/lib/query-client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Play } from "lucide-react";

export const Route = createFileRoute("/")({
  loader: async () => {
    const language = await currentDisplayLanguage();
    await queryClient.ensureQueryData(spotlightQuery(language)).catch(() => undefined);
  },
  component: HomePage,
});

function HomePage() {
  const language = useDisplayLanguage();
  const { data: firstPage, isError, isLoading, refetch } = useQuery(spotlightQuery(language));
  const spotlight = firstPage?.data?.slice(0, 12) ?? [];
  const { data: history = [] } = useQuery({
    queryKey: historyListQueryKey(12, 0),
    queryFn: () => historyApi.list(12, 0),
  });

  return (
    <div className="min-h-full pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-4 md:px-6 md:pt-12 lg:px-10">
        {!isLoading && spotlight.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl bg-card px-6 text-center">
            <h1 className="text-lg font-semibold">{isError ? "动漫列表暂时无法载入" : "暂无推荐作品"}</h1>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>重新载入</Button>
          </section>
        ) : <HeroBanner items={spotlight.slice(0, 5)} />}

        {history.length > 0 && (
          <section className="mt-11" aria-labelledby="continue-watching-title">
            <h2 id="continue-watching-title" className="text-lg font-semibold tracking-tight">
              继续观看
            </h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {history.slice(0, 6).map((entry) => {
                const percent =
                  entry.duration > 0
                    ? Math.min(100, (entry.position / entry.duration) * 100)
                    : 0;
                return (
                  <Link
                    key={`${entry.media_id}-${entry.episode}`}
                    to="/anime/$id/episode/$ep"
                    params={{
                      id: `${entry.provider}:${entry.external_id}`,
                      ep: String(entry.episode),
                    }}
                    search={{ t: entry.position }}
                    className="group relative flex min-w-0 gap-4 overflow-hidden rounded-xl border border-border/75 bg-card p-3 outline-none transition-colors hover:border-primary/45 focus-visible:border-primary-readable focus-visible:ring-[3px] focus-visible:ring-primary-readable motion-reduce:transition-none"
                  >
                    <div className="h-24 w-17 shrink-0 overflow-hidden rounded-lg bg-white/5">
                      {entry.cover && (
                        <img
                          src={entry.cover}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 py-1">
                      <p className="truncate text-sm font-medium">
                        <StoredMediaTitle provider={entry.provider} externalId={entry.external_id} fallback={entry.media_title} />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        第 {entry.episode} 话
                      </p>
                      <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Play size={11} fill="currentColor" aria-hidden="true" />
                        {formatTime(entry.position)} / {formatTime(entry.duration)}
                      </div>
                    </div>
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-11" aria-labelledby="season-focus-title">
          <h2 id="season-focus-title" className="text-lg font-semibold tracking-tight">
            本季焦点
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {spotlight.slice(5, 12).map((media) => (
              <Link
                key={media.id}
                to="/anime/$id"
                params={{ id: media.id }}
                className="group min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-primary-readable"
              >
                <div className="aspect-2/3 overflow-hidden rounded-xl bg-card">
                  {media.cover && (
                    <img
                      src={media.cover}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025] motion-reduce:transition-none"
                    />
                  )}
                </div>
                <p className="mt-2 truncate text-xs font-medium text-foreground/82 transition-colors group-hover:text-primary-readable motion-reduce:transition-none">
                  {displayAnimeTitle(media, language)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {media.format
                    ? formatMediaFormat(media.format)
                    : (media.year ?? 0) > 0
                      ? media.year
                      : null}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <AnimeGrid
        key={language}
        title="今年的动画"
        queryKey={["anime-list", "AniList", CURRENT_YEAR, language]}
        queryFn={(offset: number) => fetchSeason(offset, language)}
        initialPageParam={0}
        getNextPageParam={(lastPage) => {
          const next = lastPage.offset + lastPage.limit;
          return next < lastPage.total ? next : undefined;
        }}
        pageSize={SEASON_PAGE_SIZE}
        initialPage={firstPage}
      />
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatMediaFormat(format: string) {
  return (
    {
      TV: "TV",
      TV_SHORT: "短篇",
      MOVIE: "电影",
      OVA: "OVA",
      ONA: "ONA",
      SPECIAL: "特别篇",
    }[format] ?? format
  );
}
