import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { watchlistApi, type WatchStatus, type WatchlistEntry } from "@/lib/store";
import { cn } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkX, Check, Eye, EyeOff, Film, Library } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/watchlist")({
  component: WatchlistPage,
});

const STATUS_TABS: { value: WatchStatus | "all"; label: string; icon: typeof Eye }[] = [
  { value: "all", label: "全部", icon: Library },
  { value: "watching", label: "正在看", icon: Eye },
  { value: "unwatched", label: "未看", icon: EyeOff },
  { value: "completed", label: "已看完", icon: Check },
];

const STATUS_BADGE: Record<WatchStatus, { label: string; className: string }> = {
  watching: { label: "正在看", className: "bg-green-500/15 text-green-400 border-green-500/20" },
  unwatched: { label: "未看", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
  completed: { label: "已看完", className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
};

function WatchlistPage() {
  const [filter, setFilter] = useState<WatchStatus | "all">("all");
  const qc = useQueryClient();

  const { data: entries = [] } = useQuery({
    queryKey: ["watchlist-list", filter === "all" ? undefined : filter],
    queryFn: () => watchlistApi.list(filter === "all" ? undefined : filter),
  });

  const removeMutation = useMutation({
    mutationFn: (bgmId: string) => watchlistApi.remove(bgmId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist-list"] });
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ bgmId, status }: { bgmId: string; status: WatchStatus }) =>
      watchlistApi.setStatus(bgmId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist-list"] });
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">追番列表</h1>
        <span className="text-sm text-muted-foreground">{entries.length} 部</span>
      </div>

      {/* Status filter tabs */}
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(v) => v && setFilter(v as WatchStatus | "all")}
        className="mb-6 justify-start"
      >
        {STATUS_TABS.map((tab) => (
          <ToggleGroupItem
            key={tab.value}
            value={tab.value}
            className="gap-1.5 rounded-full px-4 text-xs data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
          >
            <tab.icon size={14} />
            {tab.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Empty state */}
      {entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Library size={48} strokeWidth={1.2} className="mb-4 opacity-40" />
          <p className="text-sm">
            {filter === "all" ? "还没有追番，去发现页添加吧" : "该分类下暂无番剧"}
          </p>
        </div>
      )}

      {/* Anime grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {entries.map((entry) => (
          <WatchlistCard
            key={entry.bgm_id}
            entry={entry}
            onStatusChange={(status) =>
              statusMutation.mutate({ bgmId: entry.bgm_id, status })
            }
            onRemove={() => removeMutation.mutate(entry.bgm_id)}
          />
        ))}
      </div>
    </div>
  );
}

function WatchlistCard({
  entry,
  onStatusChange,
  onRemove,
}: {
  entry: WatchlistEntry;
  onStatusChange: (status: WatchStatus) => void;
  onRemove: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const badge = STATUS_BADGE[entry.status as WatchStatus] ?? STATUS_BADGE.watching;

  return (
    <div
      className="group relative flex flex-col"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Cover */}
      <Link
        to="/anime/$id"
        params={{ id: entry.bgm_id }}
        className="relative aspect-3/4 overflow-hidden rounded-xl bg-muted"
      >
        {entry.cover ? (
          <img
            src={entry.cover}
            alt={entry.anime_title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <WatchlistCoverFallback title={entry.anime_title} />
        )}

        {/* Hover overlay */}
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200",
            showActions ? "opacity-100" : "opacity-0",
          )}
        />

        {/* Status badge */}
        <Badge
          variant="outline"
          className={cn("absolute left-2 top-2 text-[10px]", badge.className)}
        >
          {badge.label}
        </Badge>

        {/* Episodes */}
        {entry.total_episodes > 0 && (
          <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
            {entry.total_episodes}话
          </span>
        )}
      </Link>

      {/* Hover action buttons */}
      <div
        className={cn(
          "absolute right-2 top-2 flex gap-1 transition-opacity duration-200",
          showActions ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Cycle status */}
        {(["unwatched", "watching", "completed"] as WatchStatus[])
          .filter((s) => s !== entry.status)
          .map((s) => {
            const opt = STATUS_BADGE[s];
            return (
              <Button
                key={s}
                size="icon"
                variant="secondary"
                className="h-7 w-7 rounded-full bg-black/60 backdrop-blur-sm hover:bg-black/80"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStatusChange(s);
                }}
                title={opt.label}
              >
                {s === "watching" && <Eye size={12} />}
                {s === "unwatched" && <EyeOff size={12} />}
                {s === "completed" && <Check size={12} />}
              </Button>
            );
          })}
        <Button
          size="icon"
          variant="secondary"
          className="h-7 w-7 rounded-full bg-black/60 text-red-400 backdrop-blur-sm hover:bg-red-500/20"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          title="取消追番"
        >
          <BookmarkX size={12} />
        </Button>
      </div>

      {/* Title */}
      <Link
        to="/anime/$id"
        params={{ id: entry.bgm_id }}
        className="mt-2 line-clamp-2 text-sm font-medium leading-tight text-foreground/90 transition-colors hover:text-primary"
      >
        {entry.anime_title}
      </Link>
    </div>
  );
}

function WatchlistCoverFallback({ title }: { title: string }) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 p-3"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 40%, 20%) 0%, hsl(${(hue + 40) % 360}, 35%, 12%) 100%)`,
      }}
    >
      <Film size={24} className="text-white/20" strokeWidth={1.5} />
      <span className="line-clamp-2 text-center text-[10px] font-medium leading-snug text-white/40">
        {title}
      </span>
    </div>
  );
}
