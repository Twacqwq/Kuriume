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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, formatSpeed } from "@/lib/torrent";
import { usePlayer } from "@/lib/use-player";
import { useTorrentStream, type TorrentStreamPhase, type CacheContext } from "@/lib/use-torrent-stream";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  HardDrive,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
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

export interface TorrentPlayerProps {
  /** Magnet URI or .torrent URL. */
  source: string;
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
}

export function TorrentPlayer({
  source,
  title,
  subtitle,
  cacheContext,
  onBack,
  onPrev,
  onNext,
}: TorrentPlayerProps) {
  const torrent = useTorrentStream();

  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── mpv player (native GPU render below transparent webview) ───

  const player = usePlayer();
  const { loaded, position, duration, paused, volume } = player.state;

  // ── UI state ───────────────────────────────────────────────────

  const [showControls, setShowControls] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(100);

  // ── Auto-start torrent on mount ────────────────────────────────

  useEffect(() => {
    if (source) {
      torrent.startStream(source, cacheContext);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // ── Play the streaming URL via mpv when available ──────────────

  useEffect(() => {
    if (!player.state.ready || !torrent.streamUrl) return;
    player.play(torrent.streamUrl);
  }, [torrent.streamUrl, player.state.ready, player.play]);

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
  ]);

  // ── Derived state ──────────────────────────────────────────────

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const isLoading = torrent.phase !== "streaming" && torrent.phase !== "error";
  const hasError = torrent.phase === "error";

  // Detect mid-playback buffering: mpv cache is empty, video is loaded,
  // not paused, and torrent download is still ongoing
  const isBuffering =
    loaded &&
    !paused &&
    player.state.buffered < 2 &&
    torrent.stats != null &&
    torrent.stats.progress < 1;

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
        {/* Click-to-pause zone (only when streaming) */}
        {torrent.phase === "streaming" && (
          <div
            className="absolute inset-0 z-10"
            onClick={handleTogglePause}
          />
        )}

        {/* mpv renders natively below this transparent webview layer */}
        <div className="absolute inset-0 z-0" />

        {/* ── Top bar ─────────────────────────────────────────── */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-4 px-5 pt-4 pb-12 transition-opacity duration-300",
            "bg-linear-to-b from-black/70 to-transparent",
            showControls ? "opacity-100" : "opacity-0",
          )}
        >
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              <ArrowLeft size={18} />
            </button>
          )}
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

        {/* ── Center status ───────────────────────────────────── */}
        {isLoading && <LoadingOverlay phase={torrent.phase} />}
        {hasError && <ErrorOverlay message={torrent.error} onRetry={() => torrent.startStream(source)} />}

        {torrent.phase === "streaming" && !loaded && torrent.stats && (
          <BufferingOverlay stats={torrent.stats} />
        )}
        {torrent.phase === "streaming" && loaded && isBuffering && (
          <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-black/60 px-5 py-4 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-white/60">缓冲中...</p>
            </div>
          </div>
        )}
        {torrent.phase === "streaming" && paused && loaded && showControls && (
          <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/80 text-white shadow-lg shadow-primary/30 backdrop-blur-sm animate-in fade-in zoom-in-50 duration-200">
              <Play size={28} fill="currentColor" className="ml-1" />
            </div>
          </div>
        )}

        {/* ── Torrent stats overlay ───────────────────────────── */}
        {torrent.stats && showControls && (
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
  onSeek,
  onInteracting,
}: {
  position: number;
  duration: number;
  progress: number;
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

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
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
        {/* Progress */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${displayProgress}%` }}
        />
        {/* Thumb */}
        <div
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md transition-[width,height,opacity] duration-150",
            isDragging
              ? "h-4 w-4 opacity-100"
              : "h-3 w-3 opacity-0 group-hover/seek:opacity-100",
          )}
          style={{ left: `${displayProgress}%` }}
        />
      </div>
    </div>
  );
}
