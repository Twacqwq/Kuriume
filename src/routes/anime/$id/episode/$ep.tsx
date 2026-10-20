import { LibraryControl } from "@/components/library-control";
import { PlaybackPanel, PlaybackOptions, type PanelDrawer } from "@/components/playback-panel";
import { PlaybackSurface } from "@/components/playback-surface";
import { PlaybackSubtitles } from "@/components/playback-subtitles";
import type { PlayerEpisode } from "@/components/player-chrome";
import { Button } from "@/components/ui/button";
import { playbackErrorMessage } from "@/lib/playback-error";
import { catalogPlaybackTitles, preferredSubtitle, subtitleKey } from "@/lib/playback-selection";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { useLibraryEntry } from "@/hooks/use-library-entry";
import { SIDE_PANEL_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useOnlineSource } from "@/hooks/use-online-source";
import { usePlayerFullscreen } from "@/hooks/use-player-fullscreen";
import { playbackRequestKey, usePlaybackResolver } from "@/hooks/use-playback-resolver";
import {
  displayAnimeTitle,
  displayEpisodeTitle,
} from "@/lib/display-language";
import { queryClient } from "@/lib/query-client";
import {
  historyApi,
  mediaApi,
  settingsQueryOptions,
  sourceBindingApi,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { detailQueryOptions, episodesQueryOptions } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Loader2,
  Radio,
  RefreshCw,
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

  const { data: media, error: detailError } = useQuery(detailQueryOptions(id, language));
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

  // A failed source no longer throws the viewer out of fullscreen. Each
  // provider is tried automatically at most once per episode, in order.
  const triedProvidersRef = useRef(new Set<string>());
  useEffect(() => { triedProvidersRef.current = new Set(); }, [episodeNumber]);
  const playbackFailed = resolver.phase === "error" || (!!onlineSource.error && !!onlineSource.selectedSource);
  if (playbackFailed && onlineSource.selectedSource) triedProvidersRef.current.add(onlineSource.selectedSource);
  const fallbackProvider = useMemo(() => {
    if (!playbackFailed) return null;
    const providers = onlineSource.providers;
    const index = providers.findIndex((provider) => provider.id === onlineSource.selectedSource);
    for (let step = 1; step < providers.length; step++) {
      const candidate = providers[(index + step) % providers.length];
      if (!triedProvidersRef.current.has(candidate.id)) return candidate;
    }
    return null;
  }, [playbackFailed, onlineSource.providers, onlineSource.selectedSource]);

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

  // Return to wherever playback was opened from (home, library, calendar…);
  // a cold deep link falls back to the work's details.
  const goBack = useCallback(() => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/anime/$id", params: { id }, replace: true });
  }, [router, id]);

  useEffect(() => {
    const back = (event: Event) => {
      event.preventDefault();
      if (document.querySelector("[data-player-locked]")) window.dispatchEvent(new Event("kuriume-player-unlock"));
      else if (isFullscreen) fullscreen.close();
      else goBack();
    };
    window.addEventListener("kuriume-back", back);
    return () => window.removeEventListener("kuriume-back", back);
  }, [isFullscreen, fullscreen.close, goBack]);

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

  useEffect(() => {
    const save = () => saveProgress();
    document.addEventListener("visibilitychange", save);
    document.addEventListener("kuriume-background", save);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", save);
      document.removeEventListener("kuriume-background", save);
      window.removeEventListener("pagehide", save);
    };
  }, [saveProgress]);

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

  const isSidePanel = useMediaQuery(SIDE_PANEL_QUERY);
  const [panelDrawer, setPanelDrawer] = useState<PanelDrawer | null>(null);
  const library = useLibraryEntry(storedMedia?.id);
  const watched = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of history) {
      if (entry.provider !== "anilist" || entry.external_id !== String(media?.anilist_id) || entry.duration <= 0) continue;
      map.set(entry.episode, Math.min(1, entry.position / entry.duration));
    }
    return map;
  }, [history, media?.anilist_id]);
  const playerEpisodes = useMemo<PlayerEpisode[]>(
    () => (availableEpisodes ?? [])
      .filter((episode): episode is typeof episode & { episodeNumber: number } =>
        episode.episodeNumber !== null && Number.isInteger(episode.episodeNumber) && episode.episodeNumber > 0)
      .map((episode) => ({ number: episode.episodeNumber, label: episode.label, progress: watched.get(episode.episodeNumber) })),
    [availableEpisodes, watched],
  );
  const episodeTitle = language === "zh" ? currentEpisode?.title_cn : currentEpisode?.title;
  const next = hasNext
    ? { episode: episodeNumber + 1, label: episodeLabel(episodeNumber + 1, language), onPlay: () => navigateToEpisode(episodeNumber + 1) }
    : null;

  const status = useMemo(() => {
    if (resolver.phase === "resolving") return language === "zh" ? "正在准备播放…" : "Preparing playback…";
    if (onlineSource.loadingEpisodes) return language === "zh" ? "正在读取选集…" : "Loading episodes…";
    if (onlineSource.searching) return language === "zh" ? "正在匹配作品…" : "Finding your anime…";
    if (onlineSource.sourcesLoading) return language === "zh" ? "正在载入播放源…" : "Loading sources…";
    return null;
  }, [
    onlineSource.loadingEpisodes,
    onlineSource.searching,
    onlineSource.sourcesLoading,
    resolver.phase,
    language,
  ]);
  const subtitleControl = assetIsCurrent && !!subtitles?.length ? (
    <PlaybackSubtitles tracks={subtitles} value={subtitlePreference} onChange={setSubtitlePreference} failed={subtitleFailed} />
  ) : null;
  const subtitleLabel = subtitlePreference === "off"
    ? (language === "zh" ? "关闭" : "Off")
    : subtitle?.label ?? (language === "zh" ? "自动" : "Auto");
  const libraryControl = (
    <LibraryControl compact entry={library.entry} disabled={library.pending}
      onSetStatus={library.setStatus} onRemove={library.remove} />
  );

  // Shown by the route error screen (retry / back) when the catalog lookup fails.
  if (detailError && !media) throw detailError;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <header inert={isFullscreen} aria-hidden={isFullscreen} className={cn("player-header flex shrink-0 items-center gap-3 border-b border-white/6 px-3", isFullscreen && "invisible")}>
        <button
          type="button"
          onClick={goBack}
          className="grid size-12 shrink-0 place-items-center rounded-full text-foreground/65 outline-none transition-colors hover:bg-white/6 hover:text-foreground active:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-primary-readable"
          aria-label={language === "zh" ? "返回" : "Back"}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold">{mediaTitle}</h1>
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {episodeLabel(episodeNumber, language)}
          </p>
        </div>
      </header>

      <div className="player-layout grid min-h-0 flex-1">
        <section aria-label={language === "zh" ? "播放器" : "Player"} className={cn("player-video min-h-0 min-w-0 bg-black", isFullscreen ? "fixed inset-0 z-50" : "relative")}>
          {fullscreen.error && <p role="alert" className="absolute left-1/2 top-16 z-[80] -translate-x-1/2 rounded-lg bg-secondary px-4 py-2 text-sm text-foreground">{fullscreen.error}</p>}
          {resolver.asset && assetIsCurrent ? (
            <PlaybackSurface
              key={`${id}:${episodeNumber}:${resolver.selectedSource?.name}`}
              asset={resolver.asset}
              subtitle={subtitle}
              onSubtitleError={setSubtitleFailed}
              fullscreen={fullscreen}
              poster={media?.cover}
              startTime={progressRef.current?.episode === episodeNumber ? progressRef.current.position : startTime}
              resumeFrom={progressRef.current?.episode === episodeNumber ? undefined : startTime}
              defaultVolume={settings?.default_volume}
              defaultSpeed={settings?.default_speed}
              onProgress={onProgress}
              onPlaying={rememberPlayingSelection}
              title={episodeLabel(episodeNumber, language)}
              mediaTitle={mediaTitle}
              next={next}
              autoNext={settings?.auto_next !== false}
              episodes={playerEpisodes}
              currentEpisode={episodeNumber}
              onSelectEpisode={navigateToEpisode}
              options={<PlaybackOptions source={onlineSource} resolver={resolver} assetIsCurrent={assetIsCurrent} subtitleControl={subtitleControl} />}
              onOpenOptions={isSidePanel ? undefined : () => setPanelDrawer("server")}
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
              fallback={fallbackProvider ? { name: fallbackProvider.displayName, onSelect: () => onlineSource.selectSource(fallbackProvider.id) } : null}
              autoFallback={resolver.phase === "error"}
              fullscreen={isFullscreen}
              title={episodeLabel(episodeNumber, language)}
              onExitFullscreen={fullscreen.close}
            />
          )}
        </section>

        <aside inert={isFullscreen} aria-hidden={isFullscreen} aria-label={language === "zh" ? "播放与选集" : "Episodes and playback"} className={cn("player-options min-h-0 min-w-0 overflow-hidden border-white/6 bg-card/35", isFullscreen && "invisible")}>
          <PlaybackPanel
            layout={isSidePanel ? "side" : "stacked"}
            source={onlineSource}
            resolver={resolver}
            assetIsCurrent={assetIsCurrent}
            episodeNumber={episodeNumber}
            episodeTitle={episodeTitle}
            episodes={playerEpisodes}
            onSelectEpisode={navigateToEpisode}
            subtitleControl={subtitleControl}
            subtitleLabel={subtitleLabel}
            library={libraryControl}
            drawer={panelDrawer}
            onDrawer={setPanelDrawer}
          />
        </aside>
      </div>
    </div>
  );
}

function episodeLabel(episodeNumber: number, language: string) {
  return language === "zh" ? `第 ${episodeNumber} 话` : `Episode ${episodeNumber}`;
}

const FALLBACK_DELAY_S = 3;

function PlaybackEmptyState({
  status,
  error,
  hasSelection,
  onRetry,
  fallback,
  autoFallback,
  fullscreen,
  title,
  onExitFullscreen,
}: {
  status: string | null;
  error: string | null;
  hasSelection: boolean;
  onRetry: () => void;
  fallback: { name: string; onSelect: () => void } | null;
  autoFallback: boolean;
  fullscreen: boolean;
  title: string;
  onExitFullscreen: () => void;
}) {
  const language = useDisplayLanguage();
  const zh = language === "zh";
  const [countdown, setCountdown] = useState<number | null>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const fallbackName = fallback?.name;
  useEffect(() => {
    if (!error || !autoFallback || !fallbackName) { setCountdown(null); return; }
    setCountdown(FALLBACK_DELAY_S);
    const timer = setInterval(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => clearInterval(timer);
  }, [error, autoFallback, fallbackName]);
  useEffect(() => {
    if (countdown === 0) { setCountdown(null); fallbackRef.current?.onSelect(); }
  }, [countdown]);

  const exitBar = fullscreen && (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-2 pt-[max(4px,env(safe-area-inset-top))]">
      <button type="button" onClick={onExitFullscreen} aria-label={zh ? "退出全屏" : "Exit fullscreen"}
        className="grid size-12 place-items-center rounded-full text-white/80 outline-none active:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary-readable">
        <ArrowLeft size={20} />
      </button>
      <p className="text-[15px] font-bold text-white/90">{title}</p>
    </div>
  );

  if (status) {
    return (
      <div role="status" className="relative flex h-full flex-col items-center justify-center gap-3 text-white/55">
        {exitBar}
        <Loader2 className="h-6 w-6 animate-spin text-primary-readable" />
        <p className="text-sm">{status}</p>
      </div>
    );
  }
  return (
    <div className="hide-scrollbar relative flex h-full flex-col items-center gap-3 overflow-y-auto px-5 py-5 text-center before:mt-auto after:mb-auto">
      {exitBar}
      {error ? (
        <TriangleAlert className="h-8 w-8 shrink-0 text-destructive-readable" />
      ) : (
        <Radio className="h-8 w-8 shrink-0 text-white/20" />
      )}
      <div className="max-w-md">
        <p className="text-sm font-medium text-white/78">
          {error
            ? (zh ? "当前来源无法播放" : "This source is unavailable")
            : hasSelection
              ? (zh ? "当前线路没有这一话" : "Episode unavailable on this server")
              : (zh ? "请选择匹配作品" : "Choose a matching title")}
        </p>
        {error && (
          <>
            <p role="alert" className="mt-1.5 text-sm leading-6 text-muted-foreground">{playbackErrorMessage(error)}</p>
            <details className="mt-2 text-left text-xs text-muted-foreground">
              <summary className="mx-auto w-fit cursor-pointer rounded px-2 py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable">{zh ? "错误详情" : "Error details"}</summary>
              <p className="mt-2 max-h-32 overflow-auto break-all rounded-lg bg-white/5 p-3 leading-5">{error}</p>
            </details>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {error && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw size={14} />
            {zh ? "重试" : "Retry"}
          </Button>
        )}
        {fallback && (error || hasSelection) && (
          <Button size="sm" onClick={() => { setCountdown(null); fallback.onSelect(); }}>
            {zh ? `换到 ${fallback.name}` : `Try ${fallback.name}`}
            {countdown !== null && <span className="tabular-nums opacity-80">· {countdown}s</span>}
          </Button>
        )}
        {countdown !== null && (
          <Button variant="ghost" size="sm" onClick={() => setCountdown(null)}>{zh ? "取消" : "Cancel"}</Button>
        )}
        {fullscreen && !hasSelection && !status && (
          <Button variant="secondary" size="sm" onClick={onExitFullscreen}>{zh ? "退出全屏去匹配" : "Exit to match"}</Button>
        )}
      </div>
    </div>
  );
}
