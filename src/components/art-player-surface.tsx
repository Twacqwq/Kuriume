import type { DirectMediaAsset, PlaybackSubtitle } from "@/lib/playback";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { subtitleLanguage } from "@/lib/playback-selection";
import type { usePlayerFullscreen } from "@/hooks/use-player-fullscreen";
import Artplayer from "artplayer";
import type Hls from "hls.js";
import { useEffect, useRef } from "react";

const KURIUME = "#904840";
// Fullscreen belongs to the desktop page, including the double-click shortcut.
Artplayer.DBCLICK_FULLSCREEN = false;

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
    const mediaType =
      asset.mimeType === "application/x-mpegURL" ||
      asset.mimeType === "application/vnd.apple.mpegurl" ||
      asset.url.toLowerCase().split(/[?#]/, 1)[0]?.endsWith(".m3u8")
        ? "m3u8"
        : undefined;

    const art = new Artplayer({
      container,
      url: asset.url,
      ...(mediaType ? { type: mediaType } : {}),
      ...(poster ? { poster } : {}),
      theme: KURIUME,
      lang: language === "zh" ? "zh-cn" : "en",
      autoplay: autoPlay,
      volume: defaultVolume,
      mutex: true,
      playsInline: true,
      hotkey: true,
      pip: false,
      fullscreen: false,
      fullscreenWeb: false,
      controls: (["app", "system"] as const).map((mode) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "grid size-9 place-items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-primary-readable disabled:opacity-50";
        return {
          name: `kuriume-${mode}-fullscreen`,
          position: "right",
          html: button,
          mounted(this: Artplayer) {
            this.proxy(button, "click", () => fullscreenRef.current.toggle(mode));
          },
        };
      }),
      playbackRate: true,
      aspectRatio: true,
      screenshot: false,
      setting: false,
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
            video.src = url;
            return;
          }
          try {
            const Hls = (await import("hls.js")).default;
            if (disposed) return;
            if (!Hls.isSupported()) {
              callbacksRef.current.onError?.("当前 WebView 不支持 HLS 播放");
              return;
            }
            hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) callbacksRef.current.onError?.(`HLS ${data.type}: ${data.details}`);
            });
            hls.loadSource(url);
            hls.attachMedia(video);
          } catch (reason) {
            if (!disposed) callbacksRef.current.onError?.(`HLS loading failed: ${String(reason)}`);
          }
        },
      },
    });
    artRef.current = art;
    art.on("dblclick", () => fullscreenRef.current.toggle("system"));

    const startupTimer = window.setTimeout(() => {
      if (!disposed && !art.isReady) callbacksRef.current.onError?.("Video startup timed out after 60 seconds");
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
    art.on("video:playing", () => callbacksRef.current.onPlaying?.());
    art.on("video:error", () => {
      const error = art.video.error;
      callbacksRef.current.onError?.(error?.message || `Media error ${error?.code ?? "unknown"}`);
    });

    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      hls?.destroy();
      art.destroy(false);
      artRef.current = null;
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
    track.onerror = () => callbacksRef.current.onSubtitleError?.(true);
    const timer = window.setTimeout(() => controller.abort(new Error("Subtitle loading timed out")), 20_000);
    void fetch(subtitle.url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Subtitle HTTP ${response.status}`);
        const text = await response.text();
        if (!text.trimStart().startsWith("WEBVTT")) throw new Error("Invalid WebVTT subtitles");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        track.src = objectUrl;
        art.video.appendChild(track);
        track.track.mode = "showing";
      })
      .catch(() => {
        if (!disposed) callbacksRef.current.onSubtitleError?.(true);
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
    for (const mode of ["app", "system"] as const) {
      const button = art.controls[`kuriume-${mode}-fullscreen`]?.querySelector("button");
      if (!button) continue;
      const active = fullscreen.mode === mode;
      const name = mode === "app" ? "App 全屏" : "完全全屏";
      const englishName = mode === "app" ? "App fullscreen" : "System fullscreen";
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
    <div
      ref={containerRef}
      className="artplayer-app h-full w-full overflow-hidden bg-black"
      data-testid="art-player-surface"
    />
  );
}
