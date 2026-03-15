/**
 * React hook that manages the mpv player lifecycle.
 *
 * - Initializes/destroys the player on mount/unmount
 * - Listens to `player-event` from Tauri and keeps reactive state
 * - Exposes imperative controls (play, pause, seek, volume, speed)
 * - Syncs a native mpv overlay view to a container element via
 *   ResizeObserver + scroll tracking
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { playerApi, type PlayerEvent } from "./player";

interface PlayerState {
  /** Whether the player has been initialized */
  ready: boolean;
  /** File is loaded and playback can proceed */
  loaded: boolean;
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  speed: number;
  buffered: number;
  seeking: boolean;
}

const INITIAL: PlayerState = {
  ready: false,
  loaded: false,
  position: 0,
  duration: 0,
  paused: true,
  volume: 100,
  speed: 1,
  buffered: 0,
  seeking: false,
};

export function usePlayer(containerRef?: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<PlayerState>(INITIAL);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const initedRef = useRef(false);

  // ── Lifecycle ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (initedRef.current) return;
      initedRef.current = true;

      try {
        await playerApi.init();

        // Listen to player events from Rust
        const unlisten = await listen<PlayerEvent>("player-event", (e) => {
          if (cancelled) return;
          const ev = e.payload;
          setState((prev) => {
            switch (ev.type) {
              case "TimePos":
                return { ...prev, position: ev.data };
              case "Duration":
                return { ...prev, duration: ev.data };
              case "Paused":
                return { ...prev, paused: ev.data };
              case "Speed":
                return { ...prev, speed: ev.data };
              case "Volume":
                return { ...prev, volume: ev.data };
              case "CacheDuration":
                return { ...prev, buffered: ev.data };
              case "FileStarted":
                return { ...prev, loaded: false, position: 0 };
              case "FileLoaded":
                return { ...prev, loaded: true };
              case "FileEnded":
                return { ...prev, loaded: false };
              case "Seeking":
                return { ...prev, seeking: true };
              case "PlaybackRestart":
                return { ...prev, seeking: false };
              case "Shutdown":
                return { ...prev, ready: false };
              default:
                return prev;
            }
          });
        });

        unlistenRef.current = unlisten;
        if (!cancelled) {
          setState((prev) => ({ ...prev, ready: true }));
        }
      } catch (err) {
        console.error("Failed to init player:", err);
      }
    }

    init();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;

      playerApi.destroy().catch(() => {});
      initedRef.current = false;
      setState(INITIAL);
    };
  }, []);

  // ── Geometry sync ─────────────────────────────────────────────
  // Keep the native mpv NSView aligned with the container element.

  const syncGeometry = useCallback(() => {
    const el = containerRef?.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    playerApi.setGeometry(rect.x, rect.y, rect.width, rect.height).catch(() => {});
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;

    // Initial sync
    syncGeometry();

    // Observe size changes
    const ro = new ResizeObserver(() => syncGeometry());
    ro.observe(el);

    // Also track scroll / window resize since bounding rect changes
    window.addEventListener("scroll", syncGeometry, true);
    window.addEventListener("resize", syncGeometry);

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", syncGeometry, true);
      window.removeEventListener("resize", syncGeometry);
    };
  }, [containerRef, syncGeometry, state.ready]);

  // ── Controls ───────────────────────────────────────────────────

  const play = useCallback(async (url: string) => {
    await playerApi.play(url);
    setState((prev) => ({ ...prev, paused: false }));
  }, []);

  const togglePause = useCallback(async () => {
    setState((prev) => {
      playerApi.setPaused(!prev.paused);
      return { ...prev, paused: !prev.paused };
    });
  }, []);

  const seek = useCallback(async (seconds: number) => {
    await playerApi.seek(seconds);
  }, []);

  const setVolume = useCallback(async (vol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(vol)));
    await playerApi.setVolume(clamped);
    setState((prev) => ({ ...prev, volume: clamped }));
  }, []);

  const setSpeed = useCallback(async (speed: number) => {
    await playerApi.setSpeed(speed);
    setState((prev) => ({ ...prev, speed }));
  }, []);

  const stop = useCallback(async () => {
    await playerApi.stop();
  }, []);

  return {
    state,
    play,
    togglePause,
    seek,
    setVolume,
    setSpeed,
    stop,
  };
}
