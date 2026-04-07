import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useOnlineSource } from "@/hooks/use-online-source";
import { useTorrentSource, type GroupData } from "@/hooks/use-torrent-source";
import { KNOWN_PROVIDERS, type ProviderName } from "@/lib/torrent-source";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  Globe,
  Languages,
  Loader2,
  Monitor,
  Play,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

interface SourcePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  animeId: string;
  animeTitle: string | undefined;
  episodeNumber: number;
  episodeTitle: string;
  totalEpisodes?: number;
}

export function SourcePickerDialog({
  open,
  onOpenChange,
  animeId,
  animeTitle,
  episodeNumber,
  episodeTitle,
  totalEpisodes,
}: SourcePickerDialogProps) {
  const navigate = useNavigate();

  // "torrent:Mikan" | "torrent:Nyaa" | "torrent:DMHY" | "online:AGE动漫" ...
  const [activeTab, setActiveTab] = useState<string>("torrent:Mikan");
  const isTorrentTab = activeTab.startsWith("torrent:");
  const torrentProvider = (isTorrentTab ? activeTab.slice(8) : "Mikan") as ProviderName;

  // ── Torrent sources ────────────────────────────────────────────
  const mikan = useTorrentSource(animeId, animeTitle, undefined, undefined, totalEpisodes, undefined, "Mikan");
  const nyaa = useTorrentSource(animeId, animeTitle, undefined, undefined, totalEpisodes, undefined, "Nyaa");
  const dmhy = useTorrentSource(animeId, animeTitle, undefined, undefined, totalEpisodes, undefined, "DMHY");
  const providerMap = { Mikan: mikan, Nyaa: nyaa, DMHY: dmhy } as const;
  const currentTorrent = providerMap[torrentProvider];

  const activeGroup = currentTorrent.selectedGroupId
    ? currentTorrent.getGroupData(currentTorrent.selectedGroupId)
    : undefined;
  const torrentSource = currentTorrent.getTorrentSource(episodeNumber);

  // ── Online sources ─────────────────────────────────────────────
  const online = useOnlineSource(animeTitle);

  const handleTorrentPlay = () => {
    onOpenChange(false);
    navigate({
      to: "/anime/$id/episode/$ep",
      params: { id: animeId, ep: String(episodeNumber) },
      search: {
        groupId: currentTorrent.selectedGroupId ?? undefined,
        resolution: currentTorrent.preferredResolution ?? undefined,
        subtitle: currentTorrent.preferredSubtitle ?? undefined,
        provider: torrentProvider !== "Mikan" ? torrentProvider : undefined,
        t: undefined,
        onlineUrl: undefined,
      },
    });
  };

  const handleOnlinePlay = useCallback((episodeUrl: string) => {
    onOpenChange(false);
    navigate({
      to: "/anime/$id/episode/$ep",
      params: { id: animeId, ep: String(episodeNumber) },
      search: {
        groupId: undefined,
        resolution: undefined,
        subtitle: undefined,
        provider: undefined,
        t: undefined,
        onlineUrl: episodeUrl,
      },
    });
  }, [navigate, animeId, episodeNumber, onOpenChange]);

  /** Count indicator for a torrent provider tab. */
  const tabCount = (p: ProviderName) => {
    const s = providerMap[p];
    if (s.isLoading) return undefined;
    if (s.error && s.groups.length === 0) return undefined;
    return s.groups.reduce((n, g) => n + g.episodeCount, 0);
  };

  // Build tab list: torrent providers + online sources
  const isMobile = useIsMobile();

  type TabDef = { key: string; label: string; isLoading: boolean; hasError: boolean; count?: number; isOnline: boolean };
  const tabs: TabDef[] = [
    ...KNOWN_PROVIDERS.map((p): TabDef => ({
      key: `torrent:${p}`,
      label: p,
      isLoading: providerMap[p].isLoading,
      hasError: !!providerMap[p].error && providerMap[p].groups.length === 0,
      count: tabCount(p),
      isOnline: false,
    })),
    // Online sources require desktop WebView sniffer — hide on mobile
    ...(!isMobile ? online.sources.map((name): TabDef => ({
      key: `online:${name}`,
      label: name,
      isLoading: false,
      hasError: false,
      isOnline: true,
    })) : []),
  ];

  const headerContent = (
    <>
      <div className="text-base font-semibold">
        第 {episodeNumber} 话 · {episodeTitle}
      </div>
      <div className="flex gap-1 rounded-lg bg-white/[0.03] p-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                if (tab.isOnline) online.selectSource(tab.label);
              }}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                isActive
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-white/40 hover:text-white/60",
                tab.hasError && !isActive && "text-white/20",
              )}
            >
              {tab.isLoading && <Loader2 size={11} className="animate-spin" />}
              {tab.isOnline && <Globe size={11} />}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={cn(
                  "tabular-nums text-[10px]",
                  isActive ? "text-white/40" : "text-white/20",
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  const bodyContent = (
    <div className="overflow-y-auto px-5 pt-3 pb-5" style={{ maxHeight: isMobile ? "60vh" : "55vh" }}>
      {isTorrentTab ? (
        <ProviderContent
          state={currentTorrent}
          episodeNumber={episodeNumber}
          activeGroup={activeGroup}
          torrentSource={torrentSource}
          onPlay={handleTorrentPlay}
        />
      ) : (
        <OnlineContent
          online={online}
          episodeNumber={episodeNumber}
          onPlay={handleOnlinePlay}
        />
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="gap-0 overflow-hidden p-0">
          <DrawerHeader className="space-y-3 px-5 pt-5 pb-0">
            <DrawerTitle className="sr-only">
              第 {episodeNumber} 话 · {episodeTitle}
            </DrawerTitle>
            {headerContent}
          </DrawerHeader>
          {bodyContent}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-3 px-5 pt-5 pb-0">
          <DialogTitle className="sr-only">
            第 {episodeNumber} 话 · {episodeTitle}
          </DialogTitle>
          {headerContent}
        </DialogHeader>
        {bodyContent}
      </DialogContent>
    </Dialog>
  );
}

// ── Per-provider content panel ──────────────────────────────────

function ProviderContent({
  state,
  episodeNumber,
  activeGroup,
  torrentSource,
  onPlay,
}: {
  state: ReturnType<typeof useTorrentSource>;
  episodeNumber: number;
  activeGroup: GroupData | undefined;
  torrentSource: string | undefined;
  onPlay: () => void;
}) {
  if (state.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在搜索可用资源...</p>
      </div>
    );
  }

  if (state.error && state.groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <TriangleAlert className="h-8 w-8 text-destructive" />
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          搜索资源失败：{state.error}
        </p>
      </div>
    );
  }

  if (state.groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <Subtitles className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">暂无可用资源</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Group selector */}
      <Section icon={<Subtitles size={13} />} label="字幕组">
        <div className="flex flex-wrap gap-1.5">
          {state.groups.map((g) => {
            const hasEp = g.episodes.has(episodeNumber);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => state.selectGroup(g.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                  state.selectedGroupId === g.id
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                  !hasEp && "opacity-40",
                )}
              >
                {g.name}
                <span
                  className={cn(
                    "tabular-nums",
                    state.selectedGroupId === g.id
                      ? "text-primary/60"
                      : "text-white/25",
                  )}
                >
                  {g.episodeCount}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Resolution selector */}
      {activeGroup && activeGroup.resolutions.length > 0 && (
        <Section icon={<Monitor size={13} />} label="分辨率">
          <div className="flex flex-wrap gap-1.5">
            {activeGroup.resolutions.map((res) => (
              <button
                key={res}
                type="button"
                onClick={() => state.setPreferredResolution(res)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                  state.preferredResolution === res
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                )}
              >
                {res}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Subtitle language selector */}
      {activeGroup && activeGroup.subtitles.length > 0 && (
        <Section icon={<Languages size={13} />} label="字幕语言">
          <div className="flex flex-wrap gap-1.5">
            {activeGroup.subtitles.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => state.setPreferredSubtitle(sub)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                  state.preferredSubtitle === sub
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                )}
              >
                {sub}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* No source for this episode warning */}
      {state.selectedGroupId && !torrentSource && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <TriangleAlert size={14} />
          该字幕组暂无第 {episodeNumber} 话资源，请尝试其他字幕组
        </div>
      )}

      {/* Play button */}
      <Button
        onClick={onPlay}
        disabled={!torrentSource}
        className="w-full gap-2"
      >
        <Play size={16} fill="currentColor" />
        开始播放
      </Button>
    </div>
  );
}

// ── Online source content panel ─────────────────────────────────

function OnlineContent({
  online,
  episodeNumber,
  onPlay,
}: {
  online: ReturnType<typeof useOnlineSource>;
  episodeNumber: number;
  onPlay: (episodeUrl: string) => void;
}) {
  const episodeUrl = online.getEpisodeUrl(episodeNumber);

  if (online.searching) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在搜索在线资源...</p>
      </div>
    );
  }

  if (online.error && online.searchResults.length === 0 && online.roads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <TriangleAlert className="h-8 w-8 text-destructive" />
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          搜索在线资源失败：{online.error}
        </p>
      </div>
    );
  }

  // Step 1: Show search results for user to pick the correct anime
  if (online.roads.length === 0 && !online.loadingEpisodes) {
    if (online.searchResults.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
          <Globe className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">暂无在线资源</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <Section icon={<Globe size={13} />} label="搜索结果（点击选择）">
          <div className="space-y-1">
            {online.searchResults.map((r) => (
              <button
                key={r.url}
                type="button"
                onClick={() => online.selectAnime(r)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
              >
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <ChevronRight size={14} className="shrink-0 text-white/30" />
              </button>
            ))}
          </div>
        </Section>
      </div>
    );
  }

  // Loading episodes
  if (online.loadingEpisodes) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在加载剧集列表...</p>
      </div>
    );
  }

  // Step 2: Show roads & episodes — user picks a road, we resolve the episode
  return (
    <div className="space-y-4">
      {/* Road selector (if multiple roads) */}
      {online.roads.length > 1 && (
        <Section icon={<Monitor size={13} />} label="线路">
          <div className="flex flex-wrap gap-1.5">
            {online.roads.map((road, i) => (
              <button
                key={i}
                type="button"
                onClick={() => online.selectRoad(i)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                  online.selectedRoadIndex === i
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                )}
              >
                {road.name}
                <span className={cn(
                  "tabular-nums",
                  online.selectedRoadIndex === i ? "text-primary/60" : "text-white/25",
                )}>
                  {road.episodes.length}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Episode preview */}
      {online.roads[online.selectedRoadIndex] && (
        <Section icon={<Subtitles size={13} />} label={`剧集（共 ${online.roads[online.selectedRoadIndex].episodes.length} 集）`}>
          <div className="flex flex-wrap gap-1">
            {online.roads[online.selectedRoadIndex].episodes.map((ep, i) => {
              const isCurrent = i === episodeNumber - 1;
              return (
                <span
                  key={ep.url}
                  className={cn(
                    "inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-medium tabular-nums",
                    isCurrent
                      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                      : "bg-white/5 text-white/30",
                  )}
                >
                  {isCurrent && <Check size={10} className="mr-0.5" />}
                  {ep.name}
                </span>
              );
            })}
          </div>
        </Section>
      )}

      {/* No matching episode warning */}
      {!episodeUrl && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <TriangleAlert size={14} />
          当前线路暂无第 {episodeNumber} 话，请尝试切换线路
        </div>
      )}

      {/* Play button */}
      <Button
        onClick={() => episodeUrl && onPlay(episodeUrl)}
        disabled={!episodeUrl}
        className="w-full gap-2"
      >
        <Play size={16} fill="currentColor" />
        在线播放
      </Button>
    </div>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
