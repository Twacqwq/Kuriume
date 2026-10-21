import { useEffect, useState } from "react";
import type Artplayer from "artplayer";
import { gestureTime, playerGesture, tapZone, type GestureChange, type TapZone } from "@/lib/player-gestures";
import { mobileControl, type PlayerLevels } from "@/lib/mobile-player";
import { isMobileApp } from "@/lib/platform";
import { diagnose } from "@/lib/diagnostics";

export type GestureFeedback =
  | { kind: "seek" | "volume" | "brightness" | "error"; text: string }
  | { kind: "skip"; zone: Exclude<TapZone, "center">; seconds: number; text: string }
  | { kind: "speed"; rate: number; text: string };

export interface GestureOptions {
  /** Brightness/volume swipes compete with page scrolling in the inline player. */
  levels?: boolean;
  /** Screen lock: every touch only reveals the unlock button. */
  locked?: boolean;
  onLockedTap?: () => void;
}

const DOUBLE_TAP_MS = 300;
const SKIP_STREAK_MS = 700;
const SKIP_SECONDS = 10;
const LONG_PRESS_MS = 450;
const LONG_PRESS_RATES = [1.5, 2, 3] as const;
const IGNORED_TARGETS = "button, input, select, a, [role=button], [role=slider], .art-controls, .art-progress, .art-settings, .art-state, [data-player-chrome]";

/**
 * Touch grammar for the mobile player: tap toggles the controls, double tap on
 * the sides skips 10 s (further taps keep adding), double tap in the middle
 * plays/pauses, long press plays at 2× until release, horizontal swipes preview
 * a seek that commits on release, vertical swipes adjust brightness/volume.
 */
export function usePlayerGestures(art: Artplayer | null, language: string, options?: { current: GestureOptions }) {
  const [feedback, setFeedback] = useState<GestureFeedback | null>(null);
  useEffect(() => {
    if (!art || !isMobileApp) return;
    const container = art.template.$player;
    const session = crypto.randomUUID();
    const zh = language === "zh";
    const control = (action: Parameters<typeof mobileControl>[0], value?: number) => mobileControl(action, value, session);
    const opts = () => options?.current ?? {};
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
    // A tap is recognised on touchend rather than from the click the WebView
    // synthesises afterwards: Android WebView may retarget, delay or drop that
    // click (and does, on some devices, while video plays).
    let tapStart: { id: number; x: number; y: number; at: number } | null = null;
    let touchTapAt = -Infinity;
    // Tap state
    let lastTap: { at: number; zone: TapZone; controlsBefore: boolean } | null = null;
    let streak: { zone: Exclude<TapZone, "center">; until: number; seconds: number } | null = null;
    // Long press state
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let press: { rate: number; restore: number; startY: number } | null = null;

    const show = (next: GestureFeedback, hideAfter = 900) => {
      clearTimeout(timer);
      setFeedback(next);
      if (hideAfter > 0) timer = setTimeout(() => setFeedback(null), hideAfter);
    };
    const showError = () => show({ kind: "error", text: zh ? "无法调整，请使用系统控制" : "Unavailable. Use system controls." });
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
        if (!disposed) showError();
      } finally {
        updating = false;
        if (disposed) void control("finish").catch(() => {});
      }
    };
    const prepare = control("prepare").then((value) => {
      levels = value;
      ready = true;
    }).catch(() => { /* Seek remains available; level gestures report failure. */ });
    const endPress = () => {
      clearTimeout(pressTimer);
      if (!press) return false;
      art.playbackRate = press.restore;
      press = null;
      setFeedback(null);
      return true;
    };
    const cancel = () => { touchId++; move = null; change = null; endPress(); hideLater(); };
    const touch0X = (event: TouchEvent) => event.touches[0].clientX;
    const start = (event: TouchEvent) => {
      suppressClick = false;
      move = null;
      change = null;
      endPress();
      if (event.touches.length !== 1 || (event.target as Element).closest(IGNORED_TARGETS)) { cancel(); return; }
      if (opts().locked) return;
      const rect = container.getBoundingClientRect();
      const touch = event.touches[0];
      // Leave the top/bottom control strips and OS edges untouched.
      const y = touch.clientY - rect.top;
      if (y < 44 || y > rect.height - 52) return;
      const id = ++touchId;
      tapStart = { id, x: touch0X(event), y: event.touches[0].clientY, at: performance.now() };
      if (art.playing) {
        pressTimer = setTimeout(() => {
          if (disposed || id !== touchId || change) return;
          press = { rate: 2, restore: art.playbackRate, startY: y };
          move = null;
          art.playbackRate = 2;
          suppressClick = true;
          show({ kind: "speed", rate: 2, text: zh ? "2× 倍速中" : "2× speed" }, 0);
        }, LONG_PRESS_MS);
      }
      const initial = { x: touch.clientX - rect.left, y, width: rect.width, height: rect.height, position: art.currentTime, duration: art.duration };
      move = playerGesture({ ...initial, ...levels });
      change = null;
      clearTimeout(timer);
      void control("levels").then((value) => {
        if (!disposed && id === touchId && !change) {
          levels = value;
          if (!press) move = playerGesture({ ...initial, ...value });
        }
      }).catch(() => {});
    };
    const update = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      if (tapStart && Math.hypot(event.touches[0].clientX - tapStart.x, event.touches[0].clientY - tapStart.y) > 10) tapStart = null;
      const rect = container.getBoundingClientRect(), touch = event.touches[0];
      if (press) {
        // While held, sliding up/down picks 1.5× / 2× / 3×.
        event.preventDefault();
        const step = Math.max(-1, Math.min(1, Math.round((press.startY - (touch.clientY - rect.top)) / 48)));
        const rate = LONG_PRESS_RATES[step + 1];
        if (rate !== press.rate) {
          press.rate = rate;
          art.playbackRate = rate;
          show({ kind: "speed", rate, text: zh ? `${rate}× 倍速中` : `${rate}× speed` }, 0);
        }
        return;
      }
      if (!move) return;
      const next = move(touch.clientX - rect.left, touch.clientY - rect.top);
      if (!next) return;
      clearTimeout(pressTimer);
      if (next.kind !== "seek" && opts().levels === false) { move = null; return; }
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      change = next;
      if (next.kind === "seek") {
        show({ kind: "seek", text: `${gestureTime(next.value)} / ${gestureTime(art.duration)}` }, 0);
        // Reveal the bar so the preview has a visible position, without seeking yet.
        if (art.controls && !art.controls.show) art.controls.show = true;
        art.emit?.("setBar", "played", next.value / art.duration);
      } else if (ready) {
        levels[next.kind] = next.value;
        const label = next.kind === "volume" ? (zh ? "音量" : "Volume") : (zh ? "亮度" : "Brightness");
        show({ kind: next.kind, text: `${label} ${Math.round(next.value * 100)}%` }, 0);
        pending = next;
        void apply();
      } else showError();
    };
    const end = (event: TouchEvent) => {
      clearTimeout(pressTimer);
      const tapped = tapStart && tapStart.id === touchId && !change && !press && performance.now() - tapStart.at < 350 ? tapStart : null;
      tapStart = null;
      if (endPress()) { suppressClick = true; cancel(); return; }
      if (change?.kind === "seek") art.currentTime = change.value;
      cancel();
      if (tapped && event.touches.length === 0) {
        touchTapAt = performance.now();
        tap(tapped.x);
      }
    };
    const skip = (zone: Exclude<TapZone, "center">, now: number) => {
      if (!Number.isFinite(art.duration) || art.duration <= 0) return;
      const seconds = streak && streak.zone === zone && now < streak.until ? streak.seconds + SKIP_SECONDS : SKIP_SECONDS;
      streak = { zone, until: now + SKIP_STREAK_MS, seconds };
      const target = art.currentTime + (zone === "right" ? SKIP_SECONDS : -SKIP_SECONDS);
      art.currentTime = Math.min(Math.max(0, target), Math.max(0, art.duration - 0.1));
      show({ kind: "skip", zone, seconds, text: zone === "right" ? `+${seconds}s` : `-${seconds}s` }, SKIP_STREAK_MS);
    };
    const tap = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const zone = tapZone(clientX - rect.left, rect.width);
      const now = performance.now();
      if (opts().locked) { opts().onLockedTap?.(); return; }
      // A tap while a skip streak runs keeps skipping in that direction.
      if (zone !== "center" && streak?.zone === zone && now < streak.until) { skip(zone, now); lastTap = null; return; }
      if (lastTap && now - lastTap.at < DOUBLE_TAP_MS) {
        if (art.controls) art.controls.show = lastTap.controlsBefore;
        if (zone === "center") {
          art.toggle?.();
        } else skip(zone, now);
        lastTap = null;
        return;
      }
      lastTap = { at: now, zone, controlsBefore: Boolean(art.controls?.show) };
      art.controls?.toggle?.();
    };
    const click = (event: MouseEvent) => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; return; }
      if ((event.target as Element | null)?.closest?.(IGNORED_TARGETS)) return;
      // The library's own click handler would toggle play/controls on its own timing.
      event.stopImmediatePropagation();
      event.stopPropagation();
      // Already handled on touchend; this is the WebView's follow-up click.
      if (performance.now() - touchTapAt < 700) return;
      tap(event.clientX);
    };
    const background = () => { diagnose("player_background", "info", { message: document.hidden ? "Document became hidden; pausing playback" : "Native lifecycle interruption; pausing playback" }); cancel(); pending = null; ready = false; art.pause(); void control("finish").catch(() => {}); };
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
      clearTimeout(pressTimer);
      if (press) art.playbackRate = press.restore;
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
  }, [art, language, options]);
  return feedback;
}
