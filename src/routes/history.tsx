import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { historyApi, type WatchHistoryEntry } from "@/lib/store";
import { cn } from "@/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Film, Play, Trash2, X } from "lucide-react";
import { useCallback } from "react";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

// ── Time formatting helpers ──────────────────────────────────────

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function groupByDate(entries: WatchHistoryEntry[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: { label: string; items: WatchHistoryEntry[] }[] = [];
  const map = new Map<string, WatchHistoryEntry[]>();

  for (const entry of entries) {
    const d = new Date(entry.watched_at + "Z");
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label: string;
    if (day >= today) label = "今天";
    else if (day >= yesterday) label = "昨天";
    else label = `${d.getMonth() + 1}月${d.getDate()}日`;

    if (!map.has(label)) {
      const items: WatchHistoryEntry[] = [];
      map.set(label, items);
      groups.push({ label, items });
    }
    map.get(label)!.push(entry);
  }
  return groups;
}

function HistoryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: entries = [] } = useQuery({
    queryKey: ["history-list"],
    queryFn: () => historyApi.list(200, 0),
  });

  const removeMutation = useMutation({
    mutationFn: ({ bgmId }: { bgmId: string }) =>
      historyApi.remove(bgmId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history-list"] }),
  });

  const clearMutation = useMutation({
    mutationFn: () => historyApi.clear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history-list"] }),
  });

  const handleResume = useCallback(
    (entry: WatchHistoryEntry) => {
      navigate({
        to: "/anime/$id/episode/$ep",
        params: { id: entry.bgm_id, ep: String(entry.episode) },
        search: {
          groupId: entry.group_id ?? undefined,
          resolution: entry.resolution ?? undefined,
          subtitle: entry.subtitle ?? undefined,
          provider: undefined,
          t: entry.position > 5 ? entry.position : undefined,
        },
      });
    },
    [navigate],
  );

  const dateGroups = groupByDate(entries);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">观看历史</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{entries.length} 条记录</span>
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => clearMutation.mutate()}
            >
              <Trash2 size={14} />
              清空
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Clock size={48} strokeWidth={1.2} className="mb-4 opacity-40" />
          <p className="text-sm">暂无观看记录</p>
        </div>
      )}

      {/* Grouped history list */}
      <div className="space-y-6">
        {dateGroups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.label}
            </h2>
            <div className="space-y-2">
              {group.items.map((entry) => (
                <HistoryCard
                  key={`${entry.bgm_id}-${entry.episode}`}
                  entry={entry}
                  onResume={() => handleResume(entry)}
                  onRemove={() =>
                    removeMutation.mutate({
                      bgmId: entry.bgm_id,
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function HistoryCard({
  entry,
  onResume,
  onRemove,
}: {
  entry: WatchHistoryEntry;
  onResume: () => void;
  onRemove: () => void;
}) {
  const progress =
    entry.duration > 0 ? Math.min(100, (entry.position / entry.duration) * 100) : 0;
  const isFinished = progress > 95;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 rounded-xl border border-white/5 bg-white/2 p-3 transition-colors",
        "hover:border-white/10 hover:bg-white/4",
      )}
    >
      {/* Cover thumbnail */}
      <button
        type="button"
        onClick={onResume}
        className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        {entry.cover ? (
          <img
            src={entry.cover}
            alt={entry.anime_title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <HistoryCoverFallback title={entry.anime_title} />
        )}
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Play size={16} fill="white" className="text-white" />
        </div>
      </button>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to="/anime/$id"
              params={{ id: entry.bgm_id }}
              className="truncate text-sm font-medium text-foreground/90 hover:text-primary"
            >
              {entry.anime_title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              第 {entry.episode} 话
              {entry.episode_title ? ` · ${entry.episode_title}` : ""}
            </p>
          </div>

          {/* Remove button */}
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded-md p-1 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50 hover:text-destructive!"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar + time */}
        <div className="mt-2 flex items-center gap-2">
          <Progress
            value={progress}
            className="h-1 flex-1 bg-white/6"
          />
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            {isFinished ? "已看完" : `看到 ${formatTime(entry.position)}`}
          </span>
        </div>
      </div>

      {/* Resume button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onResume}
        className="shrink-0 gap-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Play size={12} />
        {isFinished ? "重新观看" : "继续观看"}
      </Button>
    </div>
  );
}

function HistoryCoverFallback({ title }: { title: string }) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 40%, 20%) 0%, hsl(${(hue + 40) % 360}, 35%, 12%) 100%)`,
      }}
    >
      <Film size={14} className="text-white/20" strokeWidth={1.5} />
    </div>
  );
}
