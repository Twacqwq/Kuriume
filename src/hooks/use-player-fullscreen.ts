import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPlayerFullscreen, type FullscreenState, type NativeFullscreenTransition } from "@/lib/player-fullscreen";
import { isMobileApp } from "@/lib/platform";
import { mobileControl } from "@/lib/mobile-player";

export function usePlayerFullscreen() {
  const [state, setState] = useState<FullscreenState>({ mode: "normal", pending: false, error: null });
  const controller = useRef<ReturnType<typeof createPlayerFullscreen> | null>(null);

  useEffect(() => {
    const native = isMobileApp ? null : getCurrentWindow();
    let mobileFullscreen = false;
    const fullscreen = createPlayerFullscreen({
      isFullscreen: () => native ? native.isFullscreen() : Promise.resolve(mobileFullscreen),
      onResized: (handler) => native ? native.onResized(handler) : Promise.resolve(() => {}),
      setFullscreen: async (value) => {
        // Commit the immersive layout before the OS captures the window.
        if (value) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (native) await native.setFullscreen(value);
        else { await mobileControl("fullscreen", value ? 1 : 0); mobileFullscreen = value; }
      },
    }, setState, import.meta.env.TAURI_ENV_PLATFORM === "darwin"
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
