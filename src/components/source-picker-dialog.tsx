import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTorrentSource, type GroupData } from "@/hooks/use-torrent-source";
import { KNOWN_PROVIDERS, type ProviderName } from "@/lib/torrent-source";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  Languages,
  Loader2,
  Monitor,
  Play,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

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
  const [provider, setProvider] = useState<ProviderName>(KNOWN_PROVIDERS[0]);

  // Always pass animeId so prefetched cache is used; the queries inside
  // useTorrentSource are enabled only when bgmId + title are truthy.
  const mikan = useTorrentSource(animeId, animeTitle, undefined, undefined, totalEpisodes, undefined, "Mikan");
  const nyaa = useTorrentSource(animeId, animeTitle, undefined, undefined, totalEpisodes, undefined, "Nyaa");
  const dmhy = useTorrentSource(animeId, animeTitle, undefined, undefined, totalEpisodes, undefined, "DMHY");

  const providerMap = { Mikan: mikan, Nyaa: nyaa, DMHY: dmhy } as const;
  const current = providerMap[provider];

  const activeGroup = current.selectedGroupId
    ? current.getGroupData(current.selectedGroupId)
    : undefined;

  const torrentSource = current.getTorrentSource(episodeNumber);

  const handlePlay = () => {
    onOpenChange(false);
    navigate({
      to: "/anime/$id/episode/$ep",
      params: { id: animeId, ep: String(episodeNumber) },
      search: {
        groupId: current.selectedGroupId ?? undefined,
        resolution: current.preferredResolution ?? undefined,
        subtitle: current.preferredSubtitle ?? undefined,
        provider: provider !== "Mikan" ? provider : undefined,
        t: undefined,
      },
    });
  };

  /** Count indicator for a provider tab. */
  const tabCount = (p: typeof provider) => {
    const s = providerMap[p];
    if (s.isLoading) return undefined;
    if (s.error && s.groups.length === 0) return undefined;
    return s.groups.reduce((n, g) => n + g.episodeCount, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        {/* Header + provider tabs */}
        <DialogHeader className="space-y-3 px-5 pt-5 pb-0">
          <DialogTitle className="text-base">
            第 {episodeNumber} 话 · {episodeTitle}
          </DialogTitle>

          {/* Provider tabs — always visible */}
          <div className="flex gap-1 rounded-lg bg-white/[0.03] p-1">
            {KNOWN_PROVIDERS.map((p) => {
              const count = tabCount(p);
              const isActive = provider === p;
              const isLoading = providerMap[p].isLoading;
              const hasError = !!providerMap[p].error && providerMap[p].groups.length === 0;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    isActive
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-white/40 hover:text-white/60",
                    hasError && !isActive && "text-white/20",
                  )}
                >
                  {isLoading && (
                    <Loader2 size={11} className="animate-spin" />
                  )}
                  {p}
                  {count !== undefined && count > 0 && (
                    <span className={cn(
                      "tabular-nums text-[10px]",
                      isActive ? "text-white/40" : "text-white/20",
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        {/* Body — per-provider content */}
        <div className="max-h-[55vh] overflow-y-auto px-5 pt-3 pb-5">
          <ProviderContent
            state={current}
            episodeNumber={episodeNumber}
            activeGroup={activeGroup}
            torrentSource={torrentSource}
            onPlay={handlePlay}
          />
        </div>
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
