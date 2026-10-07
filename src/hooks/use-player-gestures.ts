import { useEffect, useState } from "react";
import type Artplayer from "artplayer";
import { gestureTime, playerGesture, type GestureChange } from "@/lib/player-gestures";
import { mobileControl, type PlayerLevels } from "@/lib/mobile-player";
import { isMobileApp } from "@/lib/platform";

export function usePlayerGestures(art: Artplayer | null, language: string) {
  const [feedback, setFeedback] = useState<{ kind: string; text: string } | null>(null);
  useEffect(() => {
    if (!art || !isMobileApp) return;
    const container = art.template.$player;
    const session = crypto.randomUUID();
    const control = (action: Parameters<typeof mobileControl>[0], value?: number) => mobileControl(action, value, session);
    let disposed = false;
    let ready = false;
    let levels: PlayerLevels = { volume: 0, brightness: 0.5 };
    let move: ReturnType<typeof playerGesture> = null;
    let change: GestureChange | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: GestureChange | null = null;
    let updating = false;
    let suppressClick = false;
    let touchId = 0;
    const showError = () => setFeedback({ kind: "error", text: language === "zh" ? "无法调整，请使用系统控制" : "Unavailable. Use system controls." });
    const hideLater = () => { clearTimeout(timer); timer = setTimeout(() => setFeedback(null), 900); };
    // Keep native writes ordered and coalesce moves; never flood the bridge.
    const apply = async () => {
      if (updating) return;
      updating = true;
      try {
        while (pending && !disposed) {
          const current = pending;
          pending = null;
          await control(current.kind as "brightness" | "volume", current.value);
        }
      } catch {
        pending = null;
        if (!disposed) { showError(); hideLater(); }
      } finally {
        updating = false;
        if (disposed) void control("finish").catch(() => {});
      }
    };
    const prepare = control("prepare").then((value) => {
      levels = value;
      ready = true;
    }).catch(() => { /* Seek remains available; level gestures report failure. */ });
    const cancel = () => { touchId++; move = null; change = null; hideLater(); };
    const start = (event: TouchEvent) => {
      suppressClick = false;
      move = null;
      change = null;
      if (event.touches.length !== 1 || (event.target as Element).closest("button, input, select, a, [role=slider], .art-controls, .art-settings")) { cancel(); return; }
      const rect = container.getBoundingClientRect();
      const touch = event.touches[0];
      // Leave the top/bottom control strips and OS edges untouched.
      const y = touch.clientY - rect.top;
      if (y < 44 || y > rect.height - 52) return;
      const id = ++touchId;
      const initial = { x: touch.clientX - rect.left, y, width: rect.width, height: rect.height, position: art.currentTime, duration: art.duration };
      move = playerGesture({ ...initial, ...levels });
      change = null;
      clearTimeout(timer);
      void control("levels").then((value) => {
        if (!disposed && id === touchId && !change) {
          levels = value;
          move = playerGesture({ ...initial, ...value });
        }
      }).catch(() => {});
    };
    const update = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      if (!move) return;
      const rect = container.getBoundingClientRect(), touch = event.touches[0];
      const next = move(touch.clientX - rect.left, touch.clientY - rect.top);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      change = next;
      if (next.kind === "seek") {
        setFeedback({ kind: "seek", text: `${gestureTime(next.value)} / ${gestureTime(art.duration)}` });
      } else if (ready) {
        levels[next.kind] = next.value;
        const label = next.kind === "volume" ? (language === "zh" ? "音量" : "Volume") : (language === "zh" ? "亮度" : "Brightness");
        setFeedback({ kind: next.kind, text: `${label} ${Math.round(next.value * 100)}%` });
        pending = next;
        void apply();
      } else showError();
    };
    const end = () => {
      if (change?.kind === "seek") art.currentTime = change.value;
      cancel();
    };
    const click = (event: MouseEvent) => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
    };
    const background = () => { cancel(); pending = null; ready = false; art.pause(); void control("finish").catch(() => {}); };
    const visibility = () => { if (document.hidden) background(); };
    const playing = () => { void control("prepare").then((value) => { levels = value; ready = true; }).catch(() => {}); };
    const pause = () => { void control("pause").catch(() => {}); };
    art.on("video:playing", playing);
    art.on("video:pause", pause);
    container.addEventListener("touchstart", start, { passive: true, capture: true });
    container.addEventListener("touchmove", update, { passive: false, capture: true });
    container.addEventListener("touchend", end, true);
    container.addEventListener("touchcancel", cancel, true);
    container.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("kuriume-background", background);
    return () => {
      disposed = true;
      pending = null;
      clearTimeout(timer);
      container.removeEventListener("touchstart", start, true);
      container.removeEventListener("touchmove", update, true);
      container.removeEventListener("touchend", end, true);
      container.removeEventListener("touchcancel", cancel, true);
      container.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("kuriume-background", background);
      art.off("video:playing", playing);
      art.off("video:pause", pause);
      void prepare.finally(() => { if (!updating) void control("finish").catch(() => {}); });
    };
  }, [art, language]);
  return feedback;
}
