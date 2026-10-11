import { AnimeGrid } from "@/components/anime-grid";
import { HeroBanner } from "@/components/hero-banner";
import { HomePageLoading } from "@/components/page-loading";
import { StoredMediaTitle } from "@/components/stored-media-title";
import { Button } from "@/components/ui/button";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { displayAnimeTitle } from "@/lib/display-language";
import {
  ensureCatalogSettings,
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
  loader: ensureCatalogSettings,
  pendingComponent: HomePageLoading,
  component: HomePage,
});

function HomePage() {
  const language = useDisplayLanguage();
  const { data: firstPage, dataUpdatedAt, isError, isPending, refetch } = useQuery(spotlightQuery(language));
  const spotlight = firstPage?.data?.slice(0, 12) ?? [];
  const { data: history = [] } = useQuery({
    queryKey: historyListQueryKey(12, 0),
    queryFn: () => historyApi.list(12, 0),
  });

  // Also covers a language change after the route has already mounted. Wait
  // before mounting AnimeGrid so its first page reuses the spotlight response.
  if (isPending) return <HomePageLoading />;

  return (
    <div className="min-h-full pb-8 md:pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-3 md:px-6 md:pt-10 lg:px-10">
        {spotlight.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl bg-card px-6 text-center">
            <h1 className="text-lg font-bold">{language === "zh" ? (isError ? "动漫列表暂时无法载入" : "暂无推荐作品") : (isError ? "Could not load anime" : "No highlights yet")}</h1>
            <Button variant="secondary" onClick={() => void refetch()}>{language === "zh" ? "重新载入" : "Reload"}</Button>
          </section>
        ) : <HeroBanner items={spotlight.slice(0, 5)} />}

        {history.length > 0 && (
          <section className="mt-8 md:mt-10" aria-labelledby="continue-watching-title">
            <div className="flex items-center justify-between gap-4">
              <h2 id="continue-watching-title" className="text-lg font-bold tracking-tight">{language === "zh" ? "继续观看" : "Continue watching"}</h2>
              <Link to="/watchlist" search={{ view: "history" }} className="flex min-h-11 items-center rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary-readable">{language === "zh" ? "全部" : "View all"}</Link>
            </div>
            <div className="hide-scrollbar -mx-4 mt-3 grid auto-cols-[min(84%,20rem)] grid-flow-col snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:auto-cols-[min(65%,22rem)] md:mx-0 md:px-0 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-3">
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
                    className="group relative flex min-w-0 snap-start gap-3 overflow-hidden rounded-xl bg-card p-3 outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-primary-readable motion-reduce:transition-none"
                  >
                    <div className="h-22 w-15 shrink-0 overflow-hidden rounded-lg bg-white/5">
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
                    <div className="flex min-w-0 flex-1 flex-col py-0.5">
                      <p className="line-clamp-2 text-sm font-medium leading-5">
                        <StoredMediaTitle provider={entry.provider} externalId={entry.external_id} fallback={entry.media_title} />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {language === "zh" ? `第 ${entry.episode} 话` : `Episode ${entry.episode}`}
                      </p>
                      <div className="mt-auto flex items-center gap-2 pt-2 text-xs tabular-nums text-muted-foreground">
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

        <section className="mt-8 md:mt-10" aria-labelledby="season-focus-title">
          <h2 id="season-focus-title" className="text-lg font-bold tracking-tight">
            {language === "zh" ? "本季焦点" : "Season picks"}
          </h2>
          <div className="hide-scrollbar -mx-4 mt-4 grid auto-cols-[42%] grid-flow-col snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 min-[480px]:auto-cols-[30%] sm:auto-cols-[23%] md:mx-0 md:px-0 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4 lg:gap-4 xl:grid-cols-7">
            {spotlight.slice(5, 12).map((media) => (
              <Link
                key={media.id}
                to="/anime/$id"
                params={{ id: media.id }}
                className="group min-w-0 snap-start rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-primary-readable"
              >
                <div className="aspect-2/3 overflow-hidden rounded-xl bg-card">
                  {media.cover && (
                    <img
                      src={media.cover}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <p className="mt-2 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-foreground/90 transition-colors group-hover:text-primary-readable motion-reduce:transition-none">
                  {displayAnimeTitle(media, language)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {media.format
                    ? formatMediaFormat(media.format, language)
                    : (media.year ?? 0) > 0
                      ? media.year
                      : null}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {firstPage && <AnimeGrid
        key={language}
        title={language === "zh" ? "今年的动画" : "Explore this year"}
        queryKey={["anime-list", "AniList", CURRENT_YEAR, language]}
        queryFn={(offset: number) => offset === 0
          ? queryClient.fetchQuery(spotlightQuery(language))
          : fetchSeason(offset, language)}
        initialPageParam={0}
        getNextPageParam={(lastPage) => {
          const next = lastPage.offset + lastPage.limit;
          return next < lastPage.total ? next : undefined;
        }}
        pageSize={SEASON_PAGE_SIZE}
        initialPage={firstPage}
        initialPageUpdatedAt={dataUpdatedAt}
      />}
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatMediaFormat(format: string, language: "en" | "zh") {
  if (language === "en") return ({ TV_SHORT: "Short", MOVIE: "Movie", SPECIAL: "Special" }[format] ?? format);
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
