import { invoke } from "@tauri-apps/api/core";
import type { DanmakuComment } from "@/lib/danmaku-layout";

/**
 * Danmaku from the 弹弹play open danmaku network (src-tauri/src/danmaku.rs).
 * Display preferences are per device; the match and timing offset are per work.
 */

export type DanmakuMatch = { animeId: number; animeTitle: string; episodeId: number; episodeTitle: string };
export type DanmakuAnime = { animeId: number; title: string; typeDescription: string | null; episodeCount: number };

export const danmakuApi = {
  available: () => invoke<boolean>("danmaku_available"),
  match: (request: { animeId?: number | null; bangumiId?: number | null; titles: string[]; episode: number }) =>
    invoke<DanmakuMatch | null>("danmaku_match", { request }),
  search: (keyword: string) => invoke<DanmakuAnime[]>("danmaku_search", { keyword }),
  comments: (episodeId: number, airing: boolean) => invoke<DanmakuComment[]>("danmaku_comments", { episodeId, airing }),
};

export type DanmakuFontSize = "small" | "medium" | "large";
export type DanmakuSpeed = "slow" | "normal" | "fast";

export type DanmakuPrefs = {
  enabled: boolean;
  /** 0.2–1 */
  opacity: number;
  fontSize: DanmakuFontSize;
  speed: DanmakuSpeed;
  /** Share of the player scrolling and top comments may cover. */
  area: 0.25 | 0.5 | 0.75 | 1;
  hideScroll: boolean;
  hideTop: boolean;
  hideBottom: boolean;
  hideColor: boolean;
};

// v3: the defaults changed before release; testers start from the new ones.
const PREFS_KEY = "kuriume:danmaku:v3";

/**
 * Off until the viewer turns it on; then light: small, half transparent, the
 * upper half only (subtitles stay clear).
 */
export function defaultPrefs(): DanmakuPrefs {
  return { enabled: false, opacity: 0.5, fontSize: "small", speed: "normal", area: 0.5, hideScroll: false, hideTop: false, hideBottom: false, hideColor: false };
}

const AREAS = [0.25, 0.5, 0.75, 1] as const;

export function readPrefs(storage: Pick<Storage, "getItem"> | undefined): DanmakuPrefs {
  const fallback = defaultPrefs();
  try {
    const stored = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null") as Partial<DanmakuPrefs> | null;
    if (!stored || typeof stored !== "object") return fallback;
    const pick = <K extends keyof DanmakuPrefs>(key: K, valid: (value: unknown) => boolean) => (valid(stored[key]) ? stored[key] as DanmakuPrefs[K] : fallback[key]);
    const boolean = (value: unknown) => typeof value === "boolean";
    return {
      enabled: pick("enabled", boolean),
      opacity: pick("opacity", (value) => typeof value === "number" && value >= 0.2 && value <= 1),
      fontSize: pick("fontSize", (value) => value === "small" || value === "medium" || value === "large"),
      speed: pick("speed", (value) => value === "slow" || value === "normal" || value === "fast"),
      area: pick("area", (value) => AREAS.includes(value as DanmakuPrefs["area"])),
      hideScroll: pick("hideScroll", boolean),
      hideTop: pick("hideTop", boolean),
      hideBottom: pick("hideBottom", boolean),
      hideColor: pick("hideColor", boolean),
    };
  } catch {
    return fallback;
  }
}

export function writePrefs(storage: Pick<Storage, "setItem"> | undefined, prefs: DanmakuPrefs) {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* per-device convenience only */ }
}

/** Font size in CSS pixels, scaled with the player so phones are not crowded. */
export function fontPixels(size: DanmakuFontSize, playerHeight: number): number {
  const base = { small: 18, medium: 22, large: 27 }[size];
  return Math.round(base * Math.min(1.3, Math.max(0.7, playerHeight / 600)));
}

/** Seconds a scrolling comment takes to cross the player. */
export function scrollSeconds(speed: DanmakuSpeed): number {
  return { slow: 11, normal: 8, fast: 5.5 }[speed];
}

/** A work's chosen 弹弹play anime and timing offset (seconds, + = later). */
export type DanmakuWork = { animeId?: number; offset?: number };

const workKey = (catalogId: string) => `kuriume:danmaku:work:${catalogId}`;

export function readWork(storage: Pick<Storage, "getItem"> | undefined, catalogId: string): DanmakuWork {
  try {
    const value = JSON.parse(storage?.getItem(workKey(catalogId)) ?? "null") as DanmakuWork | null;
    return {
      animeId: Number.isSafeInteger(value?.animeId) ? value?.animeId : undefined,
      offset: typeof value?.offset === "number" && Number.isFinite(value.offset) ? Math.max(-60, Math.min(60, value.offset)) : undefined,
    };
  } catch {
    return {};
  }
}

export function writeWork(storage: Pick<Storage, "setItem"> | undefined, catalogId: string, work: DanmakuWork) {
  try { storage?.setItem(workKey(catalogId), JSON.stringify(work)); } catch { /* per-device convenience only */ }
}

/** The bgm.tv subject of a Bangumi catalog entry ("bangumi:400602"). */
export function bangumiSubject(catalogId: string): number | null {
  const match = /^bangumi:(\d+)$/.exec(catalogId);
  return match ? Number(match[1]) : null;
}

/** "1,234 条" / "1.2万 条" */
export function formatCount(count: number, zh: boolean): string {
  if (!zh) return count.toLocaleString("en-US");
  return count >= 10_000 ? `${(count / 10_000).toFixed(1).replace(/\.0$/, "")}万` : count.toLocaleString("zh-CN");
}
