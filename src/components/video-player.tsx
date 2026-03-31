/**
 * Video player component — full-screen player with HTML5 &lt;video&gt; backend.
 *
 * All playback state is derived from the native &lt;video&gt; element events.
 * Controls are rendered as an overlay on top of the video.
 *
 * Layout:
 * ┌──────────────────────────────────────────┐
 * │  Top bar (back, title, episode info)     │
 * │                                          │
 * │            &lt;video&gt; element               │
 * │                                          │
 * │  Bottom controls:                        │
 * │    - Seek bar (progress + buffer)        │
 * │    - Play/Pause, Prev/Next, Volume,      │
 * │      Speed, Fullscreen                   │
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
import { cn } from "@/lib/utils";
import { usePlayerGestures } from "@/hooks/use-player-gestures";
import {
  ArrowLeft,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

// ── Time formatting ──────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Speed options ────────────────────────────────────────────────

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

// ── Types ────────────────────────────────────────────────────────

export interface VideoPlayerProps {
  /** Media URL to play */
  url: string;
  /** Current episode title to display in the top bar */
  title?: string;
  /** Episode subtitle (e.g. "第 3 话") */
  subtitle?: string;
  /** Navigation callbacks */
  onBack?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export function VideoPlayer({
  url,
  title,
  subtitle,
  onBack,
  onPrev,
  onNext,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Playback state (driven by <video> element events) ──────────

  const [loaded, setLoaded] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [volume, setVolumeState] = useState(100);
  const [speed, setSpeedState] = useState(1);
  const [buffered, setBuffered] = useState(0);
  const [seeking, setSeeking] = useState(false);

  // ── UI state ───────────────────────────────────────────────────

  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(100);

  // ── Wire <video> element events to React state ─────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => setPosition(v.currentTime);
    const onDurationChange = () => {
      if (isFinite(v.duration)) setDuration(v.duration);
    };
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onSeeking = () => setSeeking(true);
    const onSeeked = () => setSeeking(false);
    const onLoadedData = () => setLoaded(true);
    const onWaiting = () => setSeeking(true);
    const onCanPlay = () => setSeeking(false);
    const onProgress = () => {
      if (v.buffered.length > 0) {
        const end = v.buffered.end(v.buffered.length - 1);
        setBuffered(Math.max(0, end - v.currentTime));
      }
    };
    const onVolumeChange = () => setVolumeState(Math.round(v.volume * 100));
    const onRateChange = () => setSpeedState(v.playbackRate);

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDurationChange);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadeddata", onLoadedData);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("progress", onProgress);
    v.addEventListener("volumechange", onVolumeChange);
    v.addEventListener("ratechange", onRateChange);

    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDurationChange);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("loadeddata", onLoadedData);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("progress", onProgress);
      v.removeEventListener("volumechange", onVolumeChange);
      v.removeEventListener("ratechange", onRateChange);
    };
  }, []);

  // ── Load & autoplay when URL changes ───────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;
    setLoaded(false);
    setPosition(0);
    setDuration(0);
    v.src = url;
    v.play().catch(() => {});
  }, [url]);

  // ── Playback control handlers ──────────────────────────────────

  const handleTogglePause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
  }, []);

  const handleSetVolume = useCallback((vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(100, Math.round(vol)));
    v.volume = clamped / 100;
  }, []);

  const handleSetSpeed = useCallback((s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = s;
  }, []);

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

  // ── Keyboard shortcuts ─────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
          handleSeek(Math.min(duration, position + 5));
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
          toggleFullscreen();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleTogglePause, handleSeek, handleSetVolume, position, duration, volume, resetHideTimer]);

  // ── Fullscreen ─────────────────────────────────────────────────

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch { /* ignored */ }
  }, []);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Mute ───────────────────────────────────────────────────────

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
  }, [volume]);

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const bufferProgress = duration > 0 ? ((position + buffered) / duration) * 100 : 0;

  // ── Touch gestures (mobile) ────────────────────────────────────

  const gestures = usePlayerGestures({
    onToggleControls: () => {
      setShowControls((v) => {
        if (!v) resetHideTimer();
        return !v;
      });
    },
    onTogglePause: handleTogglePause,
    onSeekDelta: (delta) => handleSeek(Math.max(0, Math.min(duration, position + delta))),
    onResetHideTimer: resetHideTimer,
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={containerRef}
        className={cn(
          "group/player relative flex h-full w-full select-none flex-col bg-black",
          !showControls && "cursor-none",
        )}
        onMouseMove={resetHideTimer}
        onMouseLeave={() => { if (!paused) setShowControls(false); }}
        onDoubleClick={toggleFullscreen}
      >
        {/* ── HTML5 Video element ─────────────────────────────── */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          preload="auto"
        />

        {/* Click-to-pause zone (desktop) + touch gestures (mobile) */}
        <div
          className="absolute inset-0 z-10"
          onClick={handleTogglePause}
          onTouchStart={gestures.handleTouchStart}
          onTouchMove={gestures.handleTouchMove}
          onTouchEnd={gestures.handleTouchEnd}
        />

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

        {/* ── Loading indicator ────────────────────────────────── */}
        {seeking && (
          <div className="absolute inset-0 z-15 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-primary" />
          </div>
        )}

        {/* ── Big play button (when paused & controls shown) ──── */}
        {paused && loaded && showControls && (
          <div className="absolute inset-0 z-15 flex items-center justify-center pointer-events-none">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/80 text-white shadow-lg shadow-primary/30 backdrop-blur-sm animate-in fade-in zoom-in-50 duration-200">
              <Play size={28} fill="currentColor" className="ml-1" />
            </div>
          </div>
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
            bufferProgress={bufferProgress}
            onSeek={handleSeek}
            onInteracting={resetHideTimer}
          />

          {/* Control buttons */}
          <div className="pointer-events-auto flex items-center gap-1 px-4 pb-4 pt-1">
            {/* Left group: play controls */}
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
                    onClick={(e) => { e.stopPropagation(); handleTogglePause(); }}
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
              <VolumeControl
                volume={volume}
                isMuted={isMuted}
                onToggleMute={toggleMute}
                onSetVolume={handleSetVolume}
              />

              {/* Speed */}
              <SpeedControl speed={speed} onSetSpeed={handleSetSpeed} />

              {/* Fullscreen */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                  >
                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isFullscreen ? "退出全屏" : "全屏"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ================================================================== */
/*  Seek Bar                                                           */
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
  bufferProgress: number;
  onSeek: (seconds: number) => void;
  onInteracting: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragProgress, setDragProgress] = useState(0);

  const getProgressFromX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
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
  const hoverTime = hoverProgress !== null ? (hoverProgress / 100) * duration : null;

  return (
    <div
      className="pointer-events-auto group/seek relative px-4"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onMouseMove={(e) => { setHoverX(e.clientX); onInteracting(); }}
      onMouseLeave={() => setHoverX(null)}
    >
      {/* Hover time tooltip */}
      {hoverTime !== null && !isDragging && (
        <div
          className="absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs tabular-nums text-white backdrop-blur-sm"
          style={{ left: `calc(${hoverProgress}% + 16px - ${hoverProgress! * 0.32}px)` }}
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
        {/* Buffer */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/20"
          style={{ width: `${Math.min(100, bufferProgress)}%` }}
        />
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

/* ================================================================== */
/*  Volume Control                                                     */
/* ================================================================== */

function VolumeControl({
  volume,
  isMuted,
  onToggleMute,
  onSetVolume,
}: {
  volume: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onSetVolume: (v: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="group/vol relative flex items-center"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white/70 hover:bg-white/10 hover:text-white"
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          >
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isMuted ? "取消静音" : "静音"}</TooltipContent>
      </Tooltip>

      {/* Inline slider that appears on hover */}
      <div
        className={cn(
          "flex items-center overflow-hidden transition-all duration-200",
          isOpen ? "w-24 opacity-100 ml-1" : "w-0 opacity-0",
        )}
      >
        <VolumeSlider value={volume} onChange={onSetVolume} />
        <span className="ml-2 min-w-[2ch] text-xs tabular-nums text-white/50">
          {Math.round(volume)}
        </span>
      </div>
    </div>
  );
}

function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getVal = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsDragging(true);
      onChange(getVal(e.clientX));
    },
    [getVal, onChange],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      if (!touch) return;
      setIsDragging(true);
      onChange(getVal(touch.clientX));
    },
    [getVal, onChange],
  );

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: globalThis.MouseEvent) {
      onChange(getVal(e.clientX));
    }
    function onUp() {
      setIsDragging(false);
    }
    function onTouchMove(e: globalThis.TouchEvent) {
      const touch = e.touches[0];
      if (touch) onChange(getVal(touch.clientX));
    }
    function onTouchEnd() {
      setIsDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDragging, getVal, onChange]);

  return (
    <div
      ref={trackRef}
      className="relative h-1 w-full cursor-pointer rounded-full bg-white/15"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-white/70"
        style={{ width: `${value}%` }}
      />
      <div
        className={cn(
          "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-opacity",
          isDragging ? "opacity-100" : "opacity-0 group-hover/vol:opacity-100",
        )}
        style={{ left: `${value}%` }}
      />
    </div>
  );
}

/* ================================================================== */
/*  Speed Control                                                      */
/* ================================================================== */

function SpeedControl({
  speed,
  onSetSpeed,
}: {
  speed: number;
  onSetSpeed: (s: number) => void;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "text-white/70 hover:bg-white/10 hover:text-white",
                speed !== 1 && "text-primary",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <Gauge size={18} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>倍速 ({speed}x)</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={12}
        className="w-auto border-white/10 bg-black/90 p-2 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-0.5">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSetSpeed(s)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm tabular-nums transition-colors",
                s === speed
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
