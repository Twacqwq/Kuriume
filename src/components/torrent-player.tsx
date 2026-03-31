/**
 * Torrent-based player component — uses mpv backend for playback.
 *
 * Orchestrates the torrent streaming pipeline:
 * 1. Add torrent → resolve metadata
 * 2. Auto-select the best video file
 * 3. Stream via local HTTP → mpv (native GPU render)
 * 4. Transparent webview overlays controls on top of native mpv view
 * 5. Show download progress overlay
 *
 * Layout:
 * ┌──────────────────────────────────────────┐
 * │  Top bar (back, title, episode info)     │
 * │                                          │
 * │   (native mpv view renders below)        │
 * │                                          │
 * │  Torrent stats overlay (progress, speed) │
 * │  Bottom controls (driven by mpv events)  │
 * └──────────────────────────────────────────┘
 */
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, formatSpeed } from "@/lib/torrent";
import { usePlayer } from "@/hooks/use-player";
import { usePlayerGestures } from "@/hooks/use-player-gestures";
import { playerApi } from "@/lib/player";
import { historyApi, settingsApi } from "@/lib/store";
import { useTorrentStream, type TorrentStreamPhase, type CacheContext } from "@/hooks/use-torrent-stream";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  HardDrive,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Time formatting ──────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Types ────────────────────────────────────────────────────────

/** Context for saving watch history. */
export interface HistoryContext {
  bgmId: string;
  episode: number;
  animeTitle: string;
  episodeTitle: string;
  cover: string | null;
  groupId: string | null;
  resolution: string | null;
  subtitle: string | null;
}

export interface TorrentPlayerProps {
  /** Magnet URI or .torrent URL (torrent mode). */
  source?: string;
  /** Direct video URL to play — skips torrent pipeline entirely (online mode). */
  videoUrl?: string;
  /** Title displayed in the top bar. */
  title?: string;
  /** Subtitle line (e.g. anime name + episode). */
  subtitle?: string;
  /** Cache context for local file caching. */
  cacheContext?: CacheContext;
  /** Navigation callbacks. */
  onBack?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Toggle system fullscreen. */
  onToggleFullscreen?: () => void;
  /** Whether system fullscreen is active. */
  isFullscreen?: boolean;
  /** Context for saving watch history (progress tracking). */
  historyContext?: HistoryContext;
  /** Start playback from this position (seconds) for resume. */
  startTime?: number;
}

export function TorrentPlayer({
  source,
  videoUrl,
  title,
  subtitle,
  cacheContext,
  onBack,
  onPrev,
  onNext,
  onToggleFullscreen,
  isFullscreen = false,
  historyContext,
  startTime,
}: TorrentPlayerProps) {
  const torrent = useTorrentStream();

  // Direct URL mode: skip torrent pipeline entirely
  const isDirectMode = !!videoUrl;

  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── mpv player (native GPU render below transparent webview) ───

  const player = usePlayer();
  const { loaded, position, duration, paused, volume } = player.state;

  // ── UI state ───────────────────────────────────────────────────

  const [showControls, setShowControls] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(100);
  const [autoNext, setAutoNext] = useState(true);
  const [anime4kMode, setAnime4kMode] = useState("off");

  // ── Apply saved player settings on init ────────────────────────

  useEffect(() => {
    if (!player.state.ready) return;
    let cancelled = false;
    settingsApi.get().then((s) => {
      if (cancelled) return;
      playerApi.setVolume(s.default_volume).catch(() => {});
      playerApi.setSpeed(s.default_speed).catch(() => {});
      playerApi.setHwdec(s.hwdec).catch(() => {});
      playerApi.setBufferSize(s.buffer_size).catch(() => {});
      setAutoNext(s.auto_next);
      setAnime4kMode(s.anime4k_mode);
      if (s.anime4k_mode !== "off") {
        playerApi.setAnime4k(s.anime4k_mode).catch(() => {});
      }
    });
    return () => { cancelled = true; };
  }, [player.state.ready]);

  // ── Auto-start torrent on mount (torrent mode only) ────────────

  useEffect(() => {
    if (!isDirectMode && source) {
      torrent.startStream(source, cacheContext);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, isDirectMode]);

  // ── Sync native GL view position with container ────────────────

  const syncViewport = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      playerApi.setViewport(rect.left, rect.top, rect.width, rect.height).catch(() => {});
    }
  }, []);

  // Continuous sync via ResizeObserver + window resize
  useEffect(() => {
    if (!player.state.ready) return;
    const el = containerRef.current;
    if (!el) return;

    let timerId: ReturnType<typeof setTimeout> | undefined;
    const debouncedSync = () => {
      clearTimeout(timerId);
      timerId = setTimeout(syncViewport, 30);
    };

    syncViewport();
    const ro = new ResizeObserver(debouncedSync);
    ro.observe(el);
    window.addEventListener("resize", debouncedSync);

    return () => {
      clearTimeout(timerId);
      ro.disconnect();
      window.removeEventListener("resize", debouncedSync);
    };
  }, [player.state.ready, syncViewport]);

  // Re-sync when fullscreen changes — macOS animation takes ~500ms
  // and RAFs may be suspended during the space transition.
  useEffect(() => {
    if (!player.state.ready) return;
    syncViewport();
    const t1 = setTimeout(syncViewport, 100);
    const t2 = setTimeout(syncViewport, 350);
    const t3 = setTimeout(syncViewport, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isFullscreen, player.state.ready, syncViewport]);

  // ── Play the streaming URL via mpv when available ──────────────

  const effectiveStreamUrl = isDirectMode ? videoUrl : torrent.streamUrl;

  useEffect(() => {
    if (!player.state.ready || !effectiveStreamUrl) return;
    player.play(effectiveStreamUrl);
  }, [effectiveStreamUrl, player.state.ready, player.play]);

  // ── Auto-advance to next episode when playback ends ────────────

  useEffect(() => {
    player.onEndedRef.current = autoNext && onNext ? onNext : null;
    return () => { player.onEndedRef.current = null; };
  }, [onNext, autoNext, player.onEndedRef]);

  // ── Resume playback from startTime ─────────────────────────────

  const hasResumed = useRef(false);
  useEffect(() => {
    if (!loaded || hasResumed.current || !startTime || startTime <= 0) return;
    hasResumed.current = true;
    player.seek(startTime);
  }, [loaded, startTime, player]);

  // ── Auto-save watch history (every 10s + on unmount) ───────────

  const historyRef = useRef(historyContext);
  historyRef.current = historyContext;
  const posRef = useRef(position);
  posRef.current = position;
  const durRef = useRef(duration);
  durRef.current = duration;

  const saveHistory = useCallback(() => {
    const ctx = historyRef.current;
    const dur = durRef.current;
    const pos = posRef.current;
    if (!ctx || dur <= 0) return;
    historyApi.upsert({
      bgmId: ctx.bgmId,
      episode: ctx.episode,
      animeTitle: ctx.animeTitle,
      episodeTitle: ctx.episodeTitle,
      cover: ctx.cover,
      position: pos,
      duration: dur,
      groupId: ctx.groupId,
      resolution: ctx.resolution,
      subtitle: ctx.subtitle,
    }).catch(console.error);
  }, []);

  // Save periodically while playing + on unmount
  useEffect(() => {
    if (!historyContext || !loaded) return;
    const id = setInterval(saveHistory, 10_000);
    return () => {
      clearInterval(id);
      saveHistory();
    };
  }, [historyContext, loaded, saveHistory]);

  // Also save whenever paused (user interaction) and we have valid data
  useEffect(() => {
    if (paused && loaded && duration > 0 && position > 0 && historyContext) {
      saveHistory();
    }
  }, [paused, loaded, duration, position, historyContext, saveHistory]);

  // ── Auto-hide controls ─────────────────────────────────────────

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    if (!paused) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [paused]);

  useEffect(() => {
    if (paused) {
      setShowControls(true);
      clearTimeout(hideTimerRef.current);
    } else {
      resetHideTimer();
    }
    return () => clearTimeout(hideTimerRef.current);
  }, [paused, resetHideTimer]);

  // ── Controls ───────────────────────────────────────────────────

  const handleTogglePause = useCallback(() => {
    player.togglePause();
  }, [player]);

  const handleSeek = useCallback(
    (seconds: number) => {
      player.seek(seconds);
    },
    [player],
  );

  const handleSetVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(vol)));
      player.setVolume(clamped);
    },
    [player],
  );

  const toggleMute = useCallback(() => {
    if (isMuted) {
      handleSetVolume(prevVolume || 50);
      setIsMuted(false);
    } else {
      setPrevVolume(volume);
      handleSetVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, prevVolume, volume, handleSetVolume]);

  useEffect(() => {
    if (volume > 0 && isMuted) setIsMuted(false);
    if (volume === 0 && !isMuted) setIsMuted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  // ── Keyboard shortcuts ─────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          handleTogglePause();
          resetHideTimer();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handleSeek(Math.max(0, position - 5));
          resetHideTimer();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleSeek(position + 5);
          resetHideTimer();
          break;
        case "ArrowUp":
          e.preventDefault();
          handleSetVolume(Math.min(100, volume + 5));
          resetHideTimer();
          break;
        case "ArrowDown":
          e.preventDefault();
          handleSetVolume(Math.max(0, volume - 5));
          resetHideTimer();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          resetHideTimer();
          break;
        case "f":
          e.preventDefault();
          onToggleFullscreen?.();
          break;
        case "Escape":
          e.preventDefault();
          if (isFullscreen) onToggleFullscreen?.();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleTogglePause,
    handleSeek,
    handleSetVolume,
    toggleMute,
    position,
    volume,
    resetHideTimer,
    onToggleFullscreen,
    isFullscreen,
  ]);

  // ── Derived state ──────────────────────────────────────────────

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const isLoading = isDirectMode
    ? !effectiveStreamUrl
    : torrent.phase !== "streaming" && torrent.phase !== "error";
  const hasError = !isDirectMode && torrent.phase === "error";

  // Detect mid-playback buffering: mpv cache is empty, video is loaded,
  // not paused, and torrent download is still ongoing
  const isBuffering =
    !isDirectMode &&
    loaded &&
    !paused &&
    player.state.buffered < 2 &&
    torrent.stats != null &&
    torrent.stats.progress < 1;

  // ── Touch gestures (mobile) ────────────────────────────────────

  const gestures = usePlayerGestures({
    onToggleControls: () => {
      setShowControls((v) => {
        if (!v) resetHideTimer();
        return !v;
      });
    },
    onTogglePause: handleTogglePause,
    onSeekDelta: (delta) => handleSeek(Math.max(0, position + delta)),
    onResetHideTimer: resetHideTimer,
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={containerRef}
        className={cn(
          "group/player relative flex h-full w-full select-none flex-col",
          !showControls && "cursor-none",
        )}
        onMouseMove={resetHideTimer}
        onMouseLeave={() => {
          if (!paused) setShowControls(false);
        }}
      >
        {/* Click-to-pause zone (desktop) + touch gesture zone (mobile) */}
        {(isDirectMode || torrent.phase === "streaming") && (
          <div
            className="absolute inset-0 z-10"
            onClick={handleTogglePause}
            onTouchStart={gestures.handleTouchStart}
            onTouchMove={gestures.handleTouchMove}
            onTouchEnd={gestures.handleTouchEnd}
          />
        )}

        {/* mpv renders natively below this transparent webview layer */}
        <div className="absolute inset-0 z-0" />

        {/* ── Top bar (fullscreen only) ───────────────────── */}
        {isFullscreen && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-4 px-5 pt-4 pb-12 transition-opacity duration-300",
            "bg-linear-to-b from-black/70 to-transparent",
            showControls ? "opacity-100" : "opacity-0",
          )}
        >
          <button
            type="button"
            onClick={() => {
              if (isFullscreen) onToggleFullscreen?.();
              else onBack?.();
            }}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="pointer-events-auto min-w-0 flex-1">
            {subtitle && (
              <p className="text-xs font-medium text-primary">{subtitle}</p>
            )}
            {title && (
              <h2 className="truncate text-sm font-semibold text-white/90">
                {title}
              </h2>
            )}
          </div>
        </div>
        )}

        {/* ── Center status ───────────────────────────────────── */}
        {isLoading && <LoadingOverlay phase={isDirectMode ? "idle" : torrent.phase} />}
        {hasError && <ErrorOverlay message={torrent.error} onRetry={() => source && torrent.startStream(source)} />}

        {!isDirectMode && torrent.phase === "streaming" && !loaded && torrent.stats && (
          <BufferingOverlay stats={torrent.stats} />
        )}
        {(isDirectMode ? loaded && !paused && player.state.buffered < 2 : torrent.phase === "streaming" && loaded && isBuffering) && (
          <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-black/60 px-5 py-4 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-white/60">缓冲中...</p>
            </div>
          </div>
        )}
        {(isDirectMode || torrent.phase === "streaming") && paused && loaded && showControls && (
          <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/80 text-white shadow-lg shadow-primary/30 backdrop-blur-sm animate-in fade-in zoom-in-50 duration-200">
              <Play size={28} fill="currentColor" className="ml-1" />
            </div>
          </div>
        )}

        {/* ── Torrent stats overlay ───────────────────────────── */}
        {!isDirectMode && torrent.stats && showControls && (
          <TorrentStatsOverlay stats={torrent.stats} />
        )}

        {/* ── Bottom controls ─────────────────────────────────── */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 flex flex-col transition-opacity duration-300",
            "bg-linear-to-t from-black/80 via-black/40 to-transparent pt-16",
            showControls ? "opacity-100" : "opacity-0",
          )}
        >
          {/* Seek bar */}
          <SeekBar
            position={position}
            duration={duration}
            progress={progress}
            bufferProgress={!isDirectMode && torrent.stats && torrent.stats.progress < 1 ? torrent.stats.progress * 100 : undefined}
            onSeek={handleSeek}
            onInteracting={resetHideTimer}
          />

          {/* Control buttons */}
          <div className="pointer-events-auto flex items-center gap-1 px-4 pb-4 pt-1">
            {/* Left group */}
            <div className="flex items-center gap-0.5">
              {onPrev && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={onPrev}
                    >
                      <SkipBack size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>上一集</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePause();
                    }}
                  >
                    {paused ? (
                      <Play size={22} fill="currentColor" />
                    ) : (
                      <Pause size={22} fill="currentColor" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{paused ? "播放" : "暂停"}</TooltipContent>
              </Tooltip>

              {onNext && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={onNext}
                    >
                      <SkipForward size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>下一集</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Time display */}
            <span className="ml-2 text-xs tabular-nums text-white/70">
              {formatTime(position)}
              <span className="mx-1 text-white/30">/</span>
              {formatTime(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Right group */}
            <div className="flex items-center gap-0.5">
              {/* Volume */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMute();
                    }}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX size={18} />
                    ) : (
                      <Volume2 size={18} />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isMuted ? "取消静音" : "静音"}
                </TooltipContent>
              </Tooltip>

              {/* Super-resolution (Anime4K) */}
              <Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "hover:bg-white/10 hover:text-white",
                          anime4kMode !== "off" ? "text-primary" : "text-white/70",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Sparkles size={18} />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>超分辨率</TooltipContent>
                </Tooltip>
                <PopoverContent
                  side="top"
                  align="center"
                  className="w-auto border-white/10 bg-black/90 p-1.5 backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-col gap-0.5">
                    <p className="px-2 py-1 text-[10px] font-medium tracking-wider text-white/40 uppercase">超分辨率</p>
                    <p className="px-2 pb-1 text-[10px] text-white/30 md:hidden">移动端已自动使用轻量级着色器</p>
                    {(["off", "A", "B", "C"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={cn(
                          "rounded-md px-3 py-1.5 text-left text-xs transition-colors",
                          anime4kMode === mode
                            ? "bg-primary/20 text-primary"
                            : "text-white/70 hover:bg-white/10 hover:text-white",
                        )}
                        onClick={async () => {
                          if (mode === "off") {
                            await playerApi.clearAnime4k().catch(() => {});
                          } else {
                            await playerApi.setAnime4k(mode).catch(() => {});
                          }
                          setAnime4kMode(mode);
                          settingsApi.setAnime4kMode(mode).catch(() => {});
                        }}
                      >
                        {mode === "off" ? "关闭" : `模式 ${mode}`}
                        <span className="ml-2 text-[10px] text-white/30">
                          {mode === "off" && "原始画质"}
                          {mode === "A" && "适合 1080p"}
                          {mode === "B" && "适合 720p"}
                          {mode === "C" && "适合 480p"}
                        </span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* System fullscreen */}
              {onToggleFullscreen && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFullscreen();
                      }}
                    >
                      {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFullscreen ? "退出全屏" : "全屏"}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ================================================================== */
/*  Loading overlay                                                    */
/* ================================================================== */

function LoadingOverlay({ phase }: { phase: TorrentStreamPhase }) {
  const messages: Record<string, string> = {
    idle: "准备中...",
    adding: "正在解析种子元数据...",
    selecting: "正在选择视频文件...",
  };

  return (
    <div className="absolute inset-0 z-15 flex flex-col items-center justify-center gap-4 bg-black">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm text-white/70">{messages[phase] ?? "加载中..."}</p>
    </div>
  );
}

/* ================================================================== */
/*  Buffering overlay (streaming started but data not arriving)        */
/* ================================================================== */

function BufferingOverlay({
  stats,
}: {
  stats: {
    progress: number;
    download_speed: number;
    peers: number;
  };
}) {
  const noPeers = stats.peers === 0;
  const slow = stats.download_speed < 1024 && !noPeers; // < 1 KB/s

  return (
    <div className="absolute inset-0 z-15 flex flex-col items-center justify-center gap-3 bg-black">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm text-white/70">正在缓冲...</p>
      {noPeers && (
        <div className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-3 py-1.5 backdrop-blur-sm">
          <AlertTriangle size={14} className="text-yellow-400" />
          <span className="text-xs text-yellow-300/80">
            当前无可用 Peer，正在搜索节点...
          </span>
        </div>
      )}
      {slow && (
        <div className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-3 py-1.5 backdrop-blur-sm">
          <AlertTriangle size={14} className="text-yellow-400" />
          <span className="text-xs text-yellow-300/80">
            下载速度过慢 ({stats.peers} peers)
          </span>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Error overlay                                                      */
/* ================================================================== */

function ErrorOverlay({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  // Map backend error patterns to user-friendly messages
  const displayMessage = (() => {
    if (!message) return null;
    if (message.includes("timed out")) return "种子元数据解析超时，可能没有可用的 Peer";
    if (message.includes("metadata resolution failed")) return "种子元数据解析失败";
    if (message.includes("No video file")) return "种子中未找到视频文件";
    return message;
  })();

  return (
    <div className="absolute inset-0 z-15 flex flex-col items-center justify-center gap-4 bg-black px-8">
      <div className="rounded-lg bg-red-500/10 px-6 py-4 text-center backdrop-blur-sm">
        <p className="text-sm font-medium text-red-400">播放出错</p>
        {displayMessage && (
          <p className="mt-1 text-xs text-white/50">{displayMessage}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 border-white/20 text-white/70 hover:bg-white/10"
          onClick={onRetry}
        >
          重试
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Torrent stats overlay                                              */
/* ================================================================== */

function TorrentStatsOverlay({
  stats,
}: {
  stats: {
    progress: number;
    download_speed: number;
    upload_speed: number;
    downloaded_bytes: number;
    total_bytes: number;
    peers: number;
  };
}) {
  const progressPct = (stats.progress * 100).toFixed(1);
  const isComplete = stats.progress >= 1;

  if (isComplete) return null;

  return (
    <div className="pointer-events-none absolute right-4 bottom-20 z-20 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
      <div className="flex flex-col gap-1 text-xs tabular-nums text-white/60">
        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <HardDrive size={12} className="text-primary" />
          <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, stats.progress * 100)}%` }}
            />
          </div>
          <span>{progressPct}%</span>
        </div>

        {/* Download / Upload speed */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Download size={10} className="text-green-400" />
            {formatSpeed(stats.download_speed)}
          </span>
          <span className="flex items-center gap-1">
            <Upload size={10} className="text-blue-400" />
            {formatSpeed(stats.upload_speed)}
          </span>
        </div>

        {/* Size + Peers */}
        <div className="flex items-center gap-3">
          <span>
            {formatBytes(stats.downloaded_bytes)} / {formatBytes(stats.total_bytes)}
          </span>
          <span className="flex items-center gap-1">
            <Users size={10} />
            {stats.peers} peers
          </span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Seek Bar (simplified, mpv-driven)                                  */
/* ================================================================== */

function SeekBar({
  position: _position,
  duration,
  progress,
  bufferProgress,
  onSeek,
  onInteracting,
}: {
  position: number;
  duration: number;
  progress: number;
  /** Torrent download progress 0-100, shown as buffer bar. */
  bufferProgress?: number;
  onSeek: (seconds: number) => void;
  onInteracting: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragProgress, setDragProgress] = useState(0);

  const getProgressFromX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100),
    );
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsDragging(true);
      const p = getProgressFromX(e.clientX);
      setDragProgress(p);
      onInteracting();
    },
    [getProgressFromX, onInteracting],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      if (!touch) return;
      setIsDragging(true);
      const p = getProgressFromX(touch.clientX);
      setDragProgress(p);
      onInteracting();
    },
    [getProgressFromX, onInteracting],
  );

  useEffect(() => {
    if (!isDragging) return;

    function onMouseMove(e: globalThis.MouseEvent) {
      const p = getProgressFromX(e.clientX);
      setDragProgress(p);
    }

    function onMouseUp(e: globalThis.MouseEvent) {
      const p = getProgressFromX(e.clientX);
      onSeek((p / 100) * duration);
      setIsDragging(false);
    }

    function onTouchMove(e: globalThis.TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      const p = getProgressFromX(touch.clientX);
      setDragProgress(p);
    }

    function onTouchEnd(e: globalThis.TouchEvent) {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const p = getProgressFromX(touch.clientX);
      onSeek((p / 100) * duration);
      setIsDragging(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDragging, duration, getProgressFromX, onSeek]);

  const displayProgress = isDragging ? dragProgress : progress;
  const hoverProgress = hoverX !== null ? getProgressFromX(hoverX) : null;
  const hoverTime =
    hoverProgress !== null ? (hoverProgress / 100) * duration : null;

  return (
    <div
      className="pointer-events-auto group/seek relative px-4"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onMouseMove={(e) => {
        setHoverX(e.clientX);
        onInteracting();
      }}
      onMouseLeave={() => setHoverX(null)}
    >
      {/* Hover time tooltip */}
      {hoverTime !== null && !isDragging && (
        <div
          className="absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs tabular-nums text-white backdrop-blur-sm"
          style={{
            left: `calc(${hoverProgress}% + 16px - ${hoverProgress! * 0.32}px)`,
          }}
        >
          {formatTime(hoverTime)}
        </div>
      )}

      <div
        ref={trackRef}
        className={cn(
          "relative h-1 w-full cursor-pointer rounded-full bg-white/15 transition-[height] duration-150",
          (isDragging || hoverX !== null) && "h-1.5",
        )}
      >
        {/* Buffer (torrent download progress) */}
        {bufferProgress !== undefined && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/25 transition-all duration-500"
            style={{ width: `${bufferProgress}%` }}
          />
        )}
        {/* Progress */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${displayProgress}%` }}
        />
        {/* Thumb — always visible on mobile, hover on desktop */}
        <div
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md transition-[width,height,opacity] duration-150",
            isDragging
              ? "h-4 w-4 opacity-100"
              : "h-3 w-3 opacity-100 md:opacity-0 md:group-hover/seek:opacity-100",
          )}
          style={{ left: `${displayProgress}%` }}
        />
      </div>
    </div>
  );
}
