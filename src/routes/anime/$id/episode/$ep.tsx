import { PlaybackSurface } from "@/components/playback-surface";
import { PlaybackSubtitles } from "@/components/playback-subtitles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { playbackErrorMessage } from "@/lib/playback-error";
import { catalogPlaybackTitles, preferredSubtitle, subtitleKey } from "@/lib/playback-selection";
import {
  settingsQueryOptions,
  useDisplayLanguage,
} from "@/hooks/use-display-language";
import { useOnlineSource } from "@/hooks/use-online-source";
import { usePlayerFullscreen } from "@/hooks/use-player-fullscreen";
import { playbackRequestKey, usePlaybackResolver } from "@/hooks/use-playback-resolver";
import {
  displayAnimeTitle,
  displayEpisodeTitle,
} from "@/lib/display-language";
import type { PlaybackCandidate } from "@/lib/online-source";
import { queryClient } from "@/lib/query-client";
import {
  historyApi,
  mediaApi,
  sourceBindingApi,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { detailQueryOptions, episodesQueryOptions } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: Number(search.t) || undefined,
  }),
  component: EpisodeRoute,
});

function EpisodeRoute() {
  const { id } = Route.useParams();
  return <EpisodePage key={id} />;
}

function EpisodePage() {
  const { id, ep } = Route.useParams();
  const { t: explicitStartTime } = Route.useSearch();
  const router = useRouter();
  const episodeNumber = Number(ep);
  const language = useDisplayLanguage();
  const [subtitlePreference, setSubtitlePreference] = useState("auto");
  const [subtitleFailed, setSubtitleFailed] = useState(false);
  const fullscreen = usePlayerFullscreen();
  const isFullscreen = fullscreen.mode !== "normal";
  const progressRef = useRef<Parameters<typeof historyApi.upsert>[0] | null>(null);

  const { data: media } = useQuery(detailQueryOptions(id, language));
  const { data: storedMedia, isError: storedMediaError } = useQuery({
    queryKey: ["stored-media", id, language],
    queryFn: () => mediaApi.ensure(media!, language),
    enabled: !!media,
    staleTime: Infinity,
  });
  const { data: episodes = [] } = useQuery({
    ...episodesQueryOptions(id, media?.total_episodes ?? 0),
    enabled: !!media,
  });
  const { data: history = [], isFetched: historyFetched } = useQuery({
    queryKey: ["history-entry", id, episodeNumber],
    queryFn: () => historyApi.list(500, 0),
    staleTime: 30_000,
  });
  const { data: settings } = useQuery(settingsQueryOptions);
  const {
    data: sourceBindings = [],
    isFetched: sourceBindingsFetched,
    refetch: refetchSourceBindings,
  } = useQuery({
    queryKey: ["source-bindings", storedMedia?.id],
    queryFn: () => sourceBindingApi.list(storedMedia!.id),
    enabled: !!storedMedia,
    staleTime: 30_000,
  });

  const savedEntry = history.find(
    (entry) =>
      entry.provider === "anilist" &&
      entry.external_id === String(media?.anilist_id) &&
      entry.episode === episodeNumber,
  );
  const startTime =
    explicitStartTime ??
    (savedEntry &&
    savedEntry.position > 5 &&
    savedEntry.duration > 0 &&
    savedEntry.position / savedEntry.duration < 0.95
      ? savedEntry.position
      : undefined);

  const currentEpisode = episodes.find(
    (episode) => episode.ep === episodeNumber,
  );
  const title = displayEpisodeTitle(currentEpisode, episodeNumber, language);
  const mediaTitle = media ? displayAnimeTitle(media, language) : "Kuriume";
  const alternativeTitles = useMemo(
    () => catalogPlaybackTitles(media),
    [media?.title, media?.title_cn, media?.title_en, media?.search_titles],
  );

  const onlineSource = useOnlineSource(media?.title, alternativeTitles, {
    anilistId: media?.anilist_id,
    year: media?.year,
    episodeCount: media?.total_episodes,
    episodeNumber,
    preferencesReady: historyFetched && (sourceBindingsFetched || storedMediaError),
    preferredProviderId: savedEntry?.source_id ?? sourceBindings[0]?.source_id,
    bindings: sourceBindings,
  });
  const availableEpisodes = onlineSource.roads[onlineSource.selectedRoadIndex]?.episodes;
  const hasNext = availableEpisodes
    ? availableEpisodes.some((episode) => episode.episodeNumber === episodeNumber + 1)
    : episodes.some((episode) => episode.ep === episodeNumber + 1);
  const resolver = usePlaybackResolver();
  const resolveRequest = useMemo(
    () => onlineSource.getResolveRequest(episodeNumber),
    [episodeNumber, onlineSource.getResolveRequest],
  );
  const requestKey = onlineSource.selectedSource && resolveRequest
    ? playbackRequestKey(onlineSource.selectedSource, resolveRequest)
    : null;
  const assetIsCurrent = requestKey !== null && requestKey === resolver.requestKey;
  const subtitles = assetIsCurrent ? resolver.asset?.subtitles : undefined;
  const subtitle = subtitlePreference === "auto"
    ? preferredSubtitle(subtitles)
    : subtitles?.find((track) => subtitleKey(track) === subtitlePreference);
  const confirmedSelectionRef = useRef<string | null>(null);

  const rememberPlayingSelection = useCallback(() => {
    const candidate = onlineSource.selectedAnime;
    const providerId = onlineSource.selectedSource;
    if (!storedMedia || !candidate || !providerId) return;
    const key = `${storedMedia.id}:${providerId}:${candidate.id}:${onlineSource.selectedRoadIndex}`;
    if (confirmedSelectionRef.current === key) return;
    confirmedSelectionRef.current = key;
    void sourceBindingApi.upsert({
      mediaId: storedMedia.id,
      sourceId: providerId,
      remoteMediaUrl: candidate.id,
      remoteTitle: candidate.title,
      roadIndex: onlineSource.selectedRoadIndex,
    }).then(() => refetchSourceBindings()).catch(() => {
      confirmedSelectionRef.current = null;
    });
  }, [
    storedMedia, onlineSource.selectedAnime, onlineSource.selectedSource,
    onlineSource.selectedRoadIndex, refetchSourceBindings,
  ]);

  const retryPlayback = useCallback(() => {
    if (onlineSource.selectedSource && resolveRequest) {
      void resolver.resolve(onlineSource.selectedSource, resolveRequest);
    } else {
      onlineSource.retry();
    }
  }, [onlineSource.selectedSource, onlineSource.retry, resolveRequest, resolver.resolve]);

  useEffect(() => {
    if (onlineSource.selectedSource && resolveRequest) {
      void resolver.resolve(onlineSource.selectedSource, resolveRequest);
    } else {
      resolver.reset();
    }
  }, [
    onlineSource.selectedSource,
    resolveRequest,
    resolver.resolve,
    resolver.reset,
  ]);

  useEffect(() => {
    if (resolver.phase === "error") {
      fullscreen.close();
    }
  }, [resolver.phase, fullscreen.close]);

  const navigateToEpisode = useCallback(
    (nextEpisode: number) => {
      router.navigate({
        to: "/anime/$id/episode/$ep",
        params: { id, ep: String(nextEpisode) },
        search: { t: undefined },
        replace: true,
      });
    },
    [id, router],
  );

  const goBack = () => router.navigate({ to: "/anime/$id", params: { id }, replace: true });

  const lastSavedRef = useRef(0);
  const saveProgress = useCallback(() => {
    const snapshot = progressRef.current;
    if (!snapshot || snapshot.duration <= 0) return;
    historyApi
      .upsert(snapshot)
      .then(() => queryClient.invalidateQueries({ queryKey: ["history-list"] }))
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    saveProgress();
    progressRef.current = null;
    lastSavedRef.current = 0;
  }, [episodeNumber, saveProgress]);

  const onProgress = useCallback(
    (position: number, duration: number) => {
      if (!storedMedia || !Number.isFinite(duration) || duration <= 0) return;
      progressRef.current = {
        mediaId: storedMedia.id,
        episode: episodeNumber,
        episodeTitle: title,
        sourceId: onlineSource.selectedSource,
        position,
        duration,
      };
      const now = Date.now();
      if (now - lastSavedRef.current >= 10_000) {
        lastSavedRef.current = now;
        saveProgress();
      }
    },
    [saveProgress, storedMedia, episodeNumber, title, onlineSource.selectedSource],
  );

  const status = useMemo(() => {
    if (resolver.phase === "resolving") return "正在准备播放…";
    if (onlineSource.loadingEpisodes) return "正在读取选集…";
    if (onlineSource.searching) return "正在匹配作品…";
    if (onlineSource.sourcesLoading) return "正在载入播放源…";
    return null;
  }, [
    onlineSource.loadingEpisodes,
    onlineSource.searching,
    onlineSource.sourcesLoading,
    resolver.phase,
  ]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <header inert={isFullscreen} aria-hidden={isFullscreen} className={cn("flex h-17 shrink-0 items-center gap-3 border-b border-white/6 px-5 pt-5", isFullscreen && "invisible")}>
        <button
          type="button"
          onClick={goBack}
          className="grid h-9 w-9 place-items-center rounded-full text-foreground/65 outline-none transition-colors hover:bg-white/6 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-primary-readable"
          aria-label="返回详情"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{mediaTitle}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {title}
            {onlineSource.selectedProvider
              ? ` · ${onlineSource.selectedProvider.displayName}`
              : ""}
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(19rem,25vw,23rem)]">
        <main className={cn("min-h-0 min-w-0 bg-black", isFullscreen ? "fixed inset-0 z-50" : "relative")}>
          {fullscreen.error && <p role="alert" className="absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-lg bg-secondary px-4 py-2 text-sm text-foreground">{fullscreen.error}</p>}
          {resolver.asset && assetIsCurrent ? (
            <PlaybackSurface
              key={`${id}:${episodeNumber}:${resolver.selectedSource?.name}`}
              asset={resolver.asset}
              subtitle={subtitle}
              onSubtitleError={setSubtitleFailed}
              fullscreen={fullscreen}
              poster={media?.cover}
              startTime={progressRef.current?.episode === episodeNumber ? progressRef.current.position : startTime}
              defaultVolume={settings?.default_volume}
              defaultSpeed={settings?.default_speed}
              onProgress={onProgress}
              onPlaying={rememberPlayingSelection}
              onEnded={
                hasNext && settings?.auto_next !== false
                  ? () => navigateToEpisode(episodeNumber + 1)
                  : undefined
              }
              onError={(message) => {
                if (resolver.asset) resolver.reportError(resolver.asset, message);
              }}
            />
          ) : (
            <PlaybackEmptyState
              status={status}
              error={resolver.error || onlineSource.error}
              hasSelection={!!onlineSource.selectedAnime}
              onRetry={retryPlayback}
            />
          )}
        </main>

        <aside inert={isFullscreen} aria-hidden={isFullscreen} aria-label="播放与选集" className={cn("col-start-2 min-h-0 min-w-0 overflow-hidden border-l border-white/6 bg-card/35", isFullscreen && "invisible")}>
          <SourcePanel
            source={onlineSource}
            resolver={resolver}
            assetIsCurrent={assetIsCurrent}
            episodeNumber={episodeNumber}
            onSelectAnime={onlineSource.selectAnime}
            onSelectRoad={onlineSource.selectRoad}
            onSelectEpisode={navigateToEpisode}
            subtitleControl={assetIsCurrent && !!subtitles?.length ? (
              <PlaybackSubtitles tracks={subtitles} value={subtitlePreference} onChange={setSubtitlePreference} failed={subtitleFailed} />
            ) : null}
          />
        </aside>
      </div>
    </div>
  );
}

function PlaybackEmptyState({
  status,
  error,
  hasSelection,
  onRetry,
}: {
  status: string | null;
  error: string | null;
  hasSelection: boolean;
  onRetry: () => void;
}) {
  if (status) {
    return (
      <div
        role="status"
        className="flex h-full flex-col items-center justify-center gap-3 text-white/55"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary-readable" />
        <p className="text-sm">{status}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      {error ? (
        <TriangleAlert className="h-9 w-9 text-destructive-readable" />
      ) : (
        <Radio className="h-9 w-9 text-white/20" />
      )}
      <div className="max-w-md">
        <p className="text-sm font-medium text-white/78">
          {error
            ? "当前来源无法播放"
            : hasSelection
              ? "当前线路没有这一话"
              : "请选择匹配作品"}
        </p>
        {error && (
          <>
            <p role="alert" className="mt-2 text-sm leading-6 text-muted-foreground">{playbackErrorMessage(error)}</p>
            <details className="mt-3 text-left text-xs text-muted-foreground">
              <summary className="mx-auto w-fit cursor-pointer rounded px-2 py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable">错误详情</summary>
              <p className="mt-2 max-h-32 overflow-auto break-all rounded-lg bg-white/5 p-3 leading-5">{error}</p>
            </details>
          </>
        )}
      </div>
      {error && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={14} />
          重试
        </Button>
      )}
    </div>
  );
}

function SourcePanel({
  source,
  resolver,
  assetIsCurrent,
  episodeNumber,
  onSelectAnime,
  onSelectRoad,
  onSelectEpisode,
  subtitleControl,
}: {
  source: ReturnType<typeof useOnlineSource>;
  resolver: ReturnType<typeof usePlaybackResolver>;
  assetIsCurrent: boolean;
  episodeNumber: number;
  onSelectAnime: (candidate: PlaybackCandidate) => Promise<boolean>;
  onSelectRoad: (roadIndex: number) => void;
  onSelectEpisode: (episodeNumber: number) => void;
  subtitleControl?: React.ReactNode;
}) {
  const language = useDisplayLanguage();
  const isHiAnime = source.selectedSource === "builtin:hianime";
  const [matchingOpen, setMatchingOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const episodes = source.roads[source.selectedRoadIndex]?.episodes ?? [];
  const showCandidates = matchingOpen || !source.selectedAnime;
  const selectCandidate = async (candidate: PlaybackCandidate) => {
    if (await onSelectAnime(candidate)) setMatchingOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-5">
        <h2 className="text-sm font-semibold">播放与选集</h2>
      </div>

      <div className="hide-scrollbar min-h-0 min-w-0 flex-1 space-y-7 overflow-x-hidden overflow-y-auto p-5">
        <section>
          <PanelLabel>播放源</PanelLabel>
          {source.sourcesLoading ? (
            <LoadingLine>正在加载播放源…</LoadingLine>
          ) : (
            <ToggleGroup
              type="single"
              spacing={2}
              aria-label="播放源"
              value={source.selectedSource ?? ""}
              onValueChange={(value) => {
                if (value) {
                  source.selectSource(value);
                  setMatchingOpen(false);
                  setSearchTerm("");
                }
              }}
              className="mt-3 grid w-full grid-cols-2 gap-2"
            >
              {source.providers.map((provider) => (
                <ToggleGroupItem key={provider.id} value={provider.id}
                  className="h-auto min-h-10 min-w-0 rounded-lg border border-border/70 px-3 py-2 text-xs whitespace-normal [overflow-wrap:anywhere] data-[state=on]:border-primary/50 data-[state=on]:bg-primary/16 data-[state=on]:text-primary-readable">
                  {provider.displayName}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <PanelLabel>作品</PanelLabel>
            {source.selectedAnime && (
              <Button variant="ghost" size="xs" onClick={() => setMatchingOpen((open) => !open)} aria-expanded={showCandidates}>
                {matchingOpen ? "收起" : "重新匹配"}
              </Button>
            )}
          </div>
          {source.selectedAnime && !matchingOpen && (
            <div className="mt-3 flex items-start gap-2.5">
              <Check size={15} className="mt-0.5 shrink-0 text-primary-readable" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-6">{source.selectedAnime.title}</p>
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
                  aria-label="在当前播放源搜索作品" placeholder="输入作品名称" className="min-w-0 text-xs" />
                <Button type="submit" variant="secondary" size="icon" disabled={!searchTerm.trim() || source.searching} aria-label="搜索作品">
                  <Search size={15} aria-hidden="true" />
                </Button>
              </form>
              {source.searching ? (
                <LoadingLine>正在匹配作品…</LoadingLine>
              ) : source.searchResults.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {source.error ? "搜索未完成，请重试或切换播放源。" : "未找到匹配作品，可换个名称搜索。"}
                </p>
              ) : (
                <div className="mt-3 space-y-1">
                  {source.searchResults.map((candidate) => {
                    const selected = source.selectedAnime?.id === candidate.id;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => void selectCandidate(candidate)}
                        aria-pressed={selected}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2.5 rounded-xl px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable",
                          selected ? "bg-primary/14 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <span className="mt-1 shrink-0 text-primary-readable">
                          {selected ? <Check size={14} /> : <Play size={14} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium leading-5">{candidate.title}</span>
                          <CandidateMetadata candidate={candidate} />
                        </span>
                        {candidate.exactMatch && <span className="mt-1 shrink-0 text-[10px] text-primary-readable">匹配</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {assetIsCurrent && resolver.sources.length > 1 && (
          <section>
            <PanelLabel>播放线路</PanelLabel>
            <ToggleGroup type="single" spacing={2} aria-label="播放线路"
              value={resolver.selectedSource?.name ?? ""}
              onValueChange={(name) => { if (name) resolver.selectSource(name); }}
              className="mt-3 flex w-full flex-wrap justify-start gap-2">
              {resolver.sources.map((item) => (
                <ToggleGroupItem key={item.name} value={item.name}
                  className="h-auto min-h-9 max-w-full rounded-lg border border-border/70 px-3 py-1.5 text-xs whitespace-normal [overflow-wrap:anywhere] data-[state=on]:border-primary/50 data-[state=on]:bg-primary/16 data-[state=on]:text-primary-readable">
                  {item.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </section>
        )}

        {source.roads.length > 0 && !source.loadingEpisodes && (
          <section>
            <PanelLabel>{isHiAnime ? (language === "zh" ? "音频" : "Audio") : (language === "zh" ? "线路" : "Server")}</PanelLabel>
            <ToggleGroup type="single" spacing={2} value={String(source.selectedRoadIndex)}
              aria-label={isHiAnime ? (language === "zh" ? "音频版本" : "Audio version") : (language === "zh" ? "线路" : "Server")}
              onValueChange={(value) => { if (value) onSelectRoad(Number(value)); }}
              className="mt-3 w-full flex-wrap justify-start gap-2">
              {source.roads.map((road, index) => (
                <ToggleGroupItem key={road.id} value={String(index)} size="sm" className="h-auto min-h-9 max-w-full rounded-lg px-3 py-1.5 text-xs whitespace-normal [overflow-wrap:anywhere]">
                  {isHiAnime && road.id === "sub" ? (language === "zh" ? "原声 · Sub" : "Original · Sub")
                    : isHiAnime && road.id === "dub" ? (language === "zh" ? "配音 · Dub" : "Dubbed · Dub") : road.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </section>
        )}

        {subtitleControl}

        {source.selectedAnime && (
          <section>
            <div className="flex items-center justify-between">
              <PanelLabel>剧集</PanelLabel>
              {episodes.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{episodes.length} 话</span>}
            </div>
            {source.loadingEpisodes ? (
              <LoadingLine>正在读取剧集…</LoadingLine>
            ) : source.roads.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">暂无可用剧集</p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {episodes.map((episode) => {
                    const number = episode.episodeNumber;
                    const navigable = number !== null && Number.isInteger(number) && number > 0;
                    return (
                      <button key={episode.id} type="button" disabled={!navigable}
                        onClick={() => { if (navigable) onSelectEpisode(number); }}
                        aria-current={number === episodeNumber ? "true" : undefined}
                        aria-label={episode.label}
                        title={episode.label}
                        className={cn(
                          "min-h-10 rounded-lg px-1 text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable disabled:opacity-40",
                          number === episodeNumber
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary/65 text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}>
                        {number ?? episode.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {source.error && (
          <div role="alert" className="text-xs leading-5 text-destructive-readable">
            <p>{playbackErrorMessage(source.error)}</p>
            <Button variant="ghost" size="xs" className="mt-2 -ml-2" onClick={source.retry}>
              <RefreshCw size={12} />重试
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateMetadata({ candidate }: { candidate: PlaybackCandidate }) {
  if (!candidate.year && !candidate.episodeCount) return null;
  return (
    <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
      {[candidate.year, candidate.episodeCount && `${candidate.episodeCount} 话已上线`].filter(Boolean).join(" · ")}
    </span>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-medium text-muted-foreground">{children}</h2>;
}

function LoadingLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-readable" />
      {children}
    </div>
  );
}
