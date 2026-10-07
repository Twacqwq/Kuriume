import { Button } from "@/components/ui/button";
import { LibraryControl } from "@/components/library-control";
import { StoredMediaTitle } from "@/components/stored-media-title";
import { useDisplayLanguage } from "@/hooks/use-display-language";
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
  const filtered =
    view === "history"
      ? []
      : entries.filter((entry) => entry.status === view);

  return (
    <div className="mx-auto min-h-full max-w-7xl px-6 pb-16 pt-14 lg:px-10">
      <h1 className="text-2xl font-semibold">{language === "zh" ? "资料库" : "Library"}</h1>

      <nav aria-label={language === "zh" ? "资料库分类" : "Library categories"} className="mt-7 flex gap-1 border-b border-border/60">
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
              "relative flex items-center gap-2 rounded-t-md px-4 py-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-primary-readable motion-reduce:transition-none",
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
        <p role="status" className="py-16 text-center text-sm text-muted-foreground">{language === "zh" ? "正在载入…" : "Loading…"}</p>
      ) : activeQuery.isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
          <p>{language === "zh" ? "资料库读取失败" : "Could not load your library"}</p>
          <Button variant="outline" onClick={() => void activeQuery.refetch()}>{language === "zh" ? "重试" : "Retry"}</Button>
        </div>
      ) : view === "history" ? (
        <HistoryList history={history} />
      ) : filtered.length > 0 ? (
        <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-4">
          {filtered.map((entry) => (
            <LibraryCard
              key={entry.media_id}
              entry={entry}
              pending={setStatus.isPending || remove.isPending}
              latest={history.find(
                (item) => item.media_id === entry.media_id,
              )}
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
  onSetStatus,
  onRemove,
}: {
  entry: LibraryEntry;
  pending: boolean;
  latest?: WatchHistoryEntry;
  onSetStatus: (status: LibraryStatus) => void;
  onRemove: () => void;
}) {
  const language = useDisplayLanguage();
  const routeId = catalogId(entry.provider, entry.external_id);
  const percent =
    latest && latest.duration > 0
      ? Math.min(100, (latest.position / latest.duration) * 100)
      : 0;
  return (
    <article className="group flex min-w-0 gap-4 rounded-xl border border-white/5 bg-card/55 p-3 transition hover:border-white/10 hover:bg-card/75">
      <Link
        to="/anime/$id"
        params={{ id: routeId }}
        className="h-32 w-22 shrink-0 overflow-hidden rounded-lg bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-primary-readable"
        aria-label={entry.title}
      >
        {entry.cover && (
          <img
            src={entry.cover}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <Link
          to="/anime/$id"
          params={{ id: routeId }}
          className="line-clamp-2 rounded-sm text-sm font-medium leading-5 outline-none transition-colors hover:text-primary-readable focus-visible:ring-[3px] focus-visible:ring-primary-readable motion-reduce:transition-none"
        >
          <StoredMediaTitle
            provider={entry.provider}
            externalId={entry.external_id}
            fallback={entry.title}
          />
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          {entry.total_episodes > 0
            ? (language === "zh" ? `共 ${entry.total_episodes} 话` : `${entry.total_episodes} episodes`)
            : (language === "zh" ? "集数未定" : "Episodes TBA")}
        </p>
        {latest && (
          <div className="my-3">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{language === "zh" ? `看到第 ${latest.episode} 话` : `Episode ${latest.episode}`}</span>
              <span>{Math.round(percent)}%</span>
            </div>
            <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/6">
              <div
                className="h-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button asChild size="sm" className="rounded-full">
            <Link
              to="/anime/$id/episode/$ep"
              params={{
                id: routeId,
                ep: String(latest?.episode ?? 1),
              }}
              search={{ t: latest?.position }}
            >
              <Play size={13} fill="currentColor" />
              {language === "zh" ? (latest ? "继续" : "播放") : (latest ? "Resume" : "Play")}
            </Link>
          </Button>
          <LibraryControl entry={entry} compact disabled={pending} onSetStatus={onSetStatus} onRemove={onRemove} />
        </div>
      </div>
    </article>
  );
}

function HistoryList({ history }: { history: WatchHistoryEntry[] }) {
  const language = useDisplayLanguage();
  if (history.length === 0) return <EmptyLibrary view="history" />;
  return (
    <div className="mt-7 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-card/45">
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
            className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/3"
          >
            <div className="h-15 w-10 shrink-0 overflow-hidden rounded bg-white/5">
              {entry.cover && (
                <img
                  src={entry.cover}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <StoredMediaTitle
                  provider={entry.provider}
                  externalId={entry.external_id}
                  fallback={entry.media_title}
                />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {language === "zh" ? `第 ${entry.episode} 话` : `Episode ${entry.episode}`} · {Math.round(percent)}%
              </p>
            </div>
            <time className="text-[11px] text-muted-foreground/55">
              {new Date(entry.watched_at).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}
            </time>
            <Play size={14} className="text-primary" />
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
