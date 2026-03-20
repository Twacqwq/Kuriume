import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnimeCharacters, AnimeEpisodes } from "@/lib/types";
import type { WatchStatus } from "@/lib/store";
import type { GroupData } from "@/lib/use-mikan-torrents";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookmarkCheck,
  BookmarkPlus,
  Calendar,
  Check,
  Eye,
  EyeOff,
  Grid3X3,
  Languages,
  Loader2,
  Monitor,
  Play,
  Rows3,
  Star,
  Subtitles,
  Trash2,
  Tv,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface AnimeRelated {
  id: number;
  title: string;
  cover: string;
  score: number;
  year: number;
  relation: string; // e.g. "续集", "前传", "番外"
}

export interface AnimeDetailData {
  id: number;
  title: string;
  titleOriginal?: string;
  cover: string;
  score: number;
  ratingCount: number;
  year: number;
  status: "连载中" | "已完结" | "未播出";
  totalEpisodes: number;
  currentEpisodes: number;
  genre: string[];
  studio: string;
  director: string;
  description: string;
  episodes: AnimeEpisodes[];
  characters: AnimeCharacters[];
  related: AnimeRelated[];
}

/* ------------------------------------------------------------------ */
/*  Expandable description                                             */
/* ------------------------------------------------------------------ */
const CLAMP_LINES = 4;

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Split on literal \r\n, \n, or \r to form paragraphs
  const paragraphs = text.split(/\r\n|\r|\n/).filter(Boolean);

  // Check overflow after layout settles (only when collapsed)
  useEffect(() => {
    if (expanded) return;
    const el = contentRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      setClamped(el.scrollHeight > el.clientHeight);
    });
    return () => cancelAnimationFrame(id);
  }, [expanded, text]);

  return (
    <div className="max-w-2xl">
      <div
        ref={contentRef}
        className={cn(
          "text-sm leading-relaxed text-white/55 md:text-base",
          !expanded && "line-clamp-(--clamp)",
        )}
        style={{ "--clamp": CLAMP_LINES } as React.CSSProperties}
      >
        {paragraphs.map((p, i) => (
          <p key={i} className={i > 0 ? "mt-2" : undefined}>
            {p}
          </p>
        ))}
      </div>
      {clamped && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs font-medium text-white/40 transition-colors hover:text-white/70"
        >
          {expanded ? "收起" : "展开全部"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hasAired(airdate: string): boolean {
  if (!airdate) return true;
  const d = new Date(airdate);
  if (isNaN(d.getTime())) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d <= today;
}

function formatAirdate(airdate: string): string {
  if (!airdate) return "播出日期未定";
  const d = new Date(airdate);
  if (isNaN(d.getTime())) return "播出日期未定";
  return `${d.getMonth() + 1}月${d.getDate()}日播出`;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
interface AnimeDetailProps {
  data: AnimeDetailData;
  onBack?: () => void;
  groups?: GroupData[];
  isLoadingGroups?: boolean;
  selectedGroupId?: string | null;
  onSelectGroup?: (id: string) => void;
  preferredResolution?: string | null;
  onSelectResolution?: (res: string | null) => void;
  preferredSubtitle?: string | null;
  onSelectSubtitle?: (sub: string | null) => void;
  /** Current watchlist status (null = not tracked). */
  watchStatus?: WatchStatus | null;
  /** Called when user adds/changes tracking. */
  onWatchStatusChange?: (status: WatchStatus) => void;
  /** Called when user removes from tracking. */
  onWatchRemove?: () => void;
}

const WATCH_STATUS_OPTIONS: { value: WatchStatus; label: string; icon: typeof Eye }[] = [
  { value: "unwatched", label: "未看", icon: EyeOff },
  { value: "watching", label: "正在看", icon: Eye },
  { value: "completed", label: "已看完", icon: Check },
];

export function AnimeDetail({
  data,
  onBack,
  groups,
  isLoadingGroups,
  selectedGroupId,
  onSelectGroup,
  preferredResolution,
  onSelectResolution,
  preferredSubtitle,
  onSelectSubtitle,
  watchStatus,
  onWatchStatusChange,
  onWatchRemove,
}: AnimeDetailProps) {
  return (
    <TooltipProvider>
      <div className="min-h-screen">
        {/* ============ Hero Section ============ */}
        <section className="relative overflow-x-hidden">
          {/* Blurred background */}
          <div className="absolute inset-0">
            <img
              src={data.cover}
              alt=""
              className="h-full w-full scale-110 object-cover blur-2xl brightness-[0.4] saturate-[1.4]"
            />
            <div className="absolute inset-0 bg-linear-to-t from-background from-5% via-background/80 via-40% to-transparent" />
            <div className="absolute inset-0 bg-linear-to-r from-background/90 via-background/40 to-transparent" />
            <div className="absolute inset-0 bg-linear-to-b from-black/40 via-transparent to-transparent" />
            <div
              className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")',
              }}
            />
          </div>

          {/* Back button */}
          {onBack && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onBack}
                  className="absolute left-6 top-6 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20"
                >
                  <ArrowLeft size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">返回</TooltipContent>
            </Tooltip>
          )}

          {/* Content */}
          <div className="relative flex flex-col gap-8 px-8 pb-10 pt-20 md:flex-row md:items-start md:px-16 lg:px-24">
            {/* Cover */}
            <div className="group/cover relative shrink-0 self-center md:self-start">
              <img
                src={data.cover}
                alt=""
                className="absolute inset-0 m-auto h-full w-full scale-110 rounded-2xl object-cover opacity-30 blur-2xl"
              />
              <img
                src={data.cover}
                alt={data.title}
                className="relative h-72 w-auto rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10 transition-transform duration-300 group-hover/cover:scale-[1.02] sm:h-80 md:h-88"
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 transition-colors duration-300 group-hover/cover:bg-black/30">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/90 text-white opacity-0 shadow-lg shadow-primary/30 transition-all duration-300 group-hover/cover:scale-100 group-hover/cover:opacity-100 scale-75">
                  <Play size={24} fill="currentColor" className="ml-1" />
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 space-y-4">
              <div className="space-y-1">
                <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                  {data.title}
                </h1>
                {data.titleOriginal && (
                  <p className="text-sm text-white/40">{data.titleOriginal}</p>
                )}
              </div>

              {/* Score */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg bg-yellow-500/15 px-3 py-1.5">
                    <Star size={16} fill="currentColor" className="text-yellow-400" />
                    <span className="text-lg font-bold text-yellow-400">{data.score}</span>
                  </div>
                  <span className="text-xs text-white/40">{data.ratingCount} 人评分</span>
                </div>
              </div>

              {/* Meta badges */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1 border-white/15 text-white/70">
                  <Calendar size={12} />
                  {data.year}
                </Badge>
                <Badge variant="outline" className="border-white/15 text-white/70">
                  {data.status === "连载中" ? (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  ) : data.status === "未播出" ? (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  ) : (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                  )}
                  {data.status} · {data.currentEpisodes}/{data.totalEpisodes}话
                </Badge>
                <Badge variant="outline" className="border-white/15 text-white/70">
                  {data.studio}
                </Badge>
              </div>

              {/* Genre tags */}
              <div className="flex flex-wrap gap-2">
                {data.genre.map((g, i) => (
                  <Badge key={`${g}-${i}`} variant="ghost" className="bg-white/6 text-white/60 hover:bg-white/10 hover:text-white/80">
                    {g}
                  </Badge>
                ))}
              </div>

              {/* Description */}
              <ExpandableDescription text={data.description} />

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to="/anime/$id/episode/$ep"
                  params={{
                    id: String(data.id),
                    ep: String(
                      data.episodes.find((e) => (!e.progress || e.progress < 100) && hasAired(e.airdate))?.ep ?? 1
                    ),
                  }}
                  search={{ groupId: selectedGroupId ?? undefined, resolution: preferredResolution ?? undefined, subtitle: preferredSubtitle ?? undefined, t: undefined }}
                >
                  <Button size="lg" className="gap-2 rounded-full px-8 shadow-lg shadow-primary/25">
                    <Play size={18} fill="currentColor" />
                    开始播放
                  </Button>
                </Link>
                {/* Watchlist button with hover dropdown */}
                <div className="group/watch relative">
                  <Button
                    size="lg"
                    variant="secondary"
                    className={cn(
                      "gap-2 rounded-full border-0 px-6",
                      watchStatus
                        ? "bg-primary/15 text-primary hover:bg-primary/25"
                        : "bg-white/10 hover:bg-white/20",
                    )}
                    onClick={() => {
                      if (!watchStatus) {
                        onWatchStatusChange?.("watching");
                      }
                    }}
                  >
                    {watchStatus ? <BookmarkCheck size={18} /> : <BookmarkPlus size={18} />}
                    {watchStatus
                      ? WATCH_STATUS_OPTIONS.find((o) => o.value === watchStatus)?.label ?? "追番"
                      : "追番"}
                  </Button>
                  {watchStatus && (
                    <div className="invisible absolute left-0 bottom-full z-50 pb-1 opacity-0 transition-all duration-150 group-hover/watch:visible group-hover/watch:opacity-100">
                      <div className="w-36 rounded-lg border border-white/10 bg-popover p-1 shadow-xl">
                        {WATCH_STATUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => onWatchStatusChange?.(opt.value)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                              watchStatus === opt.value
                                ? "bg-primary/10 text-primary"
                                : "text-foreground hover:bg-muted",
                            )}
                          >
                            <opt.icon size={14} />
                            {opt.label}
                          </button>
                        ))}
                        <div className="my-1 h-px bg-border" />
                        <button
                          onClick={() => onWatchRemove?.()}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          <Trash2 size={14} />
                          取消追番
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-linear-to-t from-background to-transparent" />
        </section>

        {/* ============ Tabs (shadcn) ============ */}
        <Tabs defaultValue="episodes" className="gap-0">
          <div className="sticky top-0 z-30 border-b border-white/6 bg-background/80 backdrop-blur-xl">
            <div className="px-8 md:px-16 lg:px-24">
              <TabsList variant="line" className="h-auto w-auto bg-transparent p-0">
                <TabsTrigger
                  value="episodes"
                  className="gap-2 px-5 py-3.5 text-sm data-[state=active]:text-primary data-[state=active]:after:bg-primary"
                >
                  <Tv size={16} />
                  剧集
                </TabsTrigger>
                <TabsTrigger
                  value="characters"
                  className="gap-2 px-5 py-3.5 text-sm data-[state=active]:text-primary data-[state=active]:after:bg-primary"
                >
                  <Users size={16} />
                  角色
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <div className="px-8 py-8 md:px-16 lg:px-24">
            <TabsContent value="episodes">
              <EpisodeList
                episodes={data.episodes}
                animeId={data.id}
                groups={groups}
                isLoadingGroups={isLoadingGroups}
                selectedGroupId={selectedGroupId}
                onSelectGroup={onSelectGroup}
                preferredResolution={preferredResolution}
                onSelectResolution={onSelectResolution}
                preferredSubtitle={preferredSubtitle}
                onSelectSubtitle={onSelectSubtitle}
              />
            </TabsContent>
            <TabsContent value="characters">
              <CharacterGrid characters={data.characters} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Episode List — episode-first with compact group selector            */
/* ------------------------------------------------------------------ */
type EpisodeViewMode = "list" | "grid";

function EpisodeList({
  episodes,
  animeId,
  groups,
  isLoadingGroups,
  selectedGroupId,
  onSelectGroup,
  preferredResolution,
  onSelectResolution,
  preferredSubtitle,
  onSelectSubtitle,
}: {
  episodes: AnimeEpisodes[];
  animeId: number;
  groups?: GroupData[];
  isLoadingGroups?: boolean;
  selectedGroupId?: string | null;
  onSelectGroup?: (id: string) => void;
  preferredResolution?: string | null;
  onSelectResolution?: (res: string | null) => void;
  preferredSubtitle?: string | null;
  onSelectSubtitle?: (sub: string | null) => void;
}) {
  const [viewMode, setViewMode] = useState<EpisodeViewMode>("list");

  const hasGroups = groups && groups.length > 0;
  const activeGroup = useMemo(
    () => groups?.find((g) => g.id === selectedGroupId),
    [groups, selectedGroupId],
  );

  // Effective resolution for the selected group
  const activeRes = useMemo(() => {
    if (!activeGroup) return null;
    if (preferredResolution && activeGroup.resolutions.includes(preferredResolution)) {
      return preferredResolution;
    }
    return activeGroup.resolutions[0] ?? null;
  }, [activeGroup, preferredResolution]);

  // Effective subtitle for the selected group
  const activeSub = useMemo(() => {
    if (!activeGroup) return null;
    if (preferredSubtitle && activeGroup.subtitles.includes(preferredSubtitle)) {
      return preferredSubtitle;
    }
    return activeGroup.subtitles[0] ?? null;
  }, [activeGroup, preferredSubtitle]);

  // For each episode, check selected group then find fallback
  const resolveEpisode = useCallback(
    (epNum: number) => {
      if (!activeGroup) return { inGroup: false as const, fallback: null };
      const varMap = activeGroup.episodes.get(epNum);
      // Check if there's an entry matching the compound key (or just any entry)
      const inGroup = varMap
        ? activeRes && activeSub
          ? varMap.has(`${activeRes}|${activeSub}`) || [...varMap.keys()].some((k) => k.startsWith(activeRes + "|"))
          : varMap.size > 0
        : false;
      if (inGroup) return { inGroup: true as const, fallback: null };
      // Find the best alternative group (most episodes first, already sorted)
      const alt = groups?.find(
        (g) => g.id !== selectedGroupId && g.episodes.has(epNum),
      );
      return { inGroup: false as const, fallback: alt ?? null };
    },
    [activeGroup, activeRes, activeSub, groups, selectedGroupId],
  );

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">
          全部剧集
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            共 {episodes.length} 话
          </span>
        </h2>

        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => { if (v) setViewMode(v as EpisodeViewMode); }}
          size="sm"
          className="rounded-lg bg-white/4 p-0.5"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="list"
                className="h-7 w-7 p-0 data-[state=on]:bg-white/10 data-[state=on]:text-primary"
              >
                <Rows3 size={15} />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>列表</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="grid"
                className="h-7 w-7 p-0 data-[state=on]:bg-white/10 data-[state=on]:text-primary"
              >
                <Grid3X3 size={15} />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>数字</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </div>

      {/* ── Loading ── */}
      {isLoadingGroups && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
          <Loader2 size={14} className="animate-spin" />
          <span>正在搜索字幕组...</span>
        </div>
      )}

      {/* ── No groups ── */}
      {!isLoadingGroups && !hasGroups && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
          <Subtitles size={14} />
          <span>暂无字幕组资源</span>
        </div>
      )}

      {/* ── Group & Resolution selector ── */}
      {hasGroups && (
        <div className="space-y-3">
          {/* Group pills */}
          <div className="flex items-center gap-2.5">
            <Subtitles size={14} className="shrink-0 text-muted-foreground/50" />
            <div className="flex flex-wrap gap-1.5">
              {groups!.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelectGroup?.(g.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                    selectedGroupId === g.id
                      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                      : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70",
                  )}
                >
                  {g.name}
                  <span className={cn(
                    "tabular-nums",
                    selectedGroupId === g.id ? "text-primary/60" : "text-white/30",
                  )}>
                    {g.episodeCount}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution pills */}
          {activeGroup && activeGroup.resolutions.length > 1 && (
            <div className="flex items-center gap-2.5">
              <Monitor size={14} className="shrink-0 text-muted-foreground/50" />
              <div className="flex flex-wrap gap-1.5">
                {activeGroup.resolutions.map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => onSelectResolution?.(res)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                      activeRes === res
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
          {activeGroup && activeGroup.resolutions.length === 1 && (
            <div className="flex items-center gap-2.5">
              <Monitor size={14} className="shrink-0 text-muted-foreground/50" />
              <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-white/40">
                {activeGroup.resolutions[0]}
              </span>
            </div>
          )}

          {/* Subtitle language pills */}
          {activeGroup && activeGroup.subtitles.length > 1 && (
            <div className="flex items-center gap-2.5">
              <Languages size={14} className="shrink-0 text-muted-foreground/50" />
              <div className="flex flex-wrap gap-1.5">
                {activeGroup.subtitles.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => onSelectSubtitle?.(sub)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                      activeSub === sub
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
          {activeGroup && activeGroup.subtitles.length === 1 && (
            <div className="flex items-center gap-2.5">
              <Languages size={14} className="shrink-0 text-muted-foreground/50" />
              <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-white/40">
                {activeGroup.subtitles[0]}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Episode list view ── */}
      {viewMode === "list" && (
        <div className="divide-y divide-white/4">
          {episodes.map((ep) => {
            const aired = hasAired(ep.airdate);

            if (!aired) {
              return (
                <div key={ep.id} className="flex w-full items-center gap-4 py-3 text-left opacity-35">
                  <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground/50">
                    {ep.ep}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground/50 line-clamp-1">
                      {ep.title_cn || ep.title || `第 ${ep.ep} 话`}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatAirdate(ep.airdate)}
                    </span>
                  </div>
                </div>
              );
            }

            if (!hasGroups) {
              return (
                <div key={ep.id} className="flex w-full items-center gap-4 py-3 text-left opacity-50">
                  <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground/50">
                    {ep.ep}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground/60 line-clamp-1">
                      {ep.title_cn || ep.title || `第 ${ep.ep} 话`}
                    </span>
                  </div>
                </div>
              );
            }

            const { inGroup, fallback } = resolveEpisode(ep.ep);

            // Selected group has it
            if (inGroup) {
              return (
                <Link
                  key={ep.id}
                  to="/anime/$id/episode/$ep"
                  params={{ id: String(animeId), ep: String(ep.ep) }}
                  search={{ groupId: selectedGroupId ?? undefined, resolution: activeRes ?? undefined, subtitle: activeSub ?? undefined, t: undefined }}
                  className="group flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-white/2"
                >
                  <span className={cn(
                    "w-8 shrink-0 text-center text-sm font-semibold tabular-nums",
                    ep.progress !== undefined && ep.progress >= 100
                      ? "text-muted-foreground/50"
                      : "text-primary",
                  )}>
                    {ep.ep}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground line-clamp-1 transition-colors group-hover:text-primary">
                      {ep.title_cn || ep.title}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{ep.duration}</span>
                      {ep.progress !== undefined && (
                        <>
                          <span className="text-white/20">·</span>
                          <span>{ep.progress >= 100 ? "已看完" : `已看 ${ep.progress}%`}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {ep.progress !== undefined && ep.progress < 100 && (
                    <Progress value={ep.progress} className="h-1 w-16 shrink-0 bg-white/10" />
                  )}
                  <Play
                    size={14}
                    fill="currentColor"
                    className="shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:text-primary group-hover:opacity-100"
                  />
                </Link>
              );
            }

            // Another group has it — show with fallback hint
            if (fallback) {
              return (
                <Link
                  key={ep.id}
                  to="/anime/$id/episode/$ep"
                  params={{ id: String(animeId), ep: String(ep.ep) }}
                  search={{ groupId: fallback.id, resolution: undefined, subtitle: undefined, t: undefined }}
                  className="group flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-white/2"
                >
                  <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums text-foreground/50">
                    {ep.ep}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground/70 line-clamp-1 transition-colors group-hover:text-primary">
                      {ep.title_cn || ep.title}
                    </span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">{ep.duration}</span>
                      <span className="text-white/20">·</span>
                      <span className="text-amber-400/70">{fallback.name} 可用</span>
                    </div>
                  </div>
                  <Play
                    size={14}
                    fill="currentColor"
                    className="shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:text-primary group-hover:opacity-100"
                  />
                </Link>
              );
            }

            // No group has this episode
            return (
              <div key={ep.id} className="flex w-full items-center gap-4 py-3 text-left opacity-35">
                <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground/40">
                  {ep.ep}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground/40 line-clamp-1">
                    {ep.title_cn || ep.title || `第 ${ep.ep} 话`}
                  </span>
                  <span className="text-[11px] text-muted-foreground/50">暂无资源</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Episode grid view ── */}
      {viewMode === "grid" && (
        <div className="flex flex-wrap gap-2">
          {episodes.map((ep) => {
            const aired = hasAired(ep.airdate);
            const watched = ep.progress !== undefined && ep.progress >= 100;
            const watching = ep.progress !== undefined && ep.progress > 0 && ep.progress < 100;

            if (!aired) {
              return (
                <Tooltip key={ep.id}>
                  <TooltipTrigger asChild>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium tabular-nums bg-white/2 text-muted-foreground/30 cursor-default">
                      {ep.ep}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>第 {ep.ep} 话 · {formatAirdate(ep.airdate)}</TooltipContent>
                </Tooltip>
              );
            }

            if (!hasGroups) {
              return (
                <Tooltip key={ep.id}>
                  <TooltipTrigger asChild>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium tabular-nums bg-card/60 text-foreground/60 cursor-default">
                      {ep.ep}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>第 {ep.ep} 话 · {ep.title_cn || ep.title || ""}</TooltipContent>
                </Tooltip>
              );
            }

            const { inGroup, fallback } = resolveEpisode(ep.ep);

            if (inGroup) {
              return (
                <Tooltip key={ep.id}>
                  <TooltipTrigger asChild>
                    <Link
                      to="/anime/$id/episode/$ep"
                      params={{ id: String(animeId), ep: String(ep.ep) }}
                      search={{ groupId: selectedGroupId ?? undefined, resolution: activeRes ?? undefined, subtitle: activeSub ?? undefined, t: undefined }}
                      className={cn(
                        "relative flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium tabular-nums transition-all",
                        watched
                          ? "bg-white/4 text-muted-foreground/50"
                          : watching
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "bg-card/60 text-foreground hover:bg-card hover:text-primary",
                      )}
                    >
                      {ep.ep}
                      {watching && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary shadow-[0_0_4px_var(--primary)]" />
                      )}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>第 {ep.ep} 话 · {ep.title_cn || ep.title}</TooltipContent>
                </Tooltip>
              );
            }

            if (fallback) {
              return (
                <Tooltip key={ep.id}>
                  <TooltipTrigger asChild>
                    <Link
                      to="/anime/$id/episode/$ep"
                      params={{ id: String(animeId), ep: String(ep.ep) }}
                      search={{ groupId: fallback.id, resolution: undefined, subtitle: undefined, t: undefined }}
                      className="relative flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium tabular-nums bg-card/40 text-foreground/50 ring-1 ring-dashed ring-white/10 transition-all hover:bg-card/60 hover:text-primary"
                    >
                      {ep.ep}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>第 {ep.ep} 话 · {fallback.name} 可用</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Tooltip key={ep.id}>
                <TooltipTrigger asChild>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium tabular-nums bg-white/2 text-muted-foreground/25 cursor-default">
                    {ep.ep}
                  </div>
                </TooltipTrigger>
                <TooltipContent>第 {ep.ep} 话 · 暂无资源</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Character Grid (shadcn Avatar)                                     */
/* ------------------------------------------------------------------ */
function CharacterGrid({ characters }: { characters: AnimeCharacters[] }) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-foreground">角色 & 声优</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {characters.map((ch) => (
          <div
            key={ch.id}
            className="group flex items-center gap-4 rounded-xl bg-card/50 p-4 transition-colors hover:bg-card"
          >
            <Avatar className="size-14 ring-2 ring-white/6">
              <AvatarImage src={ch.avatar} alt={ch.name} />
              <AvatarFallback className="text-base">{ch.name[0]}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground line-clamp-1">
                {ch.name}
              </h3>
              <p className="text-xs text-muted-foreground">{ch.role}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                CV: {ch.cvs[0]}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
