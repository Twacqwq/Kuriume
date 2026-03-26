import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMikanTorrents } from "@/hooks/use-mikan-torrents";
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
  const mikan = useMikanTorrents(
    open ? animeId : undefined, // only fetch when dialog is open
    animeTitle,
    undefined,
    undefined,
    totalEpisodes,
    undefined,
  );

  const activeGroup = mikan.selectedGroupId
    ? mikan.getGroupData(mikan.selectedGroupId)
    : undefined;

  const torrentSource = mikan.getTorrentSource(episodeNumber);

  const handlePlay = () => {
    onOpenChange(false);
    navigate({
      to: "/anime/$id/episode/$ep",
      params: { id: animeId, ep: String(episodeNumber) },
      search: {
        groupId: mikan.selectedGroupId ?? undefined,
        resolution: mikan.preferredResolution ?? undefined,
        subtitle: mikan.preferredSubtitle ?? undefined,
        t: undefined,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base">
            第 {episodeNumber} 话 · {episodeTitle}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-5 pb-5">
          {mikan.isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在搜索可用资源...</p>
            </div>
          ) : mikan.error && mikan.groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <TriangleAlert className="h-8 w-8 text-destructive" />
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                搜索资源失败：{mikan.error}
              </p>
            </div>
          ) : mikan.groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Subtitles className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">暂无可用资源</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Group selector */}
              <Section icon={<Subtitles size={13} />} label="字幕组">
                <div className="flex flex-wrap gap-1.5">
                  {mikan.groups.map((g) => {
                    const hasEp = g.episodes.has(episodeNumber);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => mikan.selectGroup(g.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                          mikan.selectedGroupId === g.id
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                          !hasEp && "opacity-40",
                        )}
                      >
                        {g.name}
                        <span
                          className={cn(
                            "tabular-nums",
                            mikan.selectedGroupId === g.id
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
                        onClick={() => mikan.setPreferredResolution(res)}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                          mikan.preferredResolution === res
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
                        onClick={() => mikan.setPreferredSubtitle(sub)}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                          mikan.preferredSubtitle === sub
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
              {mikan.selectedGroupId && !torrentSource && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  <TriangleAlert size={14} />
                  该字幕组暂无第 {episodeNumber} 话资源，请尝试其他字幕组
                </div>
              )}

              {/* Play button */}
              <Button
                onClick={handlePlay}
                disabled={!torrentSource}
                className="w-full gap-2"
              >
                <Play size={16} fill="currentColor" />
                开始播放
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
