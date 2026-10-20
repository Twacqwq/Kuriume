let adapterProbe: Promise<boolean> | undefined;

/**
 * Whether this WebView can run Anime4K: WebGPU with a usable adapter. Kept
 * apart from the renderer so checking support never loads the shaders.
 */
export function anime4kSupported(): Promise<boolean> {
  adapterProbe ??= (async () => {
    try {
      return Boolean(typeof navigator !== "undefined" && navigator.gpu && await navigator.gpu.requestAdapter());
    } catch {
      return false;
    }
  })();
  return adapterProbe;
}
