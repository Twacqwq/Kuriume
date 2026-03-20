import { TorrentPlayer } from "@/components/torrent-player";
import type { HistoryContext } from "@/components/torrent-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { historyApi } from "@/lib/store";
import { useMikanTorrents } from "@/lib/use-mikan-torrents";
import type { CacheContext } from "@/lib/use-torrent-stream";
import { cn } from "@/lib/utils";
import { detailQueryOptions, episodesQueryOptions } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Check,
  Loader2,
  Play,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  validateSearch: (search: Record<string, unknown>) => ({
    groupId: (search.groupId as string) || undefined,
    resolution: (search.resolution as string) || undefined,
    subtitle: (search.subtitle as string) || undefined,
    t: Number(search.t) || undefined,
  }),
  component: EpisodePage,
});

function EpisodePage() {
  const { id, ep } = Route.useParams();
  const { groupId, resolution, subtitle: searchSubtitle, t: startTime } = Route.useSearch();
  const router = useRouter();
  const epNum = Number(ep);

  const [isTheater, setIsTheater] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Subscribe to cached anime info & episodes — useQuery keeps data
  // reactive across same-route navigations (prev/next episode).
  const { data: animeInfo } = useQuery(detailQueryOptions(id));
  const { data: episodes = [] } = useQuery(
    episodesQueryOptions(id, animeInfo?.total_episodes ?? 100),
  );

  const currentEp = useMemo(
    () => episodes.find((e) => e.ep === epNum),
    [episodes, epNum],
  );

  // ── Auto-resume: query saved position if no explicit `t` param ─

  const { data: historyEntries } = useQuery({
    queryKey: ["history-entry", id, epNum],
    queryFn: () => historyApi.list(200, 0),
    select: (entries) => entries.find((e) => e.bgm_id === id && e.episode === epNum),
    staleTime: Infinity,
  });

  const effectiveStartTime = useMemo(() => {
    if (startTime !== undefined) return startTime;
    if (!historyEntries) return undefined;
    const { position, duration } = historyEntries;
    // Don't resume if nearly finished (>95%) or too early (<5s)
    if (position <= 5 || (duration > 0 && position / duration > 0.95)) return undefined;
    return position;
  }, [startTime, historyEntries]);

  const hasPrev = epNum > 1;
  const hasNext = episodes.some((e) => e.ep === epNum + 1);

  const title = currentEp?.title_cn || currentEp?.title || `第 ${epNum} 话`;
  const animeTitle = animeInfo?.title_cn || animeInfo?.title;
  const subtitle = animeTitle
    ? `${animeTitle} · 第 ${epNum} 话`
    : `第 ${epNum} 话`;

  // ── Resolve torrent source ─────────────────────────────────────

  const mikan = useMikanTorrents(
    id,
    animeTitle,
    groupId,
    resolution,
    animeInfo?.total_episodes,
    searchSubtitle,
  );
  const torrentSource = mikan.getTorrentSource(epNum);

  const navBack = () => router.history.back();

  const navigateToEp = useCallback(
    (targetEp: number) => {
      router.navigate({
        to: "/anime/$id/episode/$ep",
        params: { id, ep: String(targetEp) },
        search: { groupId, resolution, subtitle: searchSubtitle, t: undefined },
      });
    },
    [router, id, groupId, resolution, searchSubtitle],
  );

  const navPrev = hasPrev ? () => navigateToEp(epNum - 1) : undefined;
  const navNext = hasNext ? () => navigateToEp(epNum + 1) : undefined;

  const toggleTheater = useCallback(() => {
    setIsTheater((v) => !v);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const fs = await win.isFullscreen();
    await win.setFullscreen(!fs);
    setIsFullscreen(!fs);
    if (!fs) setIsTheater(true);
    else setIsTheater(false);
  }, []);

  // ── State 1: Loading ──────────────────────────────────────────

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

  // ── State 3: Group selection ──────────────────────────────────

  if (!mikan.selectedGroupId || !torrentSource) {
    const noTorrentForEp = mikan.selectedGroupId && !torrentSource;

    return (
      <div className="flex h-full w-full flex-col bg-black">
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
                        {group.episodeCount} 集 ·{" "}
                        {group.resolutions.join(" / ")}
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

  // ── State 4: Playback ─────────────────────────────────────────

  const cacheContext: CacheContext = {
    bgmId: id,
    episode: epNum,
    animeTitle: animeTitle ?? `Unknown-${id}`,
    groupName: mikan.selectedGroupName ?? "",
    resolution: mikan.preferredResolution ?? "",
    torrentSource,
  };

  const historyContext = useMemo<HistoryContext>(
    () => ({
      bgmId: id,
      episode: epNum,
      animeTitle: animeTitle ?? "",
      episodeTitle: title,
      cover: animeInfo?.cover ?? null,
      groupId: groupId ?? null,
      resolution: resolution ?? null,
      subtitle: searchSubtitle ?? null,
    }),
    [id, epNum, animeTitle, title, animeInfo?.cover, groupId, resolution, searchSubtitle],
  );

  const expanded = isTheater || isFullscreen;

  return (
    <div className="flex h-full w-full flex-col">
      {/* ── Header (hidden in theater/fullscreen) ──────────────── */}
      {!expanded && (
        <div
          className="flex items-center gap-3 border-b border-white/5 bg-background/95 px-5 pt-10 pb-2.5 backdrop-blur-xl"
          data-tauri-drag-region
        >
          <button
            type="button"
            onClick={navBack}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/6 text-white/60 transition-colors hover:bg-white/12 hover:text-white/90"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-foreground">
              {animeTitle}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              第 {epNum} 话 · {title}
            </p>
          </div>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Player area — NO opaque background so native mpv shows through */}
        <div className="relative min-w-0 flex-1">
          <TorrentPlayer
            key={`${id}-${ep}-${torrentSource}`}
            source={torrentSource}
            title={title}
            subtitle={`${subtitle} · ${mikan.selectedGroupName ?? ""}`}
            cacheContext={cacheContext}
            historyContext={historyContext}
            startTime={effectiveStartTime}
            onBack={navBack}
            onPrev={navPrev}
            onNext={navNext}
            isTheater={expanded}
            onToggleTheater={toggleTheater}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        </div>

        {/* Episode sidebar (hidden in theater/fullscreen) */}
        {!expanded && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-white/5 bg-background">
            {/* Source info */}
            <div className="space-y-2 border-b border-white/5 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                资源
              </p>
              <div className="flex flex-wrap gap-1.5">
                {mikan.selectedGroupName && (
                  <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary text-xs"
                  >
                    {mikan.selectedGroupName}
                  </Badge>
                )}
                {mikan.preferredResolution && (
                  <Badge variant="outline" className="text-xs border-white/10">
                    {mikan.preferredResolution}
                  </Badge>
                )}
                {mikan.preferredSubtitle && (
                  <Badge variant="outline" className="text-xs border-white/10">
                    {mikan.preferredSubtitle}
                  </Badge>
                )}
              </div>
            </div>

            {/* Episode list */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <p className="text-xs font-medium text-muted-foreground">
                选集
                <span className="ml-1.5 text-muted-foreground/50">
                  共 {episodes.length} 话
                </span>
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {episodes.map((e) => {
                const isCurrent = e.ep === epNum;
                const hasAired = e.airdate
                  ? new Date(e.airdate) <= new Date()
                  : true;
                const watched =
                  e.progress !== undefined && e.progress >= 100;

                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={!hasAired}
                    onClick={() => {
                      if (e.ep !== epNum) navigateToEp(e.ep);
                    }}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      isCurrent
                        ? "bg-primary/10 text-primary"
                        : hasAired
                          ? "text-foreground/70 hover:bg-white/4 hover:text-foreground"
                          : "cursor-default text-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
                        isCurrent
                          ? "bg-primary text-primary-foreground"
                          : watched
                            ? "bg-white/4 text-muted-foreground/50"
                            : "bg-white/4 text-foreground/60",
                      )}
                    >
                      {isCurrent ? (
                        <Play size={12} fill="currentColor" />
                      ) : (
                        e.ep
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium leading-tight">
                        {e.title_cn || e.title || `第 ${e.ep} 话`}
                      </p>
                      {!hasAired && e.airdate && (
                        <p className="text-[10px] text-muted-foreground/40">
                          {(() => {
                            const d = new Date(e.airdate);
                            return `${d.getMonth() + 1}月${d.getDate()}日`;
                          })()}
                        </p>
                      )}
                      {hasAired && e.duration && (
                        <p className="text-[10px] text-muted-foreground/40">
                          {e.duration}
                        </p>
                      )}
                    </div>

                    {watched && (
                      <Check
                        size={12}
                        className="shrink-0 text-muted-foreground/30"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
