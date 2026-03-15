/**
 * Torrent bridge — Tauri command wrappers for kuriume-torrent.
 *
 * Talks to the Rust `torrent_commands.rs` via `invoke()`.
 * The torrent engine lazily initializes on first use.
 */
import { invoke } from "@tauri-apps/api/core";

// ── Types matching Rust TorrentFileInfo / TorrentStatus ──────────

export interface TorrentFileInfo {
  /** File index within the torrent (used for streaming). */
  index: number;
  /** Relative file path (e.g. `"video/episode01.mkv"`). */
  path: string;
  /** File size in bytes. */
  length: number;
}

export interface TorrentStatus {
  /** Engine state description (e.g. "live", "initializing"). */
  state: string;
  /** Overall progress 0.0 – 1.0. */
  progress: number;
  /** Download speed in bytes/s. */
  download_speed: number;
  /** Upload speed in bytes/s. */
  upload_speed: number;
  /** Total bytes downloaded so far. */
  downloaded_bytes: number;
  /** Total bytes of selected files. */
  total_bytes: number;
  /** Number of connected peers. */
  peers: number;
}

// ── Invoke wrappers ─────────────────────────────────────────────

export const torrentApi = {
  /**
   * Add a torrent from magnet URI or .torrent URL.
   * Waits for metadata to resolve before returning.
   * @returns Torrent ID
   */
  add: (source: string) => invoke<number>("torrent_add", { source }),

  /** List all files inside a torrent. */
  listFiles: (torrentId: number) =>
    invoke<TorrentFileInfo[]>("torrent_list_files", { torrentId }),

  /**
   * Get a local HTTP streaming URL for a specific file.
   * The URL supports Range requests and can be passed to mpv.
   */
  streamUrl: (torrentId: number, fileId: number) =>
    invoke<string>("torrent_stream_url", { torrentId, fileId }),

  /** Get download status snapshot. */
  stats: (torrentId: number) =>
    invoke<TorrentStatus>("torrent_stats", { torrentId }),

  /** Remove a torrent and optionally delete downloaded data. */
  remove: (torrentId: number, deleteData = true) =>
    invoke<void>("torrent_remove", { torrentId, deleteData }),

  /** Get the absolute on-disk path for a file within a torrent. */
  filePath: (torrentId: number, fileId: number) =>
    invoke<string>("torrent_file_path", { torrentId, fileId }),
};

// ── Helpers ─────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".webm",
  ".flv",
  ".wmv",
  ".mov",
  ".ts",
  ".m2ts",
]);

/**
 * Pick the largest video file from a torrent's file list.
 * Returns `undefined` if no video file is found.
 */
export function pickVideoFile(
  files: TorrentFileInfo[],
): TorrentFileInfo | undefined {
  const videoFiles = files.filter((f) => {
    const ext = f.path.slice(f.path.lastIndexOf(".")).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  });

  if (videoFiles.length === 0) return undefined;

  // Pick the largest video file (most likely the actual episode, not samples)
  return videoFiles.reduce((a, b) => (a.length > b.length ? a : b));
}

/**
 * Format bytes to a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format bytes/s to a human-readable speed string.
 */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}
