/**
 * React hook that manages the full torrent → stream → mpv pipeline.
 *
 * Given a torrent source (magnet URI or .torrent URL), this hook:
 * 1. Checks local cache first — if hit, plays directly via file:// URL
 * 2. Adds the torrent to the engine (resolves metadata)
 * 3. Finds the best video file
 * 4. Gets the local HTTP streaming URL
 * 5. Polls download stats for progress display
 * 6. After download completes, registers file in cache for next time
 *
 * On unmount: removes torrent session but keeps files when caching is enabled.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  torrentApi,
  pickVideoFile,
  type TorrentFileInfo,
  type TorrentStatus,
} from "./torrent";
import { cacheApi, settingsApi } from "./store";

// ── Types ────────────────────────────────────────────────────────

export type TorrentStreamPhase =
  | "idle"
  | "adding" // Adding torrent & resolving metadata
  | "selecting" // File list ready, selecting video
  | "streaming" // Stream URL obtained, playing via mpv
  | "error";

export interface TorrentStreamState {
  /** Current phase of the pipeline. */
  phase: TorrentStreamPhase;
  /** Torrent ID (set after adding). */
  torrentId: number | null;
  /** All files in the torrent. */
  files: TorrentFileInfo[];
  /** The selected video file. */
  selectedFile: TorrentFileInfo | null;
  /** Local HTTP streaming URL (or file path for cached). */
  streamUrl: string | null;
  /** Whether playing from local cache. */
  isCached: boolean;
  /** Latest download stats. */
  stats: TorrentStatus | null;
  /** Error message if phase is "error". */
  error: string | null;
}

/** Anime context needed for cache registration. */
export interface CacheContext {
  bgmId: string;
  episode: number;
  animeTitle: string;
  groupName: string;
  resolution: string;
  torrentSource: string;
}

const INITIAL_STATE: TorrentStreamState = {
  phase: "idle",
  torrentId: null,
  files: [],
  selectedFile: null,
  streamUrl: null,
  isCached: false,
  stats: null,
  error: null,
};

/** Stats polling interval in milliseconds. */
const STATS_POLL_INTERVAL = 1000;

// ── Hook ─────────────────────────────────────────────────────────

export function useTorrentStream() {
  const [state, setState] = useState<TorrentStreamState>(INITIAL_STATE);
  const torrentIdRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const mountedRef = useRef(true);
  const cacheCtxRef = useRef<CacheContext | null>(null);
  const cacheEnabledRef = useRef(false);
  const registeredRef = useRef(false);

  // ── Cleanup helper ─────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }

    const id = torrentIdRef.current;
    if (id !== null) {
      torrentIdRef.current = null;
      try {
        // Only keep files if caching is enabled AND the file was
        // successfully registered in cache (i.e. download completed
        // and cache_organize moved it).  Otherwise always delete —
        // partial/incomplete downloads in the temp dir are useless.
        const shouldKeep = cacheEnabledRef.current && registeredRef.current;
        await torrentApi.remove(id, !shouldKeep);
      } catch {
        /* torrent might already be removed */
      }
    }
  }, []);

  // ── Lifecycle: cleanup on unmount ──────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  // ── Start stats polling ────────────────────────────────────────

  const startPolling = useCallback((torrentId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const stats = await torrentApi.stats(torrentId);
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, stats }));

          // Auto-register in cache when download completes
          if (
            stats.progress >= 1.0 &&
            !registeredRef.current &&
            cacheEnabledRef.current &&
            cacheCtxRef.current
          ) {
            registeredRef.current = true;
            registerInCache(torrentId).catch(() => {});
          }
        }
      } catch {
        /* ignore transient errors */
      }
    }, STATS_POLL_INTERVAL);
  }, []);

  // ── Register completed download in cache ───────────────────────

  const registerInCache = useCallback(async (torrentId: number) => {
    const ctx = cacheCtxRef.current;
    if (!ctx) return;
    try {
      const currentState = await new Promise<TorrentStreamState>((resolve) => {
        setState((prev) => { resolve(prev); return prev; });
      });
      const file = currentState.selectedFile;
      if (!file) return;

      // Get the file's actual path from the torrent engine
      const sourcePath = await torrentApi.filePath(torrentId, file.index);

      // Move file to organized cache dir & register in DB
      await cacheApi.organize({
        sourcePath,
        bgmId: ctx.bgmId,
        episode: ctx.episode,
        animeTitle: ctx.animeTitle,
        groupName: ctx.groupName,
        resolution: ctx.resolution,
        torrentSource: ctx.torrentSource,
      });
    } catch {
      /* non-critical — cache registration failure shouldn't affect playback */
    }
  }, []);

  // ── Main: start streaming a torrent ────────────────────────────

  const startStream = useCallback(
    async (source: string, cacheContext?: CacheContext) => {
      // Clean up any previous torrent
      await cleanup();
      registeredRef.current = false;
      cacheCtxRef.current = cacheContext ?? null;
      setState({ ...INITIAL_STATE, phase: "adding" });

      // Always fetch the latest setting — the ref may not be ready yet
      try {
        const settings = await settingsApi.get();
        cacheEnabledRef.current = settings.cache_enabled;
      } catch {
        cacheEnabledRef.current = false;
      }

      try {
        // ── Cache check ──────────────────────────────────────
        if (cacheContext && cacheEnabledRef.current) {
          const cached = await cacheApi.lookup(
            cacheContext.bgmId,
            cacheContext.episode,
            cacheContext.groupName || undefined,
            cacheContext.resolution || undefined,
          );
          if (cached) {
            if (!mountedRef.current) return;
            setState({
              ...INITIAL_STATE,
              phase: "streaming",
              streamUrl: cached.file_path,
              isCached: true,
            });
            return;
          }
        }

        // Step 1: Add torrent & wait for metadata
        const torrentId = await torrentApi.add(source);
        torrentIdRef.current = torrentId;

        if (!mountedRef.current) return;

        // Step 2: List files
        const files = await torrentApi.listFiles(torrentId);

        if (!mountedRef.current) return;

        // Step 3: Auto-select the best video file
        const selectedFile = pickVideoFile(files);

        if (!selectedFile) {
          setState((prev) => ({
            ...prev,
            phase: "selecting",
            torrentId,
            files,
            selectedFile: null,
            error: "No video file found in torrent",
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          phase: "selecting",
          torrentId,
          files,
          selectedFile,
        }));

        // Step 4: Get stream URL
        const streamUrl = await torrentApi.streamUrl(
          torrentId,
          selectedFile.index,
        );

        if (!mountedRef.current) return;

        // Step 5: Start stats polling for live download info
        startPolling(torrentId);

        if (!mountedRef.current) return;

        setState((prev) => ({
          ...prev,
          phase: "streaming",
          streamUrl,
        }));
      } catch (err) {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [cleanup, startPolling, registerInCache],
  );

  // ── Manually select a different file ───────────────────────────

  const selectFile = useCallback(
    async (fileIndex: number) => {
      const torrentId = torrentIdRef.current;
      if (torrentId === null) return;

      try {
        const file = state.files.find((f) => f.index === fileIndex);
        if (!file) return;

        const streamUrl = await torrentApi.streamUrl(torrentId, fileIndex);

        if (!mountedRef.current) return;

        setState((prev) => ({
          ...prev,
          phase: "streaming",
          selectedFile: file,
          streamUrl,
          error: null,
        }));

        startPolling(torrentId);
      } catch (err) {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [state.files, startPolling],
  );

  // ── Stop and cleanup ───────────────────────────────────────────

  const stopStream = useCallback(async () => {
    await cleanup();
    if (mountedRef.current) {
      setState(INITIAL_STATE);
    }
  }, [cleanup]);

  return {
    ...state,
    startStream,
    selectFile,
    stopStream,
  };
}
