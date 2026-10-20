import type Artplayer from "artplayer";
import type { Anime4KEvent, Anime4KQuality } from "@/lib/anime4k/renderer";
import { anime4kBackend, webgl2Capable } from "@/lib/anime4k/support";
import { choosePath, cueText, readPath, writePath, type Anime4KPath } from "@/lib/anime4k/paths";

export type { Anime4KPath } from "@/lib/anime4k/paths";

const PREFERENCE_KEY = "kuriume:anime4k";

export function readAnime4KPreference(): boolean {
  try { return localStorage.getItem(PREFERENCE_KEY) === "on"; } catch { return false; }
}

export function writeAnime4KPreference(enabled: boolean) {
  try { localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off"); } catch { /* per-device preference only */ }
}

type BackendRenderer = {
  setQuality(quality: Anime4KQuality): void;
  resize(box: { width: number; height: number }): void;
  stop(): void;
};

export type Anime4KController = {
  setEnabled(enabled: boolean): void;
  destroy(): void;
};

/**
 * Lays a WebGPU (or WebGL2) canvas exactly over ArtPlayer's <video> and runs Anime4K on
 * every decoded frame while enabled. The canvas ignores pointer input, so
 * gestures and controls keep working. Native subtitle tracks render inside
 * the <video> (under the canvas), so while Anime4K is on they are drawn in a
 * text layer above it instead.
 */
export function bindAnime4K(art: Artplayer, options: { quality: Anime4KQuality; onEvent: (event: Anime4KEvent | { type: "started"; path: Anime4KPath }) => void }): Anime4KController {
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

  const layout = () => {
    // The video's own box (ArtPlayer's aspect-ratio setting resizes it) and
    // fit mode; the canvas keeps the same aspect, so letterboxing matches.
    canvas.style.left = `${video.offsetLeft}px`;
    canvas.style.top = `${video.offsetTop}px`;
    canvas.style.width = `${video.offsetWidth}px`;
    canvas.style.height = `${video.offsetHeight}px`;
    canvas.style.objectFit = getComputedStyle(video).objectFit || "contain";
    renderer?.resize({ width: video.offsetWidth, height: video.offsetHeight });
  };
  const observer = new ResizeObserver(layout);
  observer.observe(video);
  const onMetadata = () => layout();
  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("resize", onMetadata);
  art.on("aspectRatio", layout);

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
  const fallBack = (current: Anime4KPath, backend: "webgpu" | "webgl2" | null) => {
    const fallback = current === "video" ? "bitmap" : current === "bitmap" && backend === "webgpu" && webgl2Capable() ? "webgl2" : null;
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
            if (fallBack(current, backend)) return;
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
            : await (await import("@/lib/anime4k/renderer")).Anime4KRenderer.start(video, canvas, options.quality, onEvent, current);
        } catch (reason) {
          if (run === generation && fallBack(current, backend)) return;
          throw reason;
        }
        if (run !== generation || !enabled) { next.stop(); return; }
        renderer = next;
        art.template.$player.classList.add("kuriume-anime4k-on");
        layout(); // draws the first frame when paused, which can fail
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
    destroy() {
      enabled = false;
      generation += 1;
      stopRenderer();
      observer.disconnect();
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("resize", onMetadata);
      video.textTracks.removeEventListener("addtrack", onTracks);
      video.textTracks.removeEventListener("change", onTracks);
      art.off("aspectRatio", layout);
      canvas.remove();
      captions.remove();
    },
  };
}
