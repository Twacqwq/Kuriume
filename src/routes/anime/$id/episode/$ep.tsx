import { TorrentPlayer } from "@/components/torrent-player";
import type { HistoryContext } from "@/components/torrent-player";
import { Button } from "@/components/ui/button";
import { historyApi } from "@/lib/store";
import { useTorrentSource } from "@/hooks/use-torrent-source";
import type { CacheContext } from "@/hooks/use-torrent-stream";
import { cn } from "@/lib/utils";
import { detailQueryOptions, episodesQueryOptions } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Check,
  Languages,
  Loader2,
  Monitor,
  Play,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  validateSearch: (search: Record<string, unknown>) => ({
    groupId: (search.groupId as string) || undefined,
    resolution: (search.resolution as string) || undefined,
    subtitle: (search.subtitle as string) || undefined,
    provider: (search.provider as string) || undefined,
    t: Number(search.t) || undefined,
  }),
  component: EpisodePage,
});

function EpisodePage() {
  const { id, ep } = Route.useParams();
  const { groupId, resolution, subtitle: searchSubtitle, provider: searchProvider, t: startTime } = Route.useSearch();
  const router = useRouter();
  const epNum = Number(ep);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    getCurrentWindow().isFullscreen().then(setIsFullscreen);
  }, []);

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

  const source = useTorrentSource(
    id,
    animeTitle,
    groupId,
    resolution,
    animeInfo?.total_episodes,
    searchSubtitle,
    searchProvider,
  );
  const torrentSource = source.getTorrentSource(epNum);

  const navBack = () => router.navigate({ to: "/anime/$id", params: { id } });

  const navigateToEp = useCallback(
    (targetEp: number) => {
      router.navigate({
        to: "/anime/$id/episode/$ep",
        params: { id, ep: String(targetEp) },
        search: { groupId, resolution, subtitle: searchSubtitle, provider: searchProvider, t: undefined },
      });
    },
    [router, id, groupId, resolution, searchSubtitle, searchProvider],
  );

  const navPrev = hasPrev ? () => navigateToEp(epNum - 1) : undefined;
  const navNext = hasNext ? () => navigateToEp(epNum + 1) : undefined;

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const fs = await win.isFullscreen();
    await win.setFullscreen(!fs);
    setIsFullscreen(!fs);
  }, []);

  // ── Contexts (must be above early returns to satisfy Rules of Hooks) ──

  const cacheContext: CacheContext = {
    bgmId: id,
    episode: epNum,
    animeTitle: animeTitle ?? `Unknown-${id}`,
    groupName: source.selectedGroupName ?? "",
    resolution: source.preferredResolution ?? "",
    torrentSource: torrentSource ?? "",
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

  // ── Derived ────────────────────────────────────────────────────

  const activeGroup = source.selectedGroupId
    ? source.getGroupData(source.selectedGroupId)
    : undefined;
  const hasSource = !!torrentSource;
  const hasError = !!source.error && source.groups.length === 0;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col">
      {/* ── Header (hidden in fullscreen) ─────────────────────── */}
      {!isFullscreen && (
        <div
          className="flex items-center gap-3 border-b border-white/5 bg-background px-5 pt-10 pb-2.5"
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
        {/* Player area */}
        <div className="relative min-w-0 flex-1">
          {source.isLoading ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-white/50">正在搜索字幕组...</p>
            </div>
          ) : hasError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black">
              <TriangleAlert className="h-10 w-10 text-destructive" />
              <p className="max-w-sm text-center text-sm text-white/60">
                搜索种子资源失败：{source.error}
              </p>
              <Button variant="secondary" onClick={navBack} className="gap-2">
                <ArrowLeft size={16} />
                返回
              </Button>
            </div>
          ) : !hasSource ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black">
              <Subtitles className="h-10 w-10 text-white/15" />
              <p className="text-sm text-white/50">
                {source.groups.length === 0
                  ? "未找到可用的字幕组"
                  : `当前字幕组暂无第 ${epNum} 话资源`}
              </p>
              {source.groups.length > 0 && (
                <p className="text-xs text-white/30">请在右侧切换字幕组</p>
              )}
            </div>
          ) : (
            <TorrentPlayer
              key={`${id}-${ep}-${torrentSource}`}
              source={torrentSource}
              title={title}
              subtitle={`${subtitle} · ${source.selectedGroupName ?? ""}`}
              cacheContext={cacheContext}
              historyContext={historyContext}
              startTime={effectiveStartTime}
              onBack={navBack}
              onPrev={navPrev}
              onNext={navNext}
              onToggleFullscreen={toggleFullscreen}
              isFullscreen={isFullscreen}
            />
          )}
        </div>

        {/* ── Sidebar (hidden in fullscreen) ───────────────────── */}
        {!isFullscreen && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-white/5 bg-background">
            {/* ── Source selector ── */}
            <div className="max-h-[50%] shrink-0 overflow-y-auto border-b border-white/5 px-4 py-3">
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                资源
              </p>

              {source.isLoading ? (
                <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground/50">
                  <Loader2 size={12} className="animate-spin" />
                  正在搜索字幕组...
                </div>
              ) : source.groups.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground/40">
                  {source.error ? "搜索失败" : "暂无可用资源"}
                </p>
              ) : (
                <div className="space-y-3">
                  {/* Group pills */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
                      <Subtitles size={11} />
                      字幕组
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {source.groups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => source.selectGroup(g.id)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                            source.selectedGroupId === g.id
                              ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                              : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                          )}
                        >
                          {g.name}
                          <span
                            className={cn(
                              "tabular-nums",
                              source.selectedGroupId === g.id
                                ? "text-primary/60"
                                : "text-white/25",
                            )}
                          >
                            {g.episodeCount}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Resolution pills */}
                  {activeGroup && activeGroup.resolutions.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
                        <Monitor size={11} />
                        分辨率
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeGroup.resolutions.map((res) => (
                          <button
                            key={res}
                            type="button"
                            onClick={() => source.setPreferredResolution(res)}
                            className={cn(
                              "rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                              source.preferredResolution === res
                                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                                : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                            )}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Subtitle language pills */}
                  {activeGroup && activeGroup.subtitles.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
                        <Languages size={11} />
                        字幕
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeGroup.subtitles.map((sub) => (
                          <button
                            key={sub}
                            type="button"
                            onClick={() => source.setPreferredSubtitle(sub)}
                            className={cn(
                              "rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                              source.preferredSubtitle === sub
                                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                                : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                            )}
                          >
                            {sub}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Episode list ── */}
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
