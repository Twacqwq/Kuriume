import { EpisodeButton, type PlayerEpisode } from "@/components/player-chrome";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import type { useOnlineSource } from "@/hooks/use-online-source";
import type { usePlaybackResolver } from "@/hooks/use-playback-resolver";
import type { PlaybackCandidate } from "@/lib/online-source";
import { playbackErrorMessage } from "@/lib/playback-error";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, Play, RefreshCw, Search } from "lucide-react";
import { KuriMark } from "@/components/kuri-loader";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Source = ReturnType<typeof useOnlineSource>;
type Resolver = ReturnType<typeof usePlaybackResolver>;
export type PanelDrawer = "episodes" | "source" | "server" | "subtitles";

export interface PlaybackPanelProps {
  layout: "stacked" | "side";
  source: Source;
  resolver: Resolver;
  assetIsCurrent: boolean;
  episodeNumber: number;
  episodeTitle?: string;
  episodes: PlayerEpisode[];
  onSelectEpisode: (episode: number) => void;
  subtitleControl?: ReactNode;
  subtitleLabel?: string;
  library?: ReactNode;
  drawer: PanelDrawer | null;
  onDrawer: (drawer: PanelDrawer | null) => void;
}

const zhLabel = (zh: boolean, chinese: string, english: string) => (zh ? chinese : english);

export function roadDisplayLabel(source: Source, roadId: string | undefined, label: string | undefined, zh: boolean) {
  const isHiAnime = source.selectedSource === "builtin:hianime";
  if (isHiAnime && roadId === "sub") return zh ? "原声 · Sub" : "Original · Sub";
  if (isHiAnime && roadId === "dub") return zh ? "配音 · Dub" : "Dubbed · Dub";
  return label;
}

/**
 * Below the video (phones/tablets in portrait) the panel is three rows: the
 * current episode, a one-line episode strip, and chips that open each picker
 * in a sheet. Beside the video (wide screens) it is two tabs.
 */
export function PlaybackPanel(props: PlaybackPanelProps) {
  return props.layout === "side" ? <SidePanel {...props} /> : <StackedPanel {...props} />;
}

function needsAttention(source: Source, resolver: Resolver) {
  return !source.selectedAnime || Boolean(source.error) || resolver.phase === "error";
}

function StackedPanel(props: PlaybackPanelProps) {
  const { source, resolver, episodes, episodeNumber, drawer, onDrawer } = props;
  const zh = useDisplayLanguage() === "zh";
  const strip = useRef<HTMLDivElement>(null);
  const road = source.roads[source.selectedRoadIndex];
  const matching = !source.selectedAnime && !source.sourcesLoading;
  useEffect(() => {
    const container = strip.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (container && active) container.scrollLeft = Math.max(0, active.offsetLeft - container.clientWidth / 2 + active.offsetWidth / 2);
  }, [episodeNumber, episodes.length]);
  const serverValue = [
    roadDisplayLabel(source, road?.id, road?.label, zh),
    props.assetIsCurrent && resolver.sources.length > 1 ? resolver.selectedSource?.name : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <div className="hide-scrollbar h-full min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">
      <section className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold tabular-nums">{zh ? `第 ${episodeNumber} 话` : `Episode ${episodeNumber}`}</h2>
          {props.episodeTitle && <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{props.episodeTitle}</p>}
        </div>
        {props.library && <div className="shrink-0">{props.library}</div>}
      </section>

      <section aria-labelledby="episode-strip-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="episode-strip-title" className="text-sm font-bold">{zhLabel(zh, "选集", "Episodes")}</h3>
          {episodes.length > 0 && (
            <button type="button" onClick={() => onDrawer("episodes")}
              className="-mr-2 flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-xs text-muted-foreground outline-none active:bg-secondary focus-visible:ring-2 focus-visible:ring-primary-readable">
              {zh ? `全部 ${episodes.length} 话` : `All ${episodes.length}`}<ChevronRight size={14} />
            </button>
          )}
        </div>
        {source.loadingEpisodes ? (
          <LoadingLine>{zhLabel(zh, "正在读取剧集…", "Loading episodes…")}</LoadingLine>
        ) : !source.selectedAnime ? (
          <p className="mt-2 text-sm text-muted-foreground">{zhLabel(zh, "匹配作品后显示剧集", "Match an anime to see episodes")}</p>
        ) : episodes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{zhLabel(zh, "暂无可用剧集", "No episodes available")}</p>
        ) : (
          <div ref={strip} className="hide-scrollbar -mx-4 mt-2 flex snap-x gap-2 overflow-x-auto scroll-px-4 px-4 py-0.5">
            {episodes.map((episode) => (
              <EpisodeButton key={episode.number} episode={episode} current={episode.number === episodeNumber}
                onSelect={props.onSelectEpisode} className="w-14 shrink-0 snap-start" />
            ))}
          </div>
        )}
      </section>

      {matching && (
        <section className="rounded-2xl bg-card p-4">
          <ProviderPicker source={source} />
          <div className="mt-5"><AnimeMatch source={source} /></div>
        </section>
      )}

      {!matching && (
        <section aria-label={zhLabel(zh, "播放设置", "Playback settings")} className="flex flex-wrap gap-2">
          <OptionChip label={zhLabel(zh, "播放源", "Source")} value={source.selectedProvider?.displayName ?? "—"} onClick={() => onDrawer("source")} attention={Boolean(source.error)} />
          {(source.roads.length > 1 || (props.assetIsCurrent && resolver.sources.length > 1)) && (
            <OptionChip label={zhLabel(zh, "线路", "Server")} value={serverValue || "—"} onClick={() => onDrawer("server")} attention={resolver.phase === "error"} />
          )}
          {props.subtitleControl && <OptionChip label={zhLabel(zh, "字幕", "Subtitles")} value={props.subtitleLabel ?? ""} onClick={() => onDrawer("subtitles")} />}
        </section>
      )}

      {source.error && <SourceError source={source} />}

      <Drawer open={drawer !== null} onOpenChange={(open) => { if (!open) onDrawer(null); }}>
        <DrawerContent className="max-h-[82dvh] pb-[env(safe-area-inset-bottom)]">
          <DrawerHeader className="pb-2 text-left!">
            <DrawerTitle>{drawer ? drawerTitle(drawer, zh) : ""}</DrawerTitle>
            <DrawerDescription className="sr-only">{drawer ? drawerTitle(drawer, zh) : ""}</DrawerDescription>
          </DrawerHeader>
          <div className="hide-scrollbar min-h-0 overflow-y-auto overscroll-contain px-4 pb-6">
            {drawer === "episodes" && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2">
                {episodes.map((episode) => (
                  <EpisodeButton key={episode.number} episode={episode} current={episode.number === episodeNumber}
                    onSelect={(value) => { onDrawer(null); props.onSelectEpisode(value); }} />
                ))}
              </div>
            )}
            {drawer === "source" && (
              <div className="space-y-6">
                <ProviderPicker source={source} />
                <AnimeMatch source={source} />
              </div>
            )}
            {drawer === "server" && <ServerOptions source={source} resolver={resolver} assetIsCurrent={props.assetIsCurrent} />}
            {drawer === "subtitles" && props.subtitleControl}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function drawerTitle(drawer: PanelDrawer, zh: boolean) {
  return ({
    episodes: zh ? "选集" : "Episodes",
    source: zh ? "播放源与作品" : "Source & title",
    server: zh ? "线路" : "Server",
    subtitles: zh ? "字幕" : "Subtitles",
  })[drawer];
}

function OptionChip({ label, value, onClick, attention }: { label: string; value: string; onClick: () => void; attention?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm outline-none transition-colors active:bg-accent focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
        attention ? "border-destructive-readable/50 text-destructive-readable" : "border-border/80 bg-secondary/40 text-foreground/90")}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-bold">{value}</span>
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function SidePanel(props: PlaybackPanelProps) {
  const { source, resolver, episodes, episodeNumber } = props;
  const zh = useDisplayLanguage() === "zh";
  const loading = source.sourcesLoading || source.searching || source.loadingEpisodes;
  const attention = needsAttention(source, resolver) && !loading;
  // Follow what needs the viewer (a failed or missing match), until they pick a tab.
  const [chosenTab, setChosenTab] = useState<"episodes" | "source" | null>(null);
  useEffect(() => { if (attention) setChosenTab(null); }, [attention]);
  const tab = chosenTab ?? (attention ? "source" : "episodes");
  const setTab = setChosenTab;
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = grid.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (container && active) container.scrollTop = Math.max(0, active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2);
  }, [episodeNumber, episodes.length, tab]);
  const tabs = [
    { id: "episodes", label: zhLabel(zh, "选集", "Episodes") },
    { id: "source", label: zhLabel(zh, "播放源", "Source") },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={zhLabel(zh, "播放面板", "Playback panel")} className="flex min-h-14 shrink-0 items-end gap-1 border-b border-border/60 px-3">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" id={`panel-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={cn("relative flex min-h-12 items-center px-3 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable motion-reduce:transition-none",
              tab === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {item.label}
            {item.id === "source" && attention && <span className="ml-1.5 size-1.5 rounded-full bg-destructive-readable" aria-hidden="true" />}
            {tab === item.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>
      {tab === "episodes" ? (
        <div role="tabpanel" id="panel-episodes" aria-labelledby="panel-tab-episodes" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold tabular-nums">{zh ? `第 ${episodeNumber} 话` : `Episode ${episodeNumber}`}</h2>
              {props.episodeTitle && <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{props.episodeTitle}</p>}
            </div>
            {props.library}
          </div>
          {source.loadingEpisodes ? (
            <div className="px-4"><LoadingLine>{zhLabel(zh, "正在读取剧集…", "Loading episodes…")}</LoadingLine></div>
          ) : episodes.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">{source.selectedAnime ? zhLabel(zh, "暂无可用剧集", "No episodes available") : zhLabel(zh, "在「播放源」中匹配作品后显示剧集", "Match an anime under Source to see episodes")}</p>
          ) : (
            <div ref={grid} className="hide-scrollbar relative grid min-h-0 flex-1 grid-cols-5 content-start gap-2 overflow-y-auto overscroll-contain px-4 pb-6 pt-0.5">
              {episodes.map((episode) => (
                <EpisodeButton key={episode.number} episode={episode} current={episode.number === episodeNumber} onSelect={props.onSelectEpisode} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="panel-source" aria-labelledby="panel-tab-source" className="hide-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
          <PlaybackOptions source={source} resolver={resolver} assetIsCurrent={props.assetIsCurrent} subtitleControl={props.subtitleControl} />
        </div>
      )}
    </div>
  );
}

/** Every picker at once: the wide-screen "Source" tab and the fullscreen sheet. */
export function PlaybackOptions({ source, resolver, assetIsCurrent, subtitleControl }: { source: Source; resolver: Resolver; assetIsCurrent: boolean; subtitleControl?: ReactNode }) {
  return (
    <div className="space-y-6">
      <ServerOptions source={source} resolver={resolver} assetIsCurrent={assetIsCurrent} />
      <ProviderPicker source={source} />
      <AnimeMatch source={source} />
      {subtitleControl}
      {source.error && <SourceError source={source} />}
    </div>
  );
}

function ServerOptions({ source, resolver, assetIsCurrent }: { source: Source; resolver: Resolver; assetIsCurrent: boolean }) {
  const zh = useDisplayLanguage() === "zh";
  const isHiAnime = source.selectedSource === "builtin:hianime";
  const hasStreams = assetIsCurrent && resolver.sources.length > 1;
  if (!hasStreams && source.roads.length === 0) return null;
  return (
    <div className="space-y-6">
      {source.roads.length > 0 && !source.loadingEpisodes && (
        <section>
          <PanelLabel>{isHiAnime ? zhLabel(zh, "音频", "Audio") : zhLabel(zh, "线路", "Server")}</PanelLabel>
          <ToggleGroup type="single" spacing={2} value={String(source.selectedRoadIndex)}
            aria-label={isHiAnime ? zhLabel(zh, "音频版本", "Audio version") : zhLabel(zh, "线路", "Server")}
            onValueChange={(value) => { if (value) source.selectRoad(Number(value)); }}
            className="mt-3 w-full flex-wrap justify-start gap-2">
            {source.roads.map((road, index) => (
              <ToggleGroupItem key={road.id} value={String(index)} size="sm"
                className="h-auto min-h-12 max-w-full rounded-xl border border-border/70 px-3 py-2 text-sm whitespace-normal [overflow-wrap:anywhere] data-[state=on]:border-primary/50 data-[state=on]:bg-primary/16 data-[state=on]:text-primary-readable">
                {roadDisplayLabel(source, road.id, road.label, zh)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      )}
      {hasStreams && (
        <section>
          <PanelLabel>{zhLabel(zh, "播放线路", "Stream")}</PanelLabel>
          <ToggleGroup type="single" spacing={2} aria-label={zhLabel(zh, "播放线路", "Stream")}
            value={resolver.selectedSource?.name ?? ""}
            onValueChange={(name) => { if (name) resolver.selectSource(name); }}
            className="mt-3 flex w-full flex-wrap justify-start gap-2">
            {resolver.sources.map((item) => (
              <ToggleGroupItem key={item.name} value={item.name}
                className="h-auto min-h-12 max-w-full rounded-xl border border-border/70 px-3 py-2 text-sm whitespace-normal [overflow-wrap:anywhere] data-[state=on]:border-primary/50 data-[state=on]:bg-primary/16 data-[state=on]:text-primary-readable">
                {item.name}
                {resolver.failedNames.includes(item.name) && <span className="ml-1 text-xs text-destructive-readable">{zhLabel(zh, "失败", "failed")}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      )}
    </div>
  );
}

export function ProviderPicker({ source }: { source: Source }) {
  const zh = useDisplayLanguage() === "zh";
  return (
    <section>
      <PanelLabel>{zhLabel(zh, "播放源", "Source")}</PanelLabel>
      {source.sourcesLoading ? (
        <LoadingLine>{zhLabel(zh, "正在加载播放源…", "Loading sources…")}</LoadingLine>
      ) : (
        <ToggleGroup type="single" spacing={2} aria-label={zhLabel(zh, "播放源", "Source")}
          value={source.selectedSource ?? ""}
          onValueChange={(value) => { if (value) source.selectSource(value); }}
          className="mt-3 grid w-full grid-cols-2 gap-2">
          {source.providers.map((provider) => (
            <ToggleGroupItem key={provider.id} value={provider.id}
              className="h-auto min-h-12 min-w-0 rounded-xl border border-border/70 px-3 py-2 text-sm whitespace-normal [overflow-wrap:anywhere] data-[state=on]:border-primary/50 data-[state=on]:bg-primary/16 data-[state=on]:text-primary-readable">
              {provider.displayName}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </section>
  );
}

export function AnimeMatch({ source }: { source: Source }) {
  const zh = useDisplayLanguage() === "zh";
  const [matchingOpen, setMatchingOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const showCandidates = matchingOpen || !source.selectedAnime;
  useEffect(() => { setMatchingOpen(false); setSearchTerm(""); }, [source.selectedSource]);
  const selectCandidate = async (candidate: PlaybackCandidate) => {
    if (await source.selectAnime(candidate)) setMatchingOpen(false);
  };
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <PanelLabel>{zhLabel(zh, "作品", "Anime")}</PanelLabel>
        {source.selectedAnime && (
          <Button variant="ghost" size="xs" onClick={() => setMatchingOpen((open) => !open)} aria-expanded={showCandidates}>
            {matchingOpen ? zhLabel(zh, "收起", "Close") : zhLabel(zh, "匹配不对？", "Wrong match?")}
          </Button>
        )}
      </div>
      {source.selectedAnime && !matchingOpen && (
        <div className="mt-3 flex items-start gap-2.5">
          <Check size={15} className="mt-0.5 shrink-0 text-primary-readable" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-6 [overflow-wrap:anywhere]">{source.selectedAnime.title}</p>
            <CandidateMetadata candidate={source.selectedAnime} />
          </div>
        </div>
      )}
      {showCandidates && (
        <div className="mt-3">
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            source.search(searchTerm);
          }}>
            <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)}
              aria-label={zhLabel(zh, "在当前播放源搜索作品", "Search this source")} placeholder={zhLabel(zh, "输入作品名称", "Anime title")} className="min-h-12 min-w-0 text-base" />
            <Button type="submit" variant="secondary" size="icon" className="size-12 shrink-0 rounded-xl" disabled={!searchTerm.trim() || source.searching} aria-label={zhLabel(zh, "搜索作品", "Search anime")}>
              <Search size={15} aria-hidden="true" />
            </Button>
          </form>
          {source.searching ? (
            <LoadingLine>{zhLabel(zh, "正在匹配作品…", "Matching anime…")}</LoadingLine>
          ) : source.searchResults.length === 0 ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {source.error ? zhLabel(zh, "搜索未完成，请重试或切换播放源。", "Search failed. Retry or choose another source.") : zhLabel(zh, "未找到匹配作品，可换个名称搜索。", "No match found. Try another title.")}
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {source.searchResults.map((candidate) => {
                const selected = source.selectedAnime?.id === candidate.id;
                return (
                  <button key={candidate.id} type="button" onClick={() => void selectCandidate(candidate)} aria-pressed={selected}
                    className={cn("flex w-full min-w-0 items-start gap-2.5 rounded-xl px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable active:bg-accent motion-reduce:transition-none",
                      selected ? "bg-primary/14 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                    <span className="mt-1 shrink-0 text-primary-readable">{selected ? <Check size={14} /> : <Play size={14} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-5 [overflow-wrap:anywhere]">{candidate.title}</span>
                      <CandidateMetadata candidate={candidate} />
                    </span>
                    {candidate.exactMatch && <span className="mt-1 shrink-0 text-xs text-primary-readable">{zhLabel(zh, "匹配", "Match")}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SourceError({ source }: { source: Source }) {
  const zh = useDisplayLanguage() === "zh";
  return (
    <div role="alert" className="text-xs leading-5 text-destructive-readable">
      <p>{playbackErrorMessage(source.error!)}</p>
      <Button variant="ghost" size="xs" className="mt-2 -ml-2" onClick={source.retry}>
        <RefreshCw size={12} />{zhLabel(zh, "重试", "Retry")}
      </Button>
    </div>
  );
}

function CandidateMetadata({ candidate }: { candidate: PlaybackCandidate }) {
  const zh = useDisplayLanguage() === "zh";
  if (!candidate.year && !candidate.episodeCount) return null;
  return (
    <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
      {[candidate.year, candidate.episodeCount && (zh ? `${candidate.episodeCount} 话已上线` : `${candidate.episodeCount} episodes available`)].filter(Boolean).join(" · ")}
    </span>
  );
}

function PanelLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>;
}

export function LoadingLine({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="kuri kuri-sm inline-grid shrink-0"><KuriMark className="size-full" /></span>
      {children}
    </div>
  );
}
