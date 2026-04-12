import { TorrentPlayer } from "@/components/torrent-player";
import type { HistoryContext } from "@/components/torrent-player";
import { Button } from "@/components/ui/button";
import { historyApi } from "@/lib/store";
import { useTorrentSource } from "@/hooks/use-torrent-source";
import { useOnlineSource } from "@/hooks/use-online-source";
import { useVideoSniffer } from "@/hooks/use-video-sniffer";
import type { CacheContext } from "@/hooks/use-torrent-stream";
import { KNOWN_PROVIDERS, type ProviderName } from "@/lib/torrent-source";
import { cn } from "@/lib/utils";
import { detailQueryOptions, episodesQueryOptions } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Globe,
  Languages,
  Loader2,
  Monitor,
  Play,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type SourceTab = ProviderName | "online";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: Number(search.t) || undefined,
    onlineUrl: (search.onlineUrl as string) || undefined,
  }),
  component: EpisodePage,
});

function EpisodePage() {
  const { id, ep } = Route.useParams();
  const { t: startTime, onlineUrl } = Route.useSearch();
  const router = useRouter();
  const epNum = Number(ep);

  const [isFullscreen, setIsFullscreen] = useState(false);
  // ── Source tab state ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SourceTab>(
    onlineUrl ? "online" : "Mikan",
  );

  const isMobile = typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);

  useEffect(() => {
    if (isMobile) return;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().isFullscreen().then(setIsFullscreen)
    ).catch(() => {});
  }, [isMobile]);

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

  // ── Determine mode ──────────────────────────────────────────────

  const isOnline = activeTab === "online";

  // ── Video sniffer (online mode) ────────────────────────────────

  const sniffer = useVideoSniffer();
  const onlineSrc = useOnlineSource(animeTitle);

  // DEBUG: direct invoke test — bypasses hook entirely
  useEffect(() => {
    if (!isOnline || !onlineSrc.selectedSource || onlineSrc.searchResults.length === 0) return;
    const url = onlineSrc.searchResults[0].url;
    console.log("[DIRECT-TEST] calling online_source_episodes, source:", onlineSrc.selectedSource, "pageUrl:", url);
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("online_source_episodes", { source: onlineSrc.selectedSource, pageUrl: url })
        .then((r: unknown) => console.log("[DIRECT-TEST] OK:", JSON.stringify(r)))
        .catch((e: unknown) => console.error("[DIRECT-TEST] FAIL:", e));
    });
  }, [isOnline, onlineSrc.selectedSource, onlineSrc.searchResults]);

  // Derive dynamic online URL: if initial onlineUrl is provided, use it;
  // otherwise try resolving from the online source for the current episode.
  const resolvedOnlineUrl = onlineUrl
    || (isOnline ? onlineSrc.getEpisodeUrl(epNum) : undefined);

  // Debug: log online source state on every render when online tab is active
  useEffect(() => {
    if (!isOnline) return;
    console.log("[online-debug] isOnline:", isOnline,
      "roads:", onlineSrc.roads.length,
      "selectedRoadIndex:", onlineSrc.selectedRoadIndex,
      "epNum:", epNum,
      "resolvedOnlineUrl:", resolvedOnlineUrl,
      "snifferPhase:", sniffer.phase,
      "selectedSource:", onlineSrc.selectedSource,
      "searching:", onlineSrc.searching,
      "loadingEpisodes:", onlineSrc.loadingEpisodes);
  });

  useEffect(() => {
    if (isOnline && resolvedOnlineUrl) {
      console.log("[online-sniffer] auto-trigger:", resolvedOnlineUrl);
      sniffer.sniff(resolvedOnlineUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedOnlineUrl, isOnline]);

  // ── Resolve torrent source (only when a torrent provider is active) ──

  const torrentProvider = isOnline ? "Mikan" : (activeTab as ProviderName);

  const source = useTorrentSource(
    id,
    animeTitle,
    historyEntries?.group_id ?? undefined,
    historyEntries?.resolution ?? undefined,
    animeInfo?.total_episodes,
    historyEntries?.subtitle ?? undefined,
    torrentProvider,
  );
  const torrentSource = source.getTorrentSource(epNum);

  const navBack = () => router.navigate({ to: "/anime/$id", params: { id } });

  const navigateToEp = useCallback(
    (targetEp: number) => {
      router.navigate({
        to: "/anime/$id/episode/$ep",
        params: { id, ep: String(targetEp) },
        search: { t: undefined, onlineUrl: undefined },
      });
    },
    [router, id],
  );

  const navPrev = hasPrev ? () => navigateToEp(epNum - 1) : undefined;
  const navNext = hasNext ? () => navigateToEp(epNum + 1) : undefined;

  const toggleFullscreen = useCallback(async () => {
    // Always toggle CSS-based fullscreen (works everywhere)
    const newFs = !isFullscreen;
    setIsFullscreen(newFs);
    // On desktop, also toggle native window fullscreen
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(newFs);
    } catch {
      // Tauri window API unavailable (e.g. iOS) — CSS fullscreen is enough
    }
  }, [isFullscreen]);

  // ── Contexts ──────────────────────────────────────────────────

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
      groupId: source.selectedGroupId ?? null,
      resolution: source.preferredResolution ?? null,
      subtitle: source.preferredSubtitle ?? null,
    }),
    [id, epNum, animeTitle, title, animeInfo?.cover, source.selectedGroupId, source.preferredResolution, source.preferredSubtitle],
  );

  // ── Derived ────────────────────────────────────────────────────

  const activeGroup = source.selectedGroupId
    ? source.getGroupData(source.selectedGroupId)
    : undefined;
  const hasSource = !!torrentSource;
  const hasError = !!source.error && source.groups.length === 0;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className={cn("flex h-full w-full flex-col", isFullscreen && "fixed inset-0 z-50")}>
      {/* ── Header (hidden in fullscreen) ─────────────────────── */}
      {!isFullscreen && (
        <div
          className="flex items-center gap-3 border-b border-white/5 bg-background px-4 pt-2 pb-2 md:px-5 md:pt-10 md:pb-2.5"
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
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Player area — on mobile: fixed aspect ratio (fullscreen: fill); on desktop: fill remaining */}
        <div className={cn(
          "relative w-full shrink-0",
          isFullscreen ? "h-full flex-1" : "aspect-video md:aspect-auto md:min-w-0 md:flex-1",
        )}>
          {isOnline ? (
            sniffer.phase === "sniffing" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <Globe className="h-4 w-4" />
                  <span>正在解析视频地址…</span>
                </div>
              </div>
            ) : sniffer.phase === "idle" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black">
                <Globe className="h-10 w-10 text-white/15" />
                <p className="text-sm text-white/50">
                  {onlineSrc.loadingEpisodes
                    ? `加载中… ${onlineSrc.error || "waiting"} (${onlineSrc.searchResults.length}结果)`
                    : onlineSrc.searching ? "搜索中…"
                    : onlineSrc.roads.length > 0 ? `${onlineSrc.roads.length}条线路`
                    : onlineSrc.error ? `错误: ${onlineSrc.error}`
                    : `src=${onlineSrc.selectedSource} res=${onlineSrc.searchResults.length}`}
                </p>
              </div>
            ) : sniffer.phase === "error" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black">
                <TriangleAlert className="h-10 w-10 text-destructive" />
                <p className="max-w-sm text-center text-sm text-white/60">
                  {sniffer.error || "视频解析失败"}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => resolvedOnlineUrl && sniffer.sniff(resolvedOnlineUrl)}
                  className="gap-2"
                >
                  重试
                </Button>
              </div>
            ) : (
              <TorrentPlayer
                key={`online-${id}-${ep}-${sniffer.videoUrl}`}
                videoUrl={sniffer.videoUrl!}
                title={title}
                subtitle={subtitle}
                historyContext={historyContext}
                startTime={effectiveStartTime}
                onBack={navBack}
                onPrev={navPrev}
                onNext={navNext}
                onToggleFullscreen={toggleFullscreen}
                isFullscreen={isFullscreen}
              />
            )
          ) : source.isLoading ? (
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
                <p className="text-xs text-white/30">请在侧边栏切换字幕组</p>
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

        {/* ── Inline source panel (mobile: below player, desktop: sidebar) ── */}
        {!isFullscreen && (
          <aside className="flex min-h-0 flex-1 flex-col border-t border-white/5 bg-background md:max-h-none md:w-80 md:flex-none md:border-t-0 md:border-l">
            <SourcePanel
              activeTab={activeTab}
              onTabChange={setActiveTab}
              source={source}
              activeGroup={activeGroup}
              onlineSrc={onlineSrc}
              episodes={episodes}
              epNum={epNum}
              navigateToEp={navigateToEp}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

/* ── Inline source panel (replaces old SidebarContent + Drawer) ── */

function SourcePanel({
  activeTab,
  onTabChange,
  source,
  activeGroup,
  onlineSrc,
  episodes,
  epNum,
  navigateToEp,
}: {
  activeTab: SourceTab;
  onTabChange: (tab: SourceTab) => void;
  source: ReturnType<typeof useTorrentSource>;
  activeGroup: ReturnType<ReturnType<typeof useTorrentSource>["getGroupData"]>;
  onlineSrc: ReturnType<typeof useOnlineSource>;
  episodes: { id: string; ep: number; title?: string; title_cn?: string; airdate?: string; duration?: string; progress?: number }[];
  epNum: number;
  navigateToEp: (ep: number) => void;
}) {
  const isOnline = activeTab === "online";

  return (
    <>
      {/* ── Provider tabs ── */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/5 px-3 py-2">
        {KNOWN_PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onTabChange(p)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all",
              activeTab === p
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "text-white/50 hover:bg-white/6 hover:text-white/70",
            )}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onTabChange("online")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all",
            activeTab === "online"
              ? "bg-primary/15 text-primary ring-1 ring-primary/30"
              : "text-white/50 hover:bg-white/6 hover:text-white/70",
          )}
        >
          <Globe size={11} />
          在线
        </button>
      </div>

      {/* ── Source selector (torrent mode) ── */}
      {!isOnline && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-white/5 px-4 py-3 md:max-h-[50%]">
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
      )}

      {/* ── Online source info ── */}
      {isOnline && (
        <div className="shrink-0 border-b border-white/5 px-4 py-3">
          {onlineSrc.sourcesLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
              <Loader2 size={12} className="animate-spin" />
              正在加载在线源...
            </div>
          ) : onlineSrc.sources.length === 0 ? (
            <p className="text-xs text-muted-foreground/40">暂无可用在线源</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/40">
                <Globe size={11} />
                在线源
              </div>
              <div className="flex flex-wrap gap-1.5">
                {onlineSrc.sources.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onlineSrc.selectSource(s)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                      onlineSrc.selectedSource === s
                        ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                        : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {onlineSrc.searching && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
                  <Loader2 size={12} className="animate-spin" />
                  正在搜索...
                </div>
              )}
              {onlineSrc.searchResults.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground/40">搜索结果</p>
                  <div className="max-h-24 overflow-y-auto">
                    {onlineSrc.searchResults.map((r) => (
                      <button
                        key={r.url}
                        type="button"
                        onClick={() => onlineSrc.selectAnime(r)}
                        className="w-full truncate rounded px-2 py-1 text-left text-[11px] text-white/60 hover:bg-white/6 hover:text-white/80"
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
    </>
  );
}
