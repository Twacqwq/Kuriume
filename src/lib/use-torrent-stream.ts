/**
 * React hook that manages the full torrent → stream → mpv pipeline.
 *
 * Given a torrent source (magnet URI or .torrent URL), this hook:
 * 1. Adds the torrent to the engine (resolves metadata)
 * 2. Finds the best video file
 * 3. Gets the local HTTP streaming URL
 * 4. Plays via mpv using the player API
 * 5. Polls download stats for progress display
 *
 * Automatically cleans up (removes torrent) on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  torrentApi,
  pickVideoFile,
  type TorrentFileInfo,
  type TorrentStatus,
} from "./torrent";

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
  /** Local HTTP streaming URL. */
  streamUrl: string | null;
  /** Latest download stats. */
  stats: TorrentStatus | null;
  /** Error message if phase is "error". */
  error: string | null;
}

const INITIAL_STATE: TorrentStreamState = {
  phase: "idle",
  torrentId: null,
  files: [],
  selectedFile: null,
  streamUrl: null,
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
        await torrentApi.remove(id);
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
        }
      } catch {
        /* ignore transient errors */
      }
    }, STATS_POLL_INTERVAL);
  }, []);

  // ── Main: start streaming a torrent ────────────────────────────

  const startStream = useCallback(
    async (source: string) => {
      // Clean up any previous torrent
      await cleanup();
      setState({ ...INITIAL_STATE, phase: "adding" });

      try {
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
    [cleanup, startPolling],
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
