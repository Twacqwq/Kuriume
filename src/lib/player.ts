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

// ── Invoke wrappers (plugin:mpv| prefix for Tauri v2 plugin system) ──

export const playerApi = {
  /** Initialize the native GPU player (creates native view + mpv). */
  init: () => invoke<void>("plugin:mpv|player_init"),
  play: (url: string) => invoke<void>("plugin:mpv|player_play", { url }),
  setPaused: (paused: boolean) =>
    invoke<void>("plugin:mpv|player_set_paused", { paused }),
  seek: (seconds: number) =>
    invoke<void>("plugin:mpv|player_seek", { seconds }),
  stop: () => invoke<void>("plugin:mpv|player_stop"),
  setVolume: (volume: number) =>
    invoke<void>("plugin:mpv|player_set_volume", { volume }),
  getVolume: () => invoke<number>("plugin:mpv|player_get_volume"),
  setSpeed: (speed: number) =>
    invoke<void>("plugin:mpv|player_set_speed", { speed }),
  getState: () => invoke<PlayerStateInfo>("plugin:mpv|player_get_state"),
  setAudioTrack: (id: number) =>
    invoke<void>("plugin:mpv|player_set_audio_track", { id }),
  setSubtitleTrack: (id: number) =>
    invoke<void>("plugin:mpv|player_set_subtitle_track", { id }),
  destroy: () => invoke<void>("plugin:mpv|player_destroy"),
  /** Set hardware decoding mode: "auto" | "no" */
  setHwdec: (mode: string) =>
    invoke<void>("plugin:mpv|player_set_hwdec", { mode }),
  /** Get current hardware decoding mode. */
  getHwdec: () => invoke<string>("plugin:mpv|player_get_hwdec"),
  /** Set demuxer forward buffer size in MiB. */
  setBufferSize: (sizeMib: number) =>
    invoke<void>("plugin:mpv|player_set_buffer_size", { sizeMib }),
  /** Reposition the native view to match a CSS rect (top-left origin). */
  setViewport: (x: number, y: number, width: number, height: number) =>
    invoke<void>("plugin:mpv|player_set_viewport", {
      x,
      y,
      width,
      height,
      windowHeight: window.innerHeight,
    }),
};
