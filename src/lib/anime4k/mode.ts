/**
 * 画质优先 / 流畅优先 for Anime4K, chosen in 我的 › 设置 and kept on this device.
 * Quality: the large networks on desktop at up to 4K, stepping down only when
 * the GPU falls behind. Smooth: the medium networks at up to 1080p everywhere.
 */
export type Anime4KMode = "quality" | "smooth";

const KEY = "kuriume:anime4k:mode";
const listeners = new Set<() => void>();
let mode: Anime4KMode | null = null;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readAnime4KMode(store: Pick<Storage, "getItem"> | undefined = storage()): Anime4KMode {
  if (mode) return mode;
  try {
    mode = store?.getItem(KEY) === "smooth" ? "smooth" : "quality";
  } catch {
    mode = "quality";
  }
  return mode;
}

export function writeAnime4KMode(next: Anime4KMode, store: Pick<Storage, "setItem"> | undefined = storage()) {
  mode = next;
  try { store?.setItem(KEY, next); } catch { /* per-device preference only */ }
  for (const listener of listeners) listener();
}

export function subscribeAnime4KMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
