import { Button } from "@/components/ui/button";
import { LibraryControl } from "@/components/library-control";
import { StoredMediaTitle } from "@/components/stored-media-title";
import { LibraryListLoading } from "@/components/page-loading";
import { useCatalogSource, useDisplayLanguage } from "@/hooks/use-display-language";
import {
  catalogId,
  historyApi,
  historyListQueryKey,
  libraryApi,
  LIBRARY_STATUSES,
  type LibraryEntry,
  type LibraryStatus,
  type WatchHistoryEntry,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarQueryOptions } from "@/lib/catalog-queries";
import { airedEpisodes, airingClock, latestEntry, latestPerWork, watchedThrough } from "@/lib/tracking";
import type { AiringSlot, AnimeInfo } from "@/lib/types";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  Check,
  Clock3,
  Library,
  Play,
} from "lucide-react";

type LibraryView = LibraryStatus | "history";

const VIEWS = [
  ...LIBRARY_STATUSES,
  { id: "history", zh: "历史记录", en: "History" },
] as const;

export const Route = createFileRoute("/watchlist")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: VIEWS.some((item) => item.id === search.view)
      ? (search.view as LibraryView)
      : ("following" as LibraryView),
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const language = useDisplayLanguage();
  const { view } = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const library = useQuery({
    queryKey: ["library-list"],
    queryFn: () => libraryApi.list(),
  });
  const historyQuery = useQuery({
    queryKey: historyListQueryKey(200, 0),
    queryFn: () => historyApi.list(200, 0),
  });
  const entries = library.data ?? [];
  const history = historyQuery.data ?? [];
  const activeQuery = view === "history" ? historyQuery : library;
  const refreshLibrary = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["library-list"] }),
    queryClient.invalidateQueries({ queryKey: ["library-entry"] }),
  ]);
  const setStatus = useMutation({
    mutationFn: ({
      mediaId,
      status,
    }: {
      mediaId: string;
      status: LibraryStatus;
    }) => libraryApi.setStatus(mediaId, status),
    onSuccess: refreshLibrary,
  });
  const remove = useMutation({
    mutationFn: (mediaId: string) => libraryApi.remove(mediaId),
    onSuccess: refreshLibrary,
  });
  // Airing progress comes from this week's schedule, which the app already
  // loads once for the calendar: no extra catalog request per followed work
  // (AniList rate-limits, and a burst of detail lookups starves navigation).
  // Bangumi's schedule has dates but no broadcast times, so its works show
  // no unwatched count.
  const source = useCatalogSource();
  const { data: calendar = [] } = useQuery({ ...calendarQueryOptions(language, source), enabled: view === "following" });
  const now = Date.now() / 1000;
  const airing = new Map<string, AnimeInfo>();
  for (const day of calendar) {
    for (const media of day.items) {
      const known = airing.get(media.id);
      // Keep the latest broadcast of the week for each work.
      if (!known || (media.schedule?.airing_at ?? 0) > (known.schedule?.airing_at ?? 0)) airing.set(media.id, media);
    }
  }
  const progress = new Map<string, { aired: number | null; through: number; next: AiringSlot | null }>();
  for (const entry of entries) {
    if (entry.status !== "following") continue;
    const mediaId = catalogId(entry.provider, entry.external_id);
    const media = airing.get(mediaId);
    const slot = media?.schedule ?? null;
    const total = media?.total_episodes || entry.total_episodes;
    const next = slot
      ? (slot.airing_at > now ? slot : (!total || slot.episode < total ? { episode: slot.episode + 1, airing_at: slot.airing_at + 7 * 86_400 } : null))
      : null;
    progress.set(entry.media_id, {
      aired: media ? airedEpisodes(media, now) : null,
      through: watchedThrough(history, mediaId),
      next,
    });
  }
  const unwatched = (entry: LibraryEntry) => {
    const item = progress.get(entry.media_id);
    return item?.aired != null ? Math.max(0, item.aired - item.through) : 0;
  };
  const lastWatched = (entry: LibraryEntry) => latestEntry(history, catalogId(entry.provider, entry.external_id))?.watched_at ?? "";
  const filtered =
    view === "history"
      ? []
      : entries
        .filter((entry) => entry.status === view)
        // New episodes first, then what was watched most recently.
        .sort((a, b) => Number(unwatched(b) > 0) - Number(unwatched(a) > 0)
          || lastWatched(b).localeCompare(lastWatched(a))
          || b.added_at.localeCompare(a.added_at));

  return (
    <div className="mx-auto min-h-full max-w-7xl px-4 pb-8 pt-4 md:px-6 md:pb-16 md:pt-14 lg:px-10">
      <h1 className="sr-only text-3xl font-bold tracking-tight md:not-sr-only">{language === "zh" ? "追番" : "Following"}</h1>

      <nav aria-label={language === "zh" ? "资料库分类" : "Library categories"} className="hide-scrollbar flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border/60 md:mt-6">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? "page" : undefined}
            onClick={() =>
              router.navigate({
                to: "/watchlist",
                search: { view: item.id },
                replace: true,
              })
            }
            className={cn(
              "relative flex min-h-12 flex-1 items-center justify-center gap-2 rounded-t-md px-3 py-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable motion-reduce:transition-none sm:flex-none sm:px-4",
              view === item.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item[language]}
            {item.id !== "history" && library.data && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {entries.filter((entry) => entry.status === item.id).length}
              </span>
            )}
            {view === item.id && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </nav>

      {(setStatus.isError || remove.isError) && (
        <p role="alert" className="mt-4 text-sm text-destructive-readable">
          {language === "zh" ? "资料库更新失败，请重试。" : "Could not update your library. Please retry."}
        </p>
      )}
      {activeQuery.isPending ? (
        <LibraryListLoading />
      ) : activeQuery.isError && !activeQuery.data ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
          <p>{language === "zh" ? "资料库读取失败" : "Could not load your library"}</p>
          <Button variant="outline" onClick={() => void activeQuery.refetch()}>{language === "zh" ? "重试" : "Retry"}</Button>
        </div>
      ) : view === "history" ? (
        <HistoryList history={latestPerWork(history)} />
      ) : filtered.length > 0 ? (
        <div className="mt-2 grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          {filtered.map((entry) => (
            <LibraryCard
              key={entry.media_id}
              entry={entry}
              pending={setStatus.isPending || remove.isPending}
              latest={history.find(
                (item) => item.media_id === entry.media_id,
              )}
              progress={view === "following" ? progress.get(entry.media_id) : undefined}
              onSetStatus={(status) =>
                setStatus.mutate({ mediaId: entry.media_id, status })
              }
              onRemove={() => remove.mutate(entry.media_id)}
            />
          ))}
        </div>
      ) : (
        <EmptyLibrary view={view} />
      )}
    </div>
  );
}

function LibraryCard({
  entry,
  pending,
  latest,
  progress,
  onSetStatus,
  onRemove,
}: {
  entry: LibraryEntry;
  pending: boolean;
  latest?: WatchHistoryEntry;
  progress?: { aired: number | null; through: number; next: AiringSlot | null };
  onSetStatus: (status: LibraryStatus) => void;
  onRemove: () => void;
}) {
  const language = useDisplayLanguage();
  const routeId = catalogId(entry.provider, entry.external_id);
  const percent =
    latest && latest.duration > 0
      ? Math.min(100, (latest.position / latest.duration) * 100)
      : 0;
  const newCount = progress?.aired != null ? Math.max(0, progress.aired - progress.through) : 0;
  // With unwatched episodes, the main action is the first one not yet seen.
  const nextUnseen = newCount > 0 && progress ? progress.through + 1 : null;
  const playEpisode = nextUnseen ?? latest?.episode ?? 1;
  const resume = nextUnseen === null || nextUnseen === latest?.episode ? latest?.position : undefined;
  return (
    <article className="flex min-w-0 items-start gap-3 border-b border-border/60 py-5 sm:gap-4">
      <Link
        to="/anime/$id"
        params={{ id: routeId }}
        className="press h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary-readable sm:h-30 sm:w-20"
        aria-label={entry.title}
      >
        {entry.cover && (
          <img
            src={entry.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/anime/$id"
          params={{ id: routeId }}
          className="line-clamp-2 rounded-sm text-base font-medium leading-snug outline-none transition-colors hover:text-primary-readable focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none"
        >
          <StoredMediaTitle
            provider={entry.provider}
            externalId={entry.external_id}
            fallback={entry.title}
          />
        </Link>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
          {newCount > 0 && (
            <span className="rounded-full bg-highlight/14 px-2 py-0.5 font-bold text-highlight">{language === "zh" ? `${newCount} 话未看` : `${newCount} new`}</span>
          )}
          <span>
            {progress?.aired != null && progress.aired < entry.total_episodes
              ? (language === "zh" ? `更新至 ${progress.aired} / ${entry.total_episodes} 话` : `${progress.aired} of ${entry.total_episodes} out`)
              : entry.total_episodes > 0
                ? (language === "zh" ? `共 ${entry.total_episodes} 话` : `${entry.total_episodes} episodes`)
                : (language === "zh" ? "集数未定" : "Episodes TBA")}
          </span>
          {progress?.next && (
            <span>· {language === "zh" ? `${weekdayLabel(progress.next.airing_at, language)} ${airingClock(progress.next.airing_at, language)} 更新` : `next ${weekdayLabel(progress.next.airing_at, language)} ${airingClock(progress.next.airing_at, language)}`}</span>
          )}
        </p>
        {latest && (
          <div className="mt-3">
            <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
              <span>{language === "zh" ? `看到第 ${latest.episode} 话` : `Episode ${latest.episode}`}</span>
              <span>{Math.round(percent)}%</span>
            </div>
            <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-overlay/8">
              <div
                className="h-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 [&>button]:min-h-12 [&>button]:rounded-xl [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-xs [&>button]:text-muted-foreground [&>button:hover]:bg-secondary">
          <Button asChild size="sm" className="min-h-12 rounded-xl px-3">
            <Link
              to="/anime/$id/episode/$ep"
              params={{
                id: routeId,
                ep: String(playEpisode),
              }}
              search={{ t: resume }}
            >
              <Play size={13} fill="currentColor" />
              {nextUnseen !== null
                ? (language === "zh" ? `看第 ${nextUnseen} 话` : `Play episode ${nextUnseen}`)
                : language === "zh" ? (latest ? "继续" : "播放") : (latest ? "Resume" : "Play")}
            </Link>
          </Button>
          <LibraryControl entry={entry} compact disabled={pending} onSetStatus={onSetStatus} onRemove={onRemove} />
        </div>
      </div>
    </article>
  );
}

function weekdayLabel(airingAt: number, language: string) {
  const date = new Date(airingAt * 1000);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return language === "zh" ? "今天" : "today";
  if (days === 1) return language === "zh" ? "明天" : "tomorrow";
  return date.toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { weekday: "short" });
}

function HistoryList({ history }: { history: WatchHistoryEntry[] }) {
  const language = useDisplayLanguage();
  if (history.length === 0) return <EmptyLibrary view="history" />;
  return (
    <div className="mt-2 divide-y divide-border/60">
      {history.map((entry) => {
        const percent =
          entry.duration > 0
            ? Math.min(100, (entry.position / entry.duration) * 100)
            : 0;
        return (
          <Link
            key={`${entry.media_id}-${entry.episode}`}
            to="/anime/$id/episode/$ep"
            params={{
              id: catalogId(entry.provider, entry.external_id),
              ep: String(entry.episode),
            }}
            search={{ t: entry.position }}
            className="press group flex min-w-0 items-center gap-3 rounded-lg py-4 outline-none transition-colors hover:bg-card active:bg-card focus-visible:ring-2 focus-visible:ring-primary-readable sm:gap-4 sm:px-2"
          >
            <div className="h-21 w-14 shrink-0 overflow-hidden rounded-lg bg-card">
              {entry.cover && (
                <img
                  src={entry.cover}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-base font-medium leading-snug">
                <StoredMediaTitle
                  provider={entry.provider}
                  externalId={entry.external_id}
                  fallback={entry.media_title}
                />
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {language === "zh" ? `第 ${entry.episode} 话` : `Episode ${entry.episode}`} · {Math.round(percent)}%
              </p>
              <time className="mt-1.5 block text-xs text-muted-foreground" dateTime={entry.watched_at}>
                {new Date(entry.watched_at).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}
              </time>
            </div>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary-readable transition-colors group-hover:bg-primary/20"><Play aria-hidden="true" size={18} fill="currentColor" /><span className="sr-only">{language === "zh" ? "继续播放" : "Resume playback"}</span></span>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyLibrary({ view }: { view: LibraryView }) {
  const language = useDisplayLanguage();
  const icon =
    view === "history" ? (
      <Clock3 size={30} />
    ) : view === "completed" ? (
      <Check size={30} />
    ) : (
      <Library size={30} />
    );
  const label = {
    history: language === "zh" ? "暂无观看记录" : "No watch history yet",
    following: language === "zh" ? "还没有追番" : "No anime followed yet",
    completed: language === "zh" ? "还没有看完的动画" : "No completed anime yet",
  }[view];
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <span className="text-primary-readable/70">{icon}</span>
      <p className="text-sm">{label}</p>
      {view === "following" && (
        <Button asChild variant="outline" size="sm" className="mt-2 rounded-full">
          <Link to="/">{language === "zh" ? "浏览首页" : "Browse home"}</Link>
        </Button>
      )}
    </div>
  );
}
