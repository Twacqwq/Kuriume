export type Anime4KBackend = "webgpu" | "webgl2";

let backendProbe: Promise<Anime4KBackend | null> | undefined;
let webgl2: boolean | undefined;

/** WebGL2 with half-float render targets: enough for the CNN fallback. */
export function webgl2Capable(): boolean {
  if (webgl2 !== undefined) return webgl2;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2 = Boolean(gl && (gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float")));
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

/**
 * How this WebView can run Anime4K: WebGPU when it has a usable adapter
 * (Chromium WebViews, Safari 26+), else WebGL2 (macOS 15, iOS 18 and older),
 * else not at all. Kept apart from the renderers so checking never loads
 * any shaders.
 */
export function anime4kBackend(): Promise<Anime4KBackend | null> {
  backendProbe ??= (async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.gpu && await navigator.gpu.requestAdapter()) return "webgpu";
    } catch { /* fall through to WebGL2 */ }
    return typeof document !== "undefined" && webgl2Capable() ? "webgl2" : null;
  })();
  return backendProbe;
}

export async function anime4kSupported(): Promise<boolean> {
  return (await anime4kBackend()) !== null;
}
