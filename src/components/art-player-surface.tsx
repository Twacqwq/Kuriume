import type { DirectMediaAsset, PlaybackSubtitle } from "@/lib/playback";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { usePlayerGestures, type GestureOptions } from "@/hooks/use-player-gestures";
import { isMobileApp } from "@/lib/platform";
import { subtitleLanguage } from "@/lib/playback-selection";
import type { usePlayerFullscreen } from "@/hooks/use-player-fullscreen";
import Artplayer from "artplayer";
import type Hls from "hls.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { playerIcons } from "@/components/art-player-icons";
import { bindPlayerAccessibility } from "@/components/art-player-accessibility";
import { bindTouchProgress } from "@/components/art-player-progress";
import { bindDanmaku, type DanmakuController } from "@/components/art-player-danmaku";
import { toggleDanmaku } from "@/components/danmaku-settings";
import { DANMAKU_GLYPH_SVG, DANMAKU_SETTINGS_SVG } from "@/components/danmaku-icons";
import type { DanmakuView } from "@/hooks/use-danmaku";
import { bindAnime4K, readAnime4KPreference, writeAnime4KPreference, type Anime4KController, type Anime4KPath } from "@/components/art-player-anime4k";
import { unreadableVideo } from "@/lib/anime4k/paths";
import { anime4kSupported } from "@/lib/anime4k/support";
import { readAnime4KMode, subscribeAnime4KMode, writeAnime4KMode, type Anime4KMode } from "@/lib/anime4k/mode";
import type { Anime4KEvent } from "@/lib/anime4k/renderer";
import { PLAYBACK_RATES, PlayerChrome, type PlayerEpisode, type PlayerNext, type PlayerSheet } from "@/components/player-chrome";
import "@/components/art-player-skin.css";
import { diagnose, diagnosticMessage, type DiagnosticCode } from "@/lib/diagnostics";
import { themePrimary } from "@/lib/theme";
import { isProxiedMedia } from "@/lib/media-url";

// Fullscreen belongs to the desktop page, including the double-click shortcut.
Artplayer.DBCLICK_FULLSCREEN = false;
Artplayer.SETTING_ITEM_HEIGHT = 48;
// A speed picked in the player carries over to the next episode of this session.
let sessionRate: number | undefined;
// Sparkles (lucide), for the Anime4K mode in the player's settings.
const ANIME4K_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
const NEXT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/></svg>';

export interface ArtPlayerSurfaceProps {
  asset: DirectMediaAsset;
  subtitle?: PlaybackSubtitle;
  onSubtitleError?: (failed: boolean) => void;
  fullscreen: ReturnType<typeof usePlayerFullscreen>;
  poster?: string | null;
  startTime?: number;
  autoPlay?: boolean;
  defaultVolume?: number;
  defaultSpeed?: number;
  onEnded?: () => void;
  onProgress?: (position: number, duration: number) => void;
  onPlaying?: () => void;
  onError?: (message: string) => void;
  /** "第 3 话": the fullscreen top bar replaces the page header. */
  title?: string;
  mediaTitle?: string;
  next?: PlayerNext | null;
  autoNext?: boolean;
  episodes?: PlayerEpisode[];
  currentEpisode?: number;
  onSelectEpisode?: (episode: number) => void;
  /** Source/server pickers shown in the fullscreen sheet. */
  options?: React.ReactNode;
  /** Inline player: open the page's own source picker instead of a cramped sheet. */
  onOpenOptions?: () => void;
  /** Start position restored from history; shows the "resumed" prompt. */
  resumeFrom?: number;
  /** 弹弹play danmaku for this episode; absent in builds without it. */
  danmaku?: DanmakuView;
  /** The page shows the danmaku controls under the video while not fullscreen. */
  danmakuBelow?: boolean;
}

export function ArtPlayerSurface({
  asset,
  subtitle,
  onSubtitleError,
  fullscreen,
  poster,
  startTime = 0,
  autoPlay = true,
  defaultVolume = 0.8,
  defaultSpeed = 1,
  onEnded,
  onProgress,
  onPlaying,
  onError,
  title,
  mediaTitle,
  next,
  autoNext,
  episodes,
  currentEpisode,
  onSelectEpisode,
  options,
  onOpenOptions,
  resumeFrom,
  danmaku,
  danmakuBelow = false,
}: ArtPlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const language = useDisplayLanguage();
  const [gesturePlayer, setGesturePlayer] = useState<Artplayer | null>(null);
  const [sheet, setSheet] = useState<PlayerSheet | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockFlash, setLockFlash] = useState(0);
  const isFullscreen = fullscreen.mode !== "normal";
  const gestureOptions = useRef<GestureOptions>({});
  gestureOptions.current = { levels: isFullscreen, locked, onLockedTap: () => setLockFlash(Date.now()) };
  const gesture = usePlayerGestures(gesturePlayer, language, gestureOptions);
  // Anime4K: the preference persists per device; support is probed once.
  const [anime4k, setAnime4k] = useState(readAnime4KPreference);
  const [anime4kSupport, setAnime4kSupport] = useState<"unknown" | "yes" | "no">("unknown");
  const anime4kRef = useRef<Anime4KController | null>(null);
  const toggleAnime4K = () => {
    const art = artRef.current;
    const zh = language === "zh";
    if (anime4kSupport === "no") {
      if (art) art.notice.show = zh ? "当前设备不支持 Anime4K" : "Anime4K is not supported on this device";
      return;
    }
    const next = !anime4k;
    setAnime4k(next);
    writeAnime4KPreference(next);
    if (art && !next) art.notice.show = zh ? "Anime4K 已关闭" : "Anime4K off";
  };
  const onAnime4KEvent = (event: Anime4KEvent | { type: "started"; path: Anime4KPath }) => {
    const art = artRef.current;
    const zh = language === "zh";
    if (!art) return;
    if (event.type === "started") {
      // WebGL2 (older macOS/iOS) runs the lighter networks only.
      art.notice.show = event.path === "webgl2"
        ? (zh ? "Anime4K 已开启（兼容模式）" : "Anime4K on (compatibility mode)")
        : (zh ? "Anime4K 已开启" : "Anime4K on");
    } else if (event.type === "slow" && event.quality === "hq") {
      art.notice.show = zh ? "Anime4K 已切换为流畅模式" : "Anime4K switched to fast mode";
    } else {
      // Off for this session only; the saved preference stays as chosen.
      setAnime4k(false);
      art.notice.show = event.type === "slow"
        ? (zh ? "设备性能不足，已暂停 Anime4K" : "Anime4K paused: this device can't keep up")
        : event.type === "error" && unreadableVideo(event.message)
          ? (zh ? "这个线路不支持 Anime4K，可换个线路试试" : "Anime4K can't read this line's video; try another line")
          : (zh ? "Anime4K 启动失败，已关闭" : "Anime4K could not start");
      if (event.type === "error") {
        // Recorded for 日志与诊断: which path failed and the WebView's reason.
        console.warn("[anime4k]", event.message);
        diagnose("player_error", "warn", { operation: asset.diagnosticId, code: "unsupported", message: `Anime4K: ${event.message}` });
      }
    }
  };
  const danmakuRef = useRef<DanmakuController | null>(null);
  const danmakuAvailable = Boolean(danmaku && danmaku.status !== "unavailable");
  const toggleDanmakuShown = () => {
    const art = artRef.current;
    if (!danmaku || !danmakuAvailable) return;
    const zh = language === "zh";
    toggleDanmaku(danmaku);
    if (art) art.notice.show = danmaku.prefs.enabled ? (zh ? "弹幕已关闭" : "Danmaku off") : (zh ? "弹幕已开启" : "Danmaku on");
  };
  const anime4kOn = () => anime4k && anime4kSupport === "yes";
  const actionsRef = useRef({ setSheet, next, toggleAnime4K, onAnime4KEvent, toggleDanmakuShown, anime4kOn });
  actionsRef.current = { setSheet, next, toggleAnime4K, onAnime4KEvent, toggleDanmakuShown, anime4kOn };
  const callbacksRef = useRef({ onEnded, onProgress, onError, onPlaying, onSubtitleError });
  callbacksRef.current = { onEnded, onProgress, onError, onPlaying, onSubtitleError };
  const initialOptionsRef = useRef({ poster, startTime, autoPlay, defaultVolume, defaultSpeed, language });
  initialOptionsRef.current = { poster, startTime, autoPlay, defaultVolume, defaultSpeed, language };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // History and preference refreshes must not destroy an active video session.
    const { poster, startTime, autoPlay, defaultVolume, defaultSpeed, language } = initialOptionsRef.current;

    let hls: Hls | null = null;
    let disposed = false;
    const started = performance.now();
    const operation = asset.diagnosticId;
    let firstPlay = true;
    let waitingSince: number | undefined;
    let waitingTimer: ReturnType<typeof setTimeout> | undefined;
    const mediaType =
      asset.mimeType === "application/x-mpegURL" ||
      asset.mimeType === "application/vnd.apple.mpegurl" ||
      asset.url.toLowerCase().split(/[?#]/, 1)[0]?.endsWith(".m3u8")
        ? "m3u8"
        : undefined;

    const controlButton = (icon: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kuriume-player-button";
      button.innerHTML = icon;
      return button;
    };
    const art = new Artplayer({
      container,
      url: asset.url,
      ...(mediaType ? { type: mediaType } : {}),
      ...(poster ? { poster } : {}),
      // The played bar follows the app theme in effect when the player opens.
      theme: themePrimary(),
      icons: playerIcons,
      cssVar: { "--art-control-opacity": 1, "--art-control-icon-scale": 1 },
      lang: language === "zh" ? "zh-cn" : "en",
      autoplay: autoPlay,
      // Mobile gestures operate the device volume; do not attenuate it again.
      volume: isMobileApp ? 1 : defaultVolume,
      mutex: true,
      playsInline: true,
      hotkey: true,
      pip: false,
      fullscreen: false,
      fullscreenWeb: false,
      controls: [
        ...(isMobileApp ? ["system"] as const : ["app", "system"] as const).map((mode) => {
          const button = controlButton(mode === "app" ? playerIcons.fullscreenWebOn : playerIcons.fullscreenOn);
          return {
            name: `kuriume-${mode}-fullscreen`,
            position: "right" as const,
            index: mode === "app" ? 60 : 70,
            html: button,
            mounted(this: Artplayer) {
              this.proxy(button, "click", () => fullscreenRef.current.toggle(mode));
            },
          };
        }),
        ...([
          ["next", "left", 15, NEXT_ICON, () => actionsRef.current.next?.onPlay()],
          // Danmaku sit with the playback controls on the left, after the time:
          // the right side keeps picture and navigation (Anime4K, speed, episodes).
          ["danmaku", "left", 40, "", () => actionsRef.current.toggleDanmakuShown()],
          ["danmaku-settings", "left", 41, "", () => actionsRef.current.setSheet("danmaku")],
          ["anime4k", "right", 35, "", () => actionsRef.current.toggleAnime4K()],
          ["speed", "right", 40, "", () => actionsRef.current.setSheet("speed")],
          ["episodes", "right", 45, "", () => actionsRef.current.setSheet("episodes")],
        ] as const).map(([name, position, index, icon, action]) => {
          const button = controlButton(icon);
          if (name === "danmaku") {
            button.className += " kuriume-danmaku-toggle";
            button.innerHTML = `<span class="kuriume-danmaku-switch" aria-hidden="true"><span class="kuriume-danmaku-knob">${DANMAKU_GLYPH_SVG}</span></span>`;
          } else if (name === "danmaku-settings") {
            button.className += " kuriume-danmaku-settings";
            button.innerHTML = DANMAKU_SETTINGS_SVG;
          } else if (name === "anime4k") {
            button.className += " kuriume-anime4k-toggle";
            button.innerHTML = '<span class="kuriume-anime4k-badge" aria-hidden="true"><span class="kuriume-anime4k-word">Anime</span><span class="kuriume-anime4k-mark">4K</span></span>';
          } else if (!icon) button.className += " kuriume-player-text-button";
          return {
            name: `kuriume-${name}`,
            position,
            index,
            html: button,
            mounted(this: Artplayer) {
              this.proxy(button, "click", action);
            },
          };
        }),
      ],
      // Speed lives in Kuriume's own sheet; desktop keeps the gear for aspect ratio.
      playbackRate: false,
      aspectRatio: !isMobileApp,
      screenshot: false,
      // Desktop: aspect ratio and the Anime4K mode. Phones: the Anime4K mode,
      // in fullscreen only (the inline gear is hidden by the skin).
      setting: true,
      backdrop: false,
      gesture: false,
      fastForward: false,
      lock: false,
      moreVideoAttr: {
        // CORS mode only for media served by Kuriume's proxy, which sends the
        // headers (Anime4K needs them to read frames). A third-party CDN
        // rarely does, and in CORS mode the WebView then refuses the file
        // outright ("Media error 4") instead of just playing it.
        ...(isProxiedMedia(asset.url) ? { crossOrigin: "anonymous" as const } : {}),
        preload: "auto",
      },
      customType: {
        async m3u8(video, url) {
          // ArtPlayer calls this a tick after construction, possibly after
          // this player was already torn down.
          if (disposed) return;
          const proxied = url.startsWith("kuriume-media:") || url.startsWith("http://kuriume-media.localhost/");
          // Hls.js wherever the WebView has MediaSource: it loads the stream
          // over CORS, so Anime4K can read the frames, where a natively played
          // stream from another origin leaves them unreadable. Native HLS is
          // the fallback, never for Tauri's custom scheme (AVFoundation cannot
          // request it).
          try {
            const Hls = (await import("hls.js")).default;
            if (disposed) return;
            if (!Hls.isSupported() && !proxied && video.canPlayType("application/vnd.apple.mpegurl")) {
              diagnose("player_load", "info", { operation, engine: "native_hls", code: "start" });
              video.src = url;
              return;
            }
            if (!Hls.isSupported()) {
              diagnose("player_error", "error", { operation, code: "unsupported", engine: "hlsjs", message: "Hls.isSupported() returned false: WebView lacks the required MediaSource support" });
              callbacksRef.current.onError?.("当前 WebView 不支持 HLS 播放");
              return;
            }
            hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            diagnose("player_load", "info", { operation, engine: "hlsjs", code: "start" });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              const detail = data.details.toLowerCase();
              const code: DiagnosticCode = detail.includes("manifest") ? "hls_manifest" : detail.includes("frag") ? "hls_fragment" : detail.includes("key") ? "hls_key" : detail.includes("buffer") ? "hls_buffer" : "decode";
              diagnose("player_error", data.fatal ? "error" : "warn", { operation, code, engine: "hlsjs", status: data.response?.code,
                message: `${data.type}: ${data.details}; fatal=${data.fatal}${data.error ? `; ${diagnosticMessage(data.error)}` : ""}` });
              if (data.fatal) callbacksRef.current.onError?.(`HLS ${data.type}: ${data.details}`);
            });
            hls.loadSource(url);
            hls.attachMedia(video);
          } catch (reason) {
            if (!disposed) diagnose("player_error", "error", { operation, code: "unsupported", engine: "hlsjs", message: diagnosticMessage(reason) });
            if (!disposed) callbacksRef.current.onError?.(`HLS loading failed: ${String(reason)}`);
          }
        },
      },
    });
    if (!mediaType) diagnose("player_load", "info", { operation, engine: "html_video", code: "start" });
    // Preserve quarter-speed values instead of the library's one-decimal labels.
    for (const rate of Artplayer.PLAYBACK_RATE) {
      const item = art.setting.find(`playback-rate-${rate}`);
      if (item) item.html = `${rate}×`;
    }
    // Some browsers expose native PiP even when its ArtPlayer control is off.
    art.video.disablePictureInPicture = true;
    const unbindAccessibility = bindPlayerAccessibility(art, language);
    // Touch screens emit compatibility mousemove events after a tap. ArtPlayer
    // reads those as "hovering the bottom bar" and then never auto-hides it.
    if (isMobileApp) Object.defineProperty(art.controls, "isHover", { get: () => false, set: () => {}, configurable: true });
    const unbindProgress = isMobileApp ? bindTouchProgress(art) : () => {};
    const anime4kController = bindAnime4K(art, {
      quality: isMobileApp ? "fast" : "hq",
      mode: readAnime4KMode(),
      onEvent: (event) => actionsRef.current.onAnime4KEvent(event),
    });
    anime4kRef.current = anime4kController;
    const danmakuController = bindDanmaku(art);
    danmakuRef.current = danmakuController;
    artRef.current = art;
    setGesturePlayer(art);
    if (!isMobileApp) art.on("dblclick", () => fullscreenRef.current.toggle("system"));

    // The startup clock runs while the video is meant to start. A WebView may
    // hold autoplay (and with it loading) until the viewer taps play; a
    // viewer who has not pressed play yet is not a failed source, so the clock
    // then waits and starts over from the first play. A connection the
    // browser reports as stalled still times out.
    let startupTimer: number | undefined;
    let playRequested = false;
    let stalled = false;
    const armStartup = () => {
      window.clearTimeout(startupTimer);
      startupTimer = window.setTimeout(() => {
        startupTimer = undefined;
        if (disposed || art.isReady) return;
        const fetching = stalled && art.video.networkState === HTMLMediaElement.NETWORK_LOADING;
        if (art.video.paused && !playRequested && !fetching) return;
        diagnose("player_error", "error", { operation, code: "timeout", elapsedMs: STARTUP_TIMEOUT_MS });
        callbacksRef.current.onError?.("Video startup timed out after 60 seconds");
      }, STARTUP_TIMEOUT_MS);
    };
    armStartup();
    art.on("video:play", () => {
      if (playRequested) return;
      playRequested = true;
      if (!art.isReady) armStartup();
    });
    art.on("video:stalled", () => { stalled = true; });
    art.on("video:progress", () => { stalled = false; });

    art.on("ready", () => {
      window.clearTimeout(startupTimer);
      art.playbackRate = sessionRate ?? defaultSpeed;
      if (startTime > 0 && Number.isFinite(startTime)) {
        art.currentTime = art.duration > 0 ? Math.min(startTime, Math.max(0, art.duration - 1)) : startTime;
      }
    });
    art.on("video:timeupdate", () => {
      callbacksRef.current.onProgress?.(art.currentTime, art.duration);
    });
    art.on("video:ended", () => callbacksRef.current.onEnded?.());
    art.on("video:play", () => diagnose("player_play", "info", { operation, position: art.currentTime }));
    art.on("video:pause", () => { if (!disposed) diagnose("player_pause", "info", { operation, position: art.currentTime }); });
    const qualityDetails = () => ({ width: art.video.videoWidth, height: art.video.videoHeight, droppedFrames: art.video.getVideoPlaybackQuality?.().droppedVideoFrames });
    art.on("video:playing", () => {
      if (firstPlay) {
        diagnose("player_playing", "info", { operation, code: "ok", elapsedMs: performance.now() - started, ...qualityDetails() });
        firstPlay = false;
      }
      if (waitingSince !== undefined && performance.now() - waitingSince >= 2_000) {
        diagnose("player_buffering", "info", { operation, code: "ok", elapsedMs: performance.now() - waitingSince, ...qualityDetails() });
      }
      clearTimeout(waitingTimer);
      waitingSince = undefined;
      callbacksRef.current.onPlaying?.();
    });
    art.on("video:waiting", () => {
      if (waitingSince !== undefined) return;
      waitingSince = performance.now();
      waitingTimer = setTimeout(() => {
        if (!disposed && !art.video.paused) diagnose("player_buffering", "warn", { operation, code: "start", position: art.currentTime, ...qualityDetails() });
      }, 2_000);
    });
    art.on("video:seeked", () => diagnose("player_seek", "info", { operation, position: art.currentTime }));
    art.on("video:error", () => {
      const error = art.video.error;
      const codes: DiagnosticCode[] = ["unknown", "aborted", "network", "decode", "unsupported"];
      diagnose("player_error", "error", { operation, code: codes[error?.code ?? 0] ?? "unknown", message: error?.message, ...qualityDetails() });
      callbacksRef.current.onError?.(error?.message || `Media error ${error?.code ?? "unknown"}`);
    });

    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      clearTimeout(waitingTimer);
      hls?.destroy();
      unbindAccessibility();
      unbindProgress();
      anime4kController.destroy();
      anime4kRef.current = null;
      danmakuController.destroy();
      danmakuRef.current = null;
      silence(art.video);
      art.destroy(false);
      artRef.current = null;
      setGesturePlayer(null);
    };
  }, [asset]);

  useEffect(() => {
    const art = artRef.current;
    callbacksRef.current.onSubtitleError?.(false);
    if (!art || !subtitle) return;
    // A native track keeps subtitle changes independent of the video session.
    // Abort superseded loads so a slow previous language cannot reappear.
    const controller = new AbortController();
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.label;
    track.srclang = subtitleLanguage(subtitle);
    track.default = true;
    let objectUrl: string | undefined;
    let disposed = false;
    const failed = (reason?: unknown) => {
      diagnose("subtitle_error", "warn", { operation: asset.diagnosticId, code: controller.signal.aborted ? "timeout" : "subtitle", message: reason instanceof Error ? diagnosticMessage(reason) : "WebView could not load or parse the subtitle track" });
      callbacksRef.current.onSubtitleError?.(true);
    };
    track.onerror = failed;
    const timer = window.setTimeout(() => controller.abort(new Error("Subtitle loading timed out")), 20_000);
    void fetch(subtitle.url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          diagnose("subtitle_error", "warn", { operation: asset.diagnosticId, code: "http", status: response.status });
          throw new Error(`Subtitle HTTP ${response.status}`);
        }
        const text = await response.text();
        if (!text.trimStart().startsWith("WEBVTT")) throw new Error("Invalid WebVTT subtitles");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        track.src = objectUrl;
        art.video.appendChild(track);
        track.track.mode = "showing";
      })
      .catch(() => {
        if (!disposed) failed();
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
      track.onerror = null;
      track.track.mode = "disabled";
      track.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset, subtitle]);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;
    if (isMobileApp && fullscreen.mode === "normal") art.setting.show = false;
    for (const mode of ["app", "system"] as const) {
      const button = art.controls[`kuriume-${mode}-fullscreen`]?.querySelector("button");
      if (!button) continue;
      const active = fullscreen.mode === mode;
      const name = isMobileApp ? "全屏" : mode === "app" ? "App 全屏" : "完全全屏";
      const englishName = isMobileApp ? "Fullscreen" : mode === "app" ? "App fullscreen" : "System fullscreen";
      const label = language === "zh" ? `${active ? "退出 " : ""}${name}` : `${active ? "Exit " : ""}${englishName}`;
      const icon = mode === "app"
        ? (active ? art.icons.fullscreenWebOff : art.icons.fullscreenWebOn)
        : (active ? art.icons.fullscreenOff : art.icons.fullscreenOn);
      button.replaceChildren(icon.cloneNode(true));
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = fullscreen.pending;
    }
  }, [asset, fullscreen.mode, fullscreen.pending, language]);

  // Next / speed / episodes buttons: what each mode has room and use for.
  const hasNext = Boolean(next);
  const episodeCount = episodes?.length ?? 0;
  useEffect(() => {
    const art = gesturePlayer;
    if (!art) return;
    const zh = language === "zh";
    const find = (name: string) => art.controls[`kuriume-${name}`] as HTMLElement | undefined;
    const set = (name: string, visible: boolean, label: string) => {
      const control = find(name);
      if (!control) return;
      control.style.display = visible ? "" : "none";
      const button = control.querySelector("button");
      button?.setAttribute("aria-label", label);
      if (button) button.title = label;
    };
    set("next", hasNext && (isFullscreen || !isMobileApp), zh ? "下一集" : "Next episode");
    set("episodes", isFullscreen && episodeCount > 1, zh ? "选集" : "Episodes");
    const episodesButton = find("episodes")?.querySelector("button");
    if (episodesButton) episodesButton.textContent = zh ? "选集" : "Episodes";
    const speed = () => {
      const button = find("speed")?.querySelector("button");
      if (!button) return;
      const rate = art.playbackRate || 1;
      button.textContent = rate === 1 ? (zh ? "倍速" : "Speed") : `${rate}×`;
      button.setAttribute("aria-label", zh ? `播放速度 ${rate}×` : `Playback speed ${rate}×`);
    };
    speed();
    art.on("video:ratechange", speed);
    return () => { art.off("video:ratechange", speed); };
  }, [gesturePlayer, hasNext, isFullscreen, episodeCount, language]);

  useEffect(() => {
    let cancelled = false;
    void anime4kSupported().then((supported) => { if (!cancelled) setAnime4kSupport(supported ? "yes" : "no"); });
    return () => { cancelled = true; };
  }, []);

  // Anime4K toggle state and the renderer follow the preference and support.
  useEffect(() => {
    const art = gesturePlayer;
    if (!art) return;
    anime4kRef.current?.setEnabled(anime4k && anime4kSupport === "yes");
    const button = (art.controls["kuriume-anime4k"] as HTMLElement | undefined)?.querySelector("button");
    if (!button) return;
    const zh = language === "zh";
    const on = anime4k && anime4kSupport !== "no";
    button.setAttribute("aria-pressed", String(on));
    button.dataset.unsupported = String(anime4kSupport === "no");
    const label = anime4kSupport === "no"
      ? (zh ? "Anime4K：当前设备不支持" : "Anime4K: not supported on this device")
      : zh ? `Anime4K 画质增强：${on ? "已开启" : "已关闭"}` : `Anime4K upscaling: ${on ? "on" : "off"}`;
    button.setAttribute("aria-label", label);
    button.title = label;
  }, [gesturePlayer, anime4k, anime4kSupport, language]);

  // 画质优先 / 流畅优先: chosen in the player's settings (gear) or 我的 › 设置,
  // applied to a running renderer at once.
  const anime4kMode = useSyncExternalStore(subscribeAnime4KMode, () => readAnime4KMode(), () => readAnime4KMode());
  useEffect(() => { anime4kRef.current?.setMode(anime4kMode); }, [gesturePlayer, anime4kMode]);
  useEffect(() => {
    const art = gesturePlayer;
    if (!art) return;
    const zh = language === "zh";
    const name = "kuriume-anime4k-mode";
    const gear = art.controls.setting as HTMLElement | undefined;
    if (anime4kSupport === "no") {
      if (art.setting.find(name)) art.setting.remove(name);
      // Phones have nothing else in the gear.
      if (isMobileApp && gear) gear.style.display = "none";
      return;
    }
    if (gear) gear.style.display = "";
    const label = (mode: Anime4KMode) => (mode === "smooth" ? (zh ? "流畅优先" : "Smooth") : (zh ? "画质优先" : "Quality"));
    const option = {
      name,
      html: zh ? "Anime4K 画质增强" : "Anime4K upscaling",
      icon: ANIME4K_ICON,
      tooltip: label(anime4kMode),
      selector: (["quality", "smooth"] as const).map((value) => ({ html: label(value), value, default: value === anime4kMode })),
      onSelect(item: { value?: unknown; html: string }) {
        const value = item.value === "smooth" ? "smooth" : "quality";
        writeAnime4KMode(value);
        if (actionsRef.current.anime4kOn()) art.notice.show = `Anime4K：${label(value)}`;
        return item.html;
      },
    };
    if (art.setting.find(name)) art.setting.update(option);
    else art.setting.add(option);
  }, [gesturePlayer, anime4kMode, anime4kSupport, language]);

  // Danmaku: the canvas follows the comments, display preferences and offset.
  const danmakuComments = danmaku?.comments ?? null;
  const danmakuPrefs = danmaku?.prefs;
  const danmakuOffset = danmaku?.offset ?? 0;
  useEffect(() => { danmakuRef.current?.setComments(danmakuComments); }, [gesturePlayer, danmakuComments]);
  useEffect(() => { if (danmakuPrefs) danmakuRef.current?.setPrefs(danmakuPrefs); }, [gesturePlayer, danmakuPrefs]);
  useEffect(() => { danmakuRef.current?.setOffset(danmakuOffset); }, [gesturePlayer, danmakuOffset]);
  const danmakuStatus = danmaku?.status ?? "unavailable";
  const danmakuCount = danmakuComments?.length ?? 0;
  useEffect(() => {
    const control = gesturePlayer?.controls["kuriume-danmaku"] as HTMLElement | undefined;
    const settings = gesturePlayer?.controls["kuriume-danmaku-settings"] as HTMLElement | undefined;
    if (settings) {
      // Settings only matter while danmaku show; turning them on brings it back.
      settings.style.display = danmakuStatus === "unavailable" || danmakuStatus === "off" ? "none" : "";
      const button = settings.querySelector("button");
      const label = language === "zh" ? "弹幕设置" : "Danmaku settings";
      button?.setAttribute("aria-label", label);
      if (button) button.title = label;
    }
    if (!control) return;
    control.style.display = danmakuStatus === "unavailable" ? "none" : "";
    const button = control.querySelector("button");
    if (!button) return;
    const zh = language === "zh";
    const on = danmakuStatus !== "off" && danmakuStatus !== "unavailable";
    button.setAttribute("aria-pressed", String(on));
    button.dataset.state = danmakuStatus;
    const detail = danmakuStatus === "ready" ? (zh ? `，${danmakuCount} 条` : `, ${danmakuCount}`)
      : danmakuStatus === "none" ? (zh ? "，没有找到弹幕" : ", none found")
        : danmakuStatus === "error" ? (zh ? "，加载失败" : ", failed to load")
          : danmakuStatus === "matching" || danmakuStatus === "loading" ? (zh ? "，加载中" : ", loading") : "";
    const label = zh ? `弹幕：${on ? "已开启" : "已关闭"}${detail}（D）` : `Danmaku: ${on ? "on" : "off"}${detail} (D)`;
    button.setAttribute("aria-label", label);
    button.title = label;
  }, [gesturePlayer, danmakuStatus, danmakuCount, language]);

  // Desktop: keyboard shortcuts beyond ArtPlayer's own (space, arrows), and wheel volume.
  useEffect(() => {
    const art = gesturePlayer;
    if (!art || isMobileApp) return;
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const step = (direction: number) => {
        const index = PLAYBACK_RATES.findIndex((rate) => rate >= (art.playbackRate || 1));
        const nextRate = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, (index < 0 ? PLAYBACK_RATES.length - 1 : index) + direction))];
        art.playbackRate = nextRate;
        sessionRate = nextRate;
        art.notice.show = `${nextRate}×`;
      };
      let handled = true;
      if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        if (Number.isFinite(art.duration) && art.duration > 0) {
          art.currentTime = Math.min(Math.max(0, art.currentTime + (event.key === "ArrowRight" ? 85 : -85)), art.duration - 0.1);
        }
      } else if (event.key === "f" || event.key === "F") fullscreenRef.current.toggle("system");
      else if (event.key === "n" || event.key === "N") actionsRef.current.next?.onPlay();
      else if (event.key === "a" || event.key === "A") actionsRef.current.toggleAnime4K();
      else if (event.key === "d" || event.key === "D") actionsRef.current.toggleDanmakuShown();
      else if (event.key === "[") step(-1);
      else if (event.key === "]") step(1);
      else if (event.key === "?") actionsRef.current.setSheet("shortcuts");
      else handled = false;
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      if ((event.target as Element | null)?.closest?.(".art-settings")) return;
      event.preventDefault();
      art.muted = false;
      art.volume = Math.min(1, Math.max(0, art.volume + (event.deltaY < 0 ? 0.05 : -0.05)));
      art.notice.show = `${language === "zh" ? "音量" : "Volume"} ${Math.round(art.volume * 100)}%`;
    };
    // Capture: run before ArtPlayer's own hotkeys see Shift+arrows.
    window.addEventListener("keydown", keydown, true);
    art.template.$player.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", keydown, true);
      art.template.$player.removeEventListener("wheel", wheel);
    };
  }, [gesturePlayer, language]);

  // Android back while the screen is locked unlocks first: the page's back
  // handler sees `data-player-locked` and asks the player to unlock.
  useEffect(() => {
    const unlock = () => setLocked(false);
    window.addEventListener("kuriume-player-unlock", unlock);
    return () => window.removeEventListener("kuriume-player-unlock", unlock);
  }, []);
  useEffect(() => { if (!isFullscreen) setSheet((current) => (current === "episodes" || current === "options" ? null : current)); }, [isFullscreen]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background" data-player-locked={locked ? "" : undefined}>
      <div ref={containerRef} className="artplayer-app h-full w-full overflow-hidden bg-background" data-mobile={isMobileApp} data-fullscreen={fullscreen.mode !== "normal"} data-danmaku-below={danmakuBelow} data-locked={locked} data-testid="art-player-surface" />
      <PlayerChrome
        art={gesturePlayer}
        language={language}
        fullscreen={isFullscreen}
        title={title}
        mediaTitle={mediaTitle}
        onExitFullscreen={fullscreen.close}
        sheet={sheet}
        onSheet={setSheet}
        locked={locked}
        onLocked={setLocked}
        lockFlash={lockFlash}
        gesture={gesture}
        next={next}
        autoNext={autoNext}
        episodes={episodes}
        currentEpisode={currentEpisode}
        onSelectEpisode={onSelectEpisode}
        options={options}
        onOpenOptions={onOpenOptions}
        resumeFrom={resumeFrom}
        onRateChosen={(rate) => { sessionRate = rate; }}
        danmaku={danmakuAvailable ? danmaku : undefined}
      />
    </div>
  );
}

/** How long a requested start may take before the source counts as failed. */
const STARTUP_TIMEOUT_MS = 60_000;

/**
 * Stops a player's <video> for good. A slow source can finish loading after
 * its player was replaced (another line, source or episode); the element,
 * possibly detached, would then play unseen and keep sounding after leaving
 * the page. Mute it, drop autoplay, and pause any later start.
 */
function silence(video: HTMLVideoElement) {
  video.autoplay = false;
  video.muted = true;
  const stop = () => { video.pause(); };
  video.addEventListener("play", stop);
  video.addEventListener("playing", stop);
  video.pause();
}
