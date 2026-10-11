import type { DirectMediaAsset, PlaybackSubtitle } from "@/lib/playback";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { usePlayerGestures } from "@/hooks/use-player-gestures";
import { isMobileApp } from "@/lib/platform";
import { Sun, Volume2, MoveHorizontal, CircleAlert } from "lucide-react";
import { subtitleLanguage } from "@/lib/playback-selection";
import type { usePlayerFullscreen } from "@/hooks/use-player-fullscreen";
import Artplayer from "artplayer";
import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { playerIcons } from "@/components/art-player-icons";
import { bindPlayerAccessibility } from "@/components/art-player-accessibility";
import "@/components/art-player-skin.css";
import { diagnose, diagnosticMessage, type DiagnosticCode } from "@/lib/diagnostics";

const KURIUME = "#904840";
// Fullscreen belongs to the desktop page, including the double-click shortcut.
Artplayer.DBCLICK_FULLSCREEN = false;
Artplayer.SETTING_ITEM_HEIGHT = 48;

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
}: ArtPlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const language = useDisplayLanguage();
  const [gesturePlayer, setGesturePlayer] = useState<Artplayer | null>(null);
  const gesture = usePlayerGestures(gesturePlayer, language);
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
      theme: KURIUME,
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
      controls: (isMobileApp ? ["system"] as const : ["app", "system"] as const).map((mode) => {
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
      playbackRate: true,
      aspectRatio: true,
      screenshot: false,
      setting: true,
      backdrop: false,
      gesture: false,
      fastForward: false,
      lock: false,
      moreVideoAttr: {
        crossOrigin: "anonymous",
        preload: "auto",
      },
      customType: {
        async m3u8(video, url) {
          const proxied = url.startsWith("kuriume-media:") || url.startsWith("http://kuriume-media.localhost/");
          // AVFoundation cannot request Tauri's custom scheme; Hls.js feeds
          // the same in-app video element through MediaSource in that case.
          if (!proxied && video.canPlayType("application/vnd.apple.mpegurl")) {
            diagnose("player_load", "info", { operation, engine: "native_hls", code: "start" });
            video.src = url;
            return;
          }
          try {
            const Hls = (await import("hls.js")).default;
            if (disposed) return;
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
    artRef.current = art;
    setGesturePlayer(art);
    if (!isMobileApp) art.on("dblclick", () => fullscreenRef.current.toggle("system"));

    const startupTimer = window.setTimeout(() => {
      if (!disposed && !art.isReady) {
        diagnose("player_error", "error", { operation, code: "timeout", elapsedMs: 60_000 });
        callbacksRef.current.onError?.("Video startup timed out after 60 seconds");
      }
    }, 60_000);

    art.on("ready", () => {
      window.clearTimeout(startupTimer);
      art.playbackRate = defaultSpeed;
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div ref={containerRef} className="artplayer-app h-full w-full overflow-hidden bg-black" data-mobile={isMobileApp} data-fullscreen={fullscreen.mode !== "normal"} data-testid="art-player-surface" />
      {gesture && <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
        <div className="kuriume-gesture-feedback">
          {gesture.kind === "brightness" ? <Sun size={22} /> : gesture.kind === "volume" ? <Volume2 size={22} /> : gesture.kind === "seek" ? <MoveHorizontal size={22} /> : <CircleAlert size={22} />}
          {gesture.text}
        </div>
      </div>}
    </div>
  );
}
