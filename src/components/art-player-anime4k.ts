import type Artplayer from "artplayer";
import type { Anime4KEvent, Anime4KQuality } from "@/lib/anime4k/renderer";
import { anime4kBackend, webgl2Capable } from "@/lib/anime4k/support";
import { choosePath, cueText, nextPath, readPath, writePath, type Anime4KPath } from "@/lib/anime4k/paths";
import type { Anime4KMode } from "@/lib/anime4k/mode";
import { OUTPUT_LIMITS, type OutputLimits } from "@/lib/anime4k/sizing";

export type { Anime4KPath } from "@/lib/anime4k/paths";

/** Earlier builds kept the choice across launches; it is no longer read. */
const LEGACY_PREFERENCE_KEY = "kuriume:anime4k";
try { localStorage.removeItem(LEGACY_PREFERENCE_KEY); } catch { /* storage unavailable */ }

// Anime4K costs battery and GPU time, so every launch starts with it off. Once
// turned on it stays on for the next episodes until the app is closed.
let enabledThisSession = false;

export function readAnime4KPreference(): boolean {
  return enabledThisSession;
}

export function writeAnime4KPreference(enabled: boolean) {
  enabledThisSession = enabled;
}

type BackendRenderer = {
  setQuality(quality: Anime4KQuality): void;
  restartPacing(): void;
  resize(box: { width: number; height: number }, limits: OutputLimits): void;
  stop(): void;
};

export type Anime4KController = {
  setEnabled(enabled: boolean): void;
  /** 画质优先 / 流畅优先; a running renderer restarts with it. */
  setMode(mode: Anime4KMode): void;
  destroy(): void;
};

/** Backing-store resizes run at most this often (window drags); a single
 *  change, like entering fullscreen, applies at once. */
const RESIZE_SETTLE_MS = 150;

/**
 * Lays a WebGPU (or WebGL2) canvas exactly over ArtPlayer's <video> and runs Anime4K on
 * every decoded frame while enabled. The canvas ignores pointer input, so
 * gestures and controls keep working. Native subtitle tracks render inside
 * the <video> (under the canvas), so while Anime4K is on they are drawn in a
 * text layer above it instead.
 */
export function bindAnime4K(art: Artplayer, options: { quality: Anime4KQuality; mode: Anime4KMode; onEvent: (event: Anime4KEvent | { type: "started"; path: Anime4KPath }) => void }): Anime4KController {
  const video = art.video;
  // A canvas keeps the first context type it gets, so a switch to WebGL2
  // needs a fresh one.
  const makeCanvas = () => {
    const element = document.createElement("canvas");
    element.className = "kuriume-anime4k-canvas";
    element.setAttribute("aria-hidden", "true");
    return element;
  };
  let canvas = makeCanvas();
  const replaceCanvas = () => {
    const fresh = makeCanvas();
    fresh.style.cssText = canvas.style.cssText;
    canvas.replaceWith(fresh);
    canvas = fresh;
  };
  const captions = document.createElement("div");
  captions.className = "kuriume-anime4k-captions";
  captions.setAttribute("aria-live", "off");
  video.after(canvas, captions);

  let renderer: BackendRenderer | null = null;
  let enabled = false;
  let starting: Promise<void> | null = null;
  let generation = 0;
  const hiddenTracks = new Set<TextTrack>();
  let mode = options.mode;
  // 流畅优先 runs the medium networks at up to 1080p on every device.
  const quality = () => (mode === "smooth" ? "fast" : options.quality);

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastResize = -Infinity;
  const resizeBacking = () => {
    clearTimeout(resizeTimer);
    resizeTimer = undefined;
    lastResize = performance.now();
    renderer?.resize({ width: video.offsetWidth, height: video.offsetHeight }, OUTPUT_LIMITS[mode]);
  };
  const layout = (settle = true) => {
    // The video's own box (ArtPlayer's aspect-ratio setting resizes it) and
    // fit mode; the canvas keeps the same aspect, so letterboxing matches.
    // The CSS box follows at once (the frame scales); the backing store and,
    // when the pass count changes, the network chain follow at most every
    // RESIZE_SETTLE_MS while the size keeps changing.
    canvas.style.left = `${video.offsetLeft}px`;
    canvas.style.top = `${video.offsetTop}px`;
    canvas.style.width = `${video.offsetWidth}px`;
    canvas.style.height = `${video.offsetHeight}px`;
    canvas.style.objectFit = getComputedStyle(video).objectFit || "contain";
    if (!settle || performance.now() - lastResize > RESIZE_SETTLE_MS) resizeBacking();
    else {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeBacking, RESIZE_SETTLE_MS);
    }
  };
  const observer = new ResizeObserver(() => layout());
  observer.observe(video);
  const onMetadata = () => layout(false);
  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("resize", onMetadata);
  const onAspectRatio = () => layout(false);
  art.on("aspectRatio", onAspectRatio);
  const onSeeked = () => renderer?.restartPacing();
  video.addEventListener("seeked", onSeeked);

  const renderCaptions = () => {
    const lines: string[] = [];
    for (const track of hiddenTracks) {
      for (const cue of Array.from(track.activeCues ?? [])) {
        if ("text" in cue) lines.push(cueText(String((cue as VTTCue).text)));
      }
    }
    captions.textContent = "";
    for (const line of lines.join("\n").split("\n")) {
      if (!line.trim()) continue;
      const span = document.createElement("span");
      span.textContent = line;
      captions.append(span);
    }
  };
  const takeTracks = () => {
    for (const track of Array.from(video.textTracks)) {
      if (track.mode === "showing" && !hiddenTracks.has(track)) {
        hiddenTracks.add(track);
        track.mode = "hidden";
        track.addEventListener("cuechange", renderCaptions);
      }
    }
    renderCaptions();
  };
  const releaseTracks = () => {
    for (const track of hiddenTracks) {
      track.removeEventListener("cuechange", renderCaptions);
      if (track.mode === "hidden") track.mode = "showing";
    }
    hiddenTracks.clear();
    captions.textContent = "";
  };
  // Subtitle changes add tracks while Anime4K is on.
  const onTracks = () => { if (enabled && renderer) takeTracks(); };
  video.textTracks.addEventListener("addtrack", onTracks);
  video.textTracks.addEventListener("change", onTracks);

  const stopRenderer = () => {
    renderer?.stop();
    renderer = null;
    art.template.$player.classList.remove("kuriume-anime4k-on");
    releaseTracks();
  };

  let path: Anime4KPath | null = null;
  /** Moves to the next path after an early failure; false when none is left. */
  const fallBack = (current: Anime4KPath, reason: unknown) => {
    const fallback = nextPath(current, String(reason instanceof Error ? reason.message : reason), webgl2Capable());
    if (!fallback) return false;
    path = fallback;
    writePath(fallback);
    stopRenderer();
    if (enabled) start();
    return true;
  };
  const start = () => {
    const run = ++generation;
    const startedAt = performance.now();
    starting = (async () => {
      try {
        const backend = await anime4kBackend();
        path ??= choosePath(readPath(), backend);
        if (!path) throw new Error("Neither WebGPU nor WebGL2 half-float rendering is available");
        const current = path;
        // Each run draws on a fresh canvas: a canvas keeps its first context
        // for life, so a stopped renderer's context cannot be reused, and a
        // switch between WebGPU and WebGL2 needs a new canvas anyway.
        replaceCanvas();
        let next: BackendRenderer | null = null;
        let failed = false;
        const onEvent = (event: Anime4KEvent) => {
          const early = performance.now() - startedAt < 4000 && run === generation;
          if (event.type === "error") failed = true;
          if (event.type === "error" && early) {
            next?.stop();
            if (fallBack(current, event.message)) return;
            options.onEvent({ ...event, message: `${current}: ${event.message}` });
          } else if (event.type === "slow" && event.quality === "hq") {
            next?.setQuality("fast");
            options.onEvent(event);
          } else {
            options.onEvent(event);
          }
        };
        try {
          next = current === "webgl2"
            ? await (await import("@/lib/anime4k/webgl-renderer")).Anime4KWebGLRenderer.start(video, canvas, "fast", onEvent)
            : await (await import("@/lib/anime4k/renderer")).Anime4KRenderer.start(video, canvas, quality(), onEvent, current);
        } catch (reason) {
          if (run === generation && fallBack(current, reason)) return;
          throw reason;
        }
        if (run !== generation || !enabled) { next.stop(); return; }
        renderer = next;
        art.template.$player.classList.add("kuriume-anime4k-on");
        layout(false); // draws the first frame when paused, which can fail
        if (run !== generation || failed) return; // failed, or moved to another path
        takeTracks();
        options.onEvent({ type: "started", path: current });
      } catch (reason) {
        if (run === generation) options.onEvent({ type: "error", message: `${path ?? "none"}: ${reason instanceof Error ? reason.message : String(reason)}` });
      } finally {
        if (run === generation) starting = null;
      }
    })();
  };

  return {
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        if (!starting && !renderer) start();
      } else {
        generation += 1;
        starting = null;
        stopRenderer();
      }
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      // A different network set (and output size) needs a fresh renderer.
      if (enabled && (renderer || starting)) {
        generation += 1;
        starting = null;
        stopRenderer();
        start();
      }
    },
    destroy() {
      enabled = false;
      generation += 1;
      stopRenderer();
      observer.disconnect();
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("resize", onMetadata);
      video.removeEventListener("seeked", onSeeked);
      video.textTracks.removeEventListener("addtrack", onTracks);
      video.textTracks.removeEventListener("change", onTracks);
      art.off("aspectRatio", onAspectRatio);
      clearTimeout(resizeTimer);
      canvas.remove();
      captions.remove();
    },
  };
}
