import type { Anime4KBackend } from "./support";

/**
 * How this device runs Anime4K, best first: WebGPU reading video frames
 * directly, WebGPU through ImageBitmap copies (some WebViews cannot share
 * decoded frames with WebGPU), then the WebGL2 fallback. A path that fails
 * right after starting moves to the next one, remembered per device.
 */
export type Anime4KPath = "video" | "bitmap" | "webgl2";
// v2: earlier builds also stepped down for a cross-origin video, which then
// kept every later video on the slowest path; those devices start over.
export const PATH_KEY = "kuriume:anime4k-source:v2";
const LEGACY_PATH_KEY = "kuriume:anime4k-source";
try { localStorage.removeItem(LEGACY_PATH_KEY); } catch { /* storage unavailable */ }
const PATHS: Anime4KPath[] = ["video", "bitmap", "webgl2"];

export function readPath(): Anime4KPath | null {
  try {
    const value = localStorage.getItem(PATH_KEY);
    return PATHS.includes(value as Anime4KPath) ? value as Anime4KPath : null;
  } catch { return null; }
}

export function writePath(path: Anime4KPath) {
  try { localStorage.setItem(PATH_KEY, path); } catch { /* best effort */ }
}

/** The path to try, given what the WebView offers and what failed before. */
export function choosePath(remembered: Anime4KPath | null, backend: Anime4KBackend | null): Anime4KPath | null {
  if (!backend) return null;
  if (backend === "webgl2") return "webgl2";
  return remembered ?? "video";
}

/**
 * Where to go after `current` failed early. When WebGPU itself is missing
 * (some WebKit builds expose navigator.gpu but hand out no adapter or
 * device), retrying it through ImageBitmap is pointless: go to WebGL2.
 */
export function nextPath(current: Anime4KPath, reason: string, webgl2: boolean): Anime4KPath | null {
  // The video, not the device: every path is refused its frames alike, and
  // stepping down would keep other videos on a slower path for good.
  if (current === "webgl2" || unreadableVideo(reason)) return null;
  const noWebGPU = /webgpu is not available|webgpu canvas|requestdevice|adapter/i.test(reason);
  if (current === "video" && !noWebGPU) return "bitmap";
  return webgl2 ? "webgl2" : null;
}


/** A video from another origin without CORS, whose frames no path may read. */
export function unreadableVideo(reason: string): boolean {
  return /cross-origin|securityerror|operation is insecure|tainted/i.test(reason);
}

/** Subtitle cue text without WebVTT markup, one line per cue line. */
export function cueText(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
