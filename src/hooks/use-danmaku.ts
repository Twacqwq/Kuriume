import { bangumiSubject, danmakuApi, readPrefs, readWork, writePrefs, writeWork, type DanmakuAnime, type DanmakuMatch, type DanmakuPrefs, type DanmakuWork } from "@/lib/danmaku";
import type { DanmakuComment } from "@/lib/danmaku-layout";
import type { AnimeInfo } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// Display preferences are shared by every player control and settings view.
let prefs: DanmakuPrefs | null = null;
const listeners = new Set<() => void>();
function currentPrefs(): DanmakuPrefs {
  prefs ??= readPrefs(storage());
  return prefs;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function updateDanmakuPrefs(change: Partial<DanmakuPrefs>) {
  prefs = { ...currentPrefs(), ...change };
  writePrefs(storage(), prefs);
  for (const listener of listeners) listener();
}

export function useDanmakuPrefs(): DanmakuPrefs {
  return useSyncExternalStore(subscribe, currentPrefs, currentPrefs);
}

/**
 * unavailable: this build has no 弹弹play credentials (feature hidden).
 * off: turned off. matching / loading: finding the episode, reading comments.
 * none: 弹弹play has no such episode. error: a request failed.
 */
export type DanmakuStatus = "unavailable" | "off" | "matching" | "loading" | "ready" | "none" | "error";

export type DanmakuView = {
  status: DanmakuStatus;
  prefs: DanmakuPrefs;
  comments: DanmakuComment[] | null;
  match: DanmakuMatch | null;
  error: string | null;
  offset: number;
  setOffset: (offset: number) => void;
  /** Use this 弹弹play anime for the whole work from now on. */
  chooseAnime: (anime: DanmakuAnime) => void;
  search: (keyword: string) => Promise<DanmakuAnime[]>;
  retry: () => void;
  /** Titles to prefill a manual search with. */
  titles: string[];
};

/** Danmaku for one episode of a catalog work. */
export function useDanmaku(media: AnimeInfo | undefined, episode: number): DanmakuView {
  const currentPreferences = useDanmakuPrefs();
  const catalogId = media?.id;
  const [work, setWork] = useState<DanmakuWork>(() => (catalogId ? readWork(storage(), catalogId) : {}));
  const [workFor, setWorkFor] = useState(catalogId);
  if (workFor !== catalogId) {
    setWorkFor(catalogId);
    setWork(catalogId ? readWork(storage(), catalogId) : {});
  }
  const saveWork = useCallback((change: DanmakuWork) => {
    if (!catalogId) return;
    setWork((previous) => {
      const next = { ...previous, ...change };
      writeWork(storage(), catalogId, next);
      return next;
    });
  }, [catalogId]);

  const titles = useMemo(() => [...new Set([media?.title_cn, media?.title_native, media?.title, media?.title_en, ...(media?.search_titles ?? [])]
    .filter((title): title is string => Boolean(title?.trim())))], [media?.title_cn, media?.title_native, media?.title, media?.title_en, media?.search_titles]);

  const available = useQuery({ queryKey: ["danmaku-available"], queryFn: danmakuApi.available, staleTime: Infinity, gcTime: Infinity, retry: false });
  const enabled = currentPreferences.enabled && available.data === true && Boolean(media) && episode > 0;
  const match = useQuery({
    queryKey: ["danmaku-match", catalogId, episode, work.animeId ?? null],
    queryFn: () => danmakuApi.match({ animeId: work.animeId, bangumiId: catalogId ? bangumiSubject(catalogId) : null, titles, episode }),
    enabled,
    staleTime: Infinity,
    retry: 1,
  });
  const episodeId = match.data?.episodeId;
  const airing = media?.status === "RELEASING";
  const comments = useQuery({
    queryKey: ["danmaku-comments", episodeId],
    queryFn: () => danmakuApi.comments(episodeId!, airing),
    enabled: enabled && episodeId !== undefined,
    // The Rust side keeps 弹弹play's suggested cache times.
    staleTime: airing ? 30 * 60_000 : 6 * 60 * 60_000,
    retry: 1,
  });

  const status: DanmakuStatus = available.data === false || available.isError
    ? "unavailable"
    : !currentPreferences.enabled
      ? "off"
      : match.isError || comments.isError
        ? "error"
        : match.isPending
          ? "matching"
          : match.data === null
            ? "none"
            : comments.isPending
              ? "loading"
              : "ready";

  return {
    status,
    prefs: currentPreferences,
    comments: status === "ready" ? comments.data ?? null : null,
    match: match.data ?? null,
    error: match.error ? String(match.error) : comments.error ? String(comments.error) : null,
    offset: work.offset ?? 0,
    setOffset: (offset) => saveWork({ offset: Math.max(-60, Math.min(60, Math.round(offset * 10) / 10)) }),
    chooseAnime: (anime) => saveWork({ animeId: anime.animeId }),
    search: (keyword) => danmakuApi.search(keyword),
    retry: () => { void (match.isError ? match.refetch() : comments.refetch()); },
    titles,
  };
}
