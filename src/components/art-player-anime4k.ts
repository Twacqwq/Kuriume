import type Artplayer from "artplayer";
import type { Anime4KEvent, Anime4KQuality, Anime4KRenderer, FrameSource } from "@/lib/anime4k/renderer";

const PREFERENCE_KEY = "kuriume:anime4k";

export function readAnime4KPreference(): boolean {
  try { return localStorage.getItem(PREFERENCE_KEY) === "on"; } catch { return false; }
}

export function writeAnime4KPreference(enabled: boolean) {
  try { localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off"); } catch { /* per-device preference only */ }
}

const FRAME_SOURCE_KEY = "kuriume:anime4k-source";

function readFrameSource(): FrameSource {
  try { return localStorage.getItem(FRAME_SOURCE_KEY) === "bitmap" ? "bitmap" : "video"; } catch { return "video"; }
}

function writeFrameSource(source: FrameSource) {
  try { localStorage.setItem(FRAME_SOURCE_KEY, source); } catch { /* best effort */ }
}

/** Subtitle cue text without WebVTT markup, one line per cue line. */
export function cueText(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

export type Anime4KController = {
  setEnabled(enabled: boolean): void;
  destroy(): void;
};

/**
 * Lays a WebGPU canvas exactly over ArtPlayer's <video> and runs Anime4K on
 * every decoded frame while enabled. The canvas ignores pointer input, so
 * gestures and controls keep working. Native subtitle tracks render inside
 * the <video> (under the canvas), so while Anime4K is on they are drawn in a
 * text layer above it instead.
 */
export function bindAnime4K(art: Artplayer, options: { quality: Anime4KQuality; onEvent: (event: Anime4KEvent | { type: "started" }) => void }): Anime4KController {
  const video = art.video;
  const canvas = document.createElement("canvas");
  canvas.className = "kuriume-anime4k-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const captions = document.createElement("div");
  captions.className = "kuriume-anime4k-captions";
  captions.setAttribute("aria-live", "off");
  video.after(canvas, captions);

  let renderer: Anime4KRenderer | null = null;
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

  // Some WebViews cannot hand decoded video frames to WebGPU directly; an
  // error right after starting retries once through ImageBitmap copies.
  // The fallback is remembered per device, so it is only discovered once.
  let source: FrameSource = readFrameSource();
  const start = () => {
    const run = ++generation;
    const startedAt = performance.now();
    starting = (async () => {
      try {
        const { Anime4KRenderer } = await import("@/lib/anime4k/renderer");
        const next = await Anime4KRenderer.start(video, canvas, options.quality, (event) => {
          if (event.type === "error" && next.source === "video" && performance.now() - startedAt < 4000 && run === generation) {
            source = "bitmap";
            writeFrameSource(source);
            next.stop();
            stopRenderer();
            if (enabled) start();
          } else if (event.type === "slow" && event.quality === "hq") {
            next.setQuality("fast");
            options.onEvent(event);
          } else {
            options.onEvent(event);
          }
        }, source);
        if (run !== generation || !enabled) { next.stop(); return; }
        renderer = next;
        art.template.$player.classList.add("kuriume-anime4k-on");
        layout();
        if (run !== generation) return; // retried with another frame source
        takeTracks();
        options.onEvent({ type: "started" });
      } catch (reason) {
        if (run === generation) options.onEvent({ type: "error", message: reason instanceof Error ? reason.message : String(reason) });
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
