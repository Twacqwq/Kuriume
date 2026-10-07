import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPlayerFullscreen, type FullscreenState, type NativeFullscreenTransition } from "@/lib/player-fullscreen";

export function usePlayerFullscreen() {
  const [state, setState] = useState<FullscreenState>({ mode: "normal", pending: false, error: null });
  const controller = useRef<ReturnType<typeof createPlayerFullscreen> | null>(null);

  useEffect(() => {
    const native = getCurrentWindow();
    const fullscreen = createPlayerFullscreen({
      isFullscreen: () => native.isFullscreen(),
      onResized: (handler) => native.onResized(handler),
      setFullscreen: async (value) => {
        // Commit the immersive layout before the OS captures the window.
        if (value) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await native.setFullscreen(value);
      },
    }, setState, import.meta.env.TAURI_ENV_PLATFORM === "darwin"
      ? (handler) => native.listen<NativeFullscreenTransition>("player-fullscreen-transition", ({ payload }) => handler(payload))
      : undefined);
    controller.current = fullscreen;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void fullscreen.exit();
    };
    // Capture before ArtPlayer's Escape hotkey prevents the default event.
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      controller.current = null;
      fullscreen.dispose();
    };
  }, []);

  const toggle = useCallback((mode: "app" | "system") => { void controller.current?.toggle(mode); }, []);
  const close = useCallback(() => { void controller.current?.close(); }, []);
  return { ...state, toggle, close };
}
