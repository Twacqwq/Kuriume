import { TorrentPlayer } from "@/components/torrent-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/query-client";
import type { AnimeEpisodes, AnimeInfo } from "@/lib/types";
import { useMikanTorrents } from "@/lib/use-mikan-torrents";
import type { CacheContext } from "@/lib/use-torrent-stream";
import { cn } from "@/lib/utils";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Loader2,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  validateSearch: (search: Record<string, unknown>) => ({
    groupId: (search.groupId as string) || undefined,
    resolution: (search.resolution as string) || undefined,
  }),
  component: EpisodePage,
});

function EpisodePage() {
  const { id, ep } = Route.useParams();
  const { groupId, resolution } = Route.useSearch();
  const router = useRouter();
  const epNum = Number(ep);

  // Pull cached anime info & episodes from TanStack Query
  const animeInfo = queryClient.getQueryData<AnimeInfo>(["anime-detail", id]);
  const episodes =
    queryClient.getQueryData<AnimeEpisodes[]>(["anime-episodes", id]) ?? [];

  const currentEp = useMemo(
    () => episodes.find((e) => e.ep === epNum),
    [episodes, epNum],
  );

  const hasPrev = epNum > 1;
  const hasNext = episodes.some((e) => e.ep === epNum + 1);

  const title = currentEp?.title_cn || currentEp?.title || `第 ${epNum} 话`;
  const subtitle = animeInfo
    ? `${animeInfo.title_cn || animeInfo.title} · 第 ${epNum} 话`
    : `第 ${epNum} 话`;

  // ── Resolve torrent source ─────────────────────────────────────

  const animeTitle = animeInfo?.title_cn || animeInfo?.title;
  const mikan = useMikanTorrents(id, animeTitle, groupId, resolution);
  const torrentSource = mikan.getTorrentSource(epNum);

  const navBack = () => router.history.back();
  const navPrev = hasPrev
    ? () =>
        router.navigate({
          to: "/anime/$id/episode/$ep",
          params: { id, ep: String(epNum - 1) },
          search: { groupId, resolution },
        })
    : undefined;
  const navNext = hasNext
    ? () =>
        router.navigate({
          to: "/anime/$id/episode/$ep",
          params: { id, ep: String(epNum + 1) },
          search: { groupId, resolution },
        })
    : undefined;

  // ── State 1: Loading (resolving Mikan ID + fetching groups) ────

  if (mikan.isLoading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-white/50">正在搜索字幕组...</p>
      </div>
    );
  }

  // ── State 2: Error ─────────────────────────────────────────────

  if (mikan.error && mikan.groups.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black">
        <TriangleAlert className="h-10 w-10 text-destructive" />
        <p className="max-w-sm text-center text-sm text-white/60">
          搜索种子资源失败：{mikan.error}
        </p>
        <Button variant="secondary" onClick={navBack} className="gap-2">
          <ArrowLeft size={16} />
          返回
        </Button>
      </div>
    );
  }

  // ── State 3: Groups loaded, needs selection ────────────────────

  if (!mikan.selectedGroupId || !torrentSource) {
    // Group selected but no torrent for this episode
    const noTorrentForEp =
      mikan.selectedGroupId && !torrentSource;

    return (
      <div className="flex h-full w-full flex-col bg-black">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-2">
          <button
            type="button"
            onClick={navBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-white">
              {subtitle}
            </h1>
            <p className="truncate text-sm text-white/50">{title}</p>
          </div>
        </div>

        {/* Subtitle group selector */}
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <Subtitles className="mb-4 h-12 w-12 text-white/20" />
          <h2 className="mb-2 text-lg font-medium text-white/90">
            选择字幕组
          </h2>
          <p className="mb-6 max-w-md text-center text-sm text-white/40">
            该番剧有 {mikan.groups.length} 个字幕组提供资源，请选择你偏好的字幕组
          </p>

          {noTorrentForEp && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
              <TriangleAlert size={16} />
              该字幕组暂无第 {epNum} 话资源，请尝试其他字幕组
            </div>
          )}

          {mikan.groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-white/40">未找到可用的字幕组</p>
              <Button variant="secondary" onClick={navBack} className="gap-2">
                <ArrowLeft size={16} />
                返回
              </Button>
            </div>
          ) : (
            <div className="grid w-full max-w-lg gap-2">
              {mikan.groups.map((group) => {
                const isSelected = mikan.selectedGroupId === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => mikan.selectGroup(group.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all",
                      "border border-white/6 bg-white/3",
                      "hover:border-white/10 hover:bg-white/6",
                      isSelected &&
                        "border-primary/40 bg-primary/10 hover:border-primary/50 hover:bg-primary/15",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-white/10 text-white/40",
                      )}
                    >
                      {isSelected ? (
                        <Check size={16} />
                      ) : (
                        <Subtitles size={14} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm font-medium",
                          isSelected ? "text-white" : "text-white/70",
                        )}
                      >
                        {group.name}
                      </p>
                      <p className="text-xs text-white/40">
                        {group.episodeCount} 集 · {group.resolutions.join(" / ")}
                      </p>
                    </div>
                    {isSelected && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 bg-primary/20 text-primary"
                      >
                        已选择
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── State 4: Torrent source resolved — play ────────────────────

  const cacheContext: CacheContext = {
    bgmId: id,
    episode: epNum,
    animeTitle: animeTitle ?? `Unknown-${id}`,
    groupName: mikan.selectedGroupName ?? "",
    resolution: mikan.preferredResolution ?? "",
    torrentSource,
  };

  return (
    <div className="h-full w-full">
      <TorrentPlayer
        key={`${id}-${ep}-${torrentSource}`}
        source={torrentSource}
        title={title}
        subtitle={`${subtitle} · ${mikan.selectedGroupName ?? ""}`}
        cacheContext={cacheContext}
        onBack={navBack}
        onPrev={navPrev}
        onNext={navNext}
      />
    </div>
  );
}
