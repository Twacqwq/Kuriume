import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { historyApi, type WatchHistoryEntry } from "@/lib/store";
import { ChevronRight, Clock, Film, Play, Settings } from "lucide-react";

export const Route = createFileRoute("/me")({
  component: MePage,
});

function MePage() {
  const { data: recentHistory = [] } = useQuery({
    queryKey: ["history-list-recent"],
    queryFn: () => historyApi.list(3, 0),
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">我的</h1>

      {/* Recent history */}
      {recentHistory.length > 0 && (
        <section className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              最近观看
            </h2>
            <Link
              to="/history"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              查看全部
            </Link>
          </div>
          <div className="space-y-2">
            {recentHistory.map((entry) => (
              <RecentHistoryItem key={`${entry.bgm_id}-${entry.episode}`} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {/* Menu links */}
      <div className="space-y-1.5">
        <Link
          to="/history"
          className="flex items-center gap-3 rounded-xl bg-white/4 p-4 transition-colors active:bg-white/8"
        >
          <Clock size={20} className="text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">观看历史</span>
          <ChevronRight size={16} className="text-muted-foreground/50" />
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-3 rounded-xl bg-white/4 p-4 transition-colors active:bg-white/8"
        >
          <Settings size={20} className="text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">设置</span>
          <ChevronRight size={16} className="text-muted-foreground/50" />
        </Link>
      </div>
    </div>
  );
}

function RecentHistoryItem({ entry }: { entry: WatchHistoryEntry }) {
  const progress =
    entry.duration > 0
      ? Math.min(100, (entry.position / entry.duration) * 100)
      : 0;
  const isFinished = progress > 95;

  return (
    <Link
      to="/anime/$id/episode/$ep"
      params={{ id: entry.bgm_id, ep: String(entry.episode) }}
      search={{
        groupId: entry.group_id ?? undefined,
        resolution: entry.resolution ?? undefined,
        subtitle: entry.subtitle ?? undefined,
        provider: undefined,
        t: entry.position > 5 ? entry.position : undefined,
        onlineUrl: undefined,
      }}
      className="flex items-center gap-3 rounded-xl bg-white/4 p-3 transition-colors active:bg-white/8"
    >
      {/* Thumbnail */}
      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
        {entry.cover ? (
          <img
            src={entry.cover}
            alt={entry.anime_title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Film size={12} className="text-white/20" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.anime_title}</p>
        <p className="text-xs text-muted-foreground">
          第 {entry.episode} 话 ·{" "}
          {isFinished ? "已看完" : `看到 ${Math.round(progress)}%`}
        </p>
      </div>

      <Play size={14} className="shrink-0 text-muted-foreground/50" />
    </Link>
  );
}
