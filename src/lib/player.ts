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
  setGeometry: (x: number, y: number, width: number, height: number) =>
    invoke<void>("player_set_geometry", { x, y, width, height }),
};
