/**
 * Player bridge — Tauri command wrappers & shared event types.
 *
 * Talks to the Rust `player_commands.rs` via `invoke()` and listens
 * to the `player-event` Tauri event emitted from the mpv event loop.
 */
import { invoke } from "@tauri-apps/api/core";

// ── Types matching Rust PlayerEvent / PlayerStateInfo ────────────

interface PlayerStateInfo {
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  speed: number;
}

export type PlayerEvent =
  | { type: "TimePos"; data: number }
  | { type: "Duration"; data: number }
  | { type: "Paused"; data: boolean }
  | { type: "Speed"; data: number }
  | { type: "Volume"; data: number }
  | { type: "CacheDuration"; data: number }
  | { type: "FileStarted" }
  | { type: "FileLoaded" }
  | { type: "FileEnded" }
  | { type: "Seeking" }
  | { type: "PlaybackRestart" }
  | { type: "VideoReconfig" }
  | { type: "AudioReconfig" }
  | { type: "QueueOverflow" }
  | { type: "Shutdown" };

// ── Invoke wrappers ─────────────────────────────────────────────

export const playerApi = {
  /** Initialize the native GPU player (creates native view + mpv). */
  init: () => invoke<void>("player_init"),
  play: (url: string) => invoke<void>("player_play", { url }),
  setPaused: (paused: boolean) => invoke<void>("player_set_paused", { paused }),
  seek: (seconds: number) => invoke<void>("player_seek", { seconds }),
  stop: () => invoke<void>("player_stop"),
  setVolume: (volume: number) => invoke<void>("player_set_volume", { volume }),
  getVolume: () => invoke<number>("player_get_volume"),
  setSpeed: (speed: number) => invoke<void>("player_set_speed", { speed }),
  getState: () => invoke<PlayerStateInfo>("player_get_state"),
  setAudioTrack: (id: number) => invoke<void>("player_set_audio_track", { id }),
  setSubtitleTrack: (id: number) =>
    invoke<void>("player_set_subtitle_track", { id }),
  destroy: () => invoke<void>("player_destroy"),
  /** Set hardware decoding mode: "auto" | "no" */
  setHwdec: (mode: string) => invoke<void>("player_set_hwdec", { mode }),
  /** Get current hardware decoding mode. */
  getHwdec: () => invoke<string>("player_get_hwdec"),
  /** Set demuxer forward buffer size in MiB. */
  setBufferSize: (sizeMib: number) =>
    invoke<void>("player_set_buffer_size", { sizeMib }),
  /** Reposition the native GL view to match a CSS rect (top-left origin). */
  setViewport: (x: number, y: number, width: number, height: number) =>
    invoke<void>("player_set_viewport", {
      x,
      y,
      width,
      height,
      windowHeight: window.innerHeight,
    }),
};
