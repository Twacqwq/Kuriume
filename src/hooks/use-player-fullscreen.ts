import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPlayerFullscreen, type FullscreenState, type NativeFullscreenTransition } from "@/lib/player-fullscreen";
import { isMobileApp } from "@/lib/platform";
import { mobileControl } from "@/lib/mobile-player";

export function usePlayerFullscreen() {
  const [state, setState] = useState<FullscreenState>({ mode: "normal", pending: false, error: null });
  const controller = useRef<ReturnType<typeof createPlayerFullscreen> | null>(null);

  useEffect(() => {
    const native = isMobileApp ? null : getCurrentWindow();
    const darwin = import.meta.env.TAURI_ENV_PLATFORM === "darwin";
    let mobileFullscreen = false;
    // macOS: the player uses simple fullscreen (no new Space, no animation),
    // so the video and Anime4K resize once instead of on every animation
    // frame. The window's own green-button fullscreen still works as before.
    let simpleFullscreen = false;
    const fullscreen = createPlayerFullscreen({
      isFullscreen: () => native ? (simpleFullscreen ? Promise.resolve(true) : native.isFullscreen()) : Promise.resolve(mobileFullscreen),
      onResized: (handler) => native ? native.onResized(handler) : Promise.resolve(() => {}),
      setFullscreen: async (value) => {
        // Commit the immersive layout before the OS captures the window.
        if (value) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (native && darwin && (value || simpleFullscreen)) {
          await invoke("player_simple_fullscreen", { enabled: value });
          simpleFullscreen = value;
          return "settled" as const;
        }
        if (native) await native.setFullscreen(value);
        else { await mobileControl("fullscreen", value ? 1 : 0); mobileFullscreen = value; }
      },
    }, setState, darwin
      ? (handler) => native!.listen<NativeFullscreenTransition>("player-fullscreen-transition", ({ payload }) => handler(payload))
      : undefined);
    controller.current = fullscreen;
    const escape = (event: KeyboardEvent) => {
      // Escape dismisses the foreground menu first, then exits fullscreen.
      const overlay = document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], .art-setting-show .art-settings');
      if (event.key === "Escape" && !event.defaultPrevented && !overlay) void fullscreen.exit();
    };
    // Capture before ArtPlayer's Escape hotkey prevents the default event.
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      controller.current = null;
      fullscreen.dispose();
    };
  }, []);

  const toggle = useCallback((mode: "app" | "system") => { void controller.current?.toggle(isMobileApp ? "system" : mode); }, []);
  const close = useCallback(() => { void controller.current?.close(); }, []);
  return { ...state, toggle, close, mobile: isMobileApp };
}
