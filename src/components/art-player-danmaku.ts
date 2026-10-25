import type Artplayer from "artplayer";
import { fontPixels, scrollSeconds, type DanmakuPrefs } from "@/lib/danmaku";
import { cssColor, layoutDanmaku, visibleAt, type DanmakuComment, type DanmakuLayout } from "@/lib/danmaku-layout";

export type DanmakuController = {
  /** The episode's comments (time-ordered); null clears them. */
  setComments(comments: readonly DanmakuComment[] | null): void;
  setPrefs(prefs: DanmakuPrefs): void;
  /** Seconds the comments are shifted (+ shows them later). */
  setOffset(offset: number): void;
  destroy(): void;
};

/** Relayouts run at most this often while the player keeps resizing. */
const RELAYOUT_MS = 150;
const FONT_FAMILY = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
const FIXED_SECONDS = 4;

/**
 * Draws danmaku on a canvas over the video (and over Anime4K's canvas), under
 * subtitles and every control. It follows the video clock, so pausing,
 * seeking and playback speed need no bookkeeping; it ignores pointer input.
 */
export function bindDanmaku(art: Artplayer): DanmakuController {
  const video = art.video;
  const canvas = document.createElement("canvas");
  canvas.className = "kuriume-danmaku";
  canvas.setAttribute("aria-hidden", "true");
  video.after(canvas);
  const context = canvas.getContext("2d");

  let comments: readonly DanmakuComment[] = [];
  let prefs: DanmakuPrefs | null = null;
  let offset = 0;
  let layout: DanmakuLayout | null = null;
  let size = { width: 0, height: 0, lineHeight: 0, pixels: 0, font: "" };
  let frame = 0;
  let destroyed = false;
  const widths = new Map<string, number>();

  const active = () => Boolean(prefs?.enabled && comments.length && context);

  const relayout = () => {
    layout = null;
    if (!context || !prefs) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const pixels = fontPixels(prefs.fontSize, height);
    const font = `600 ${pixels}px ${FONT_FAMILY}`;
    if (font !== size.font) widths.clear();
    size = { width, height, lineHeight: Math.round(pixels * 1.3), pixels, font };
    context.font = font;
    const measure = (text: string) => {
      let value = widths.get(text);
      if (value === undefined) {
        value = context.measureText(text).width;
        widths.set(text, value);
      }
      return value;
    };
    layout = layoutDanmaku(comments, {
      width,
      height,
      lineHeight: size.lineHeight,
      area: prefs.area,
      scrollSeconds: scrollSeconds(prefs.speed),
      fixedSeconds: FIXED_SECONDS,
      gap: pixels,
      hidden: { scroll: prefs.hideScroll, top: prefs.hideTop, bottom: prefs.hideBottom, color: prefs.hideColor },
      measure,
    });
  };

  const draw = () => {
    if (!context) return;
    context.clearRect(0, 0, size.width, size.height);
    if (!active() || !layout || !prefs) return;
    context.font = size.font;
    context.textBaseline = "top";
    context.lineJoin = "round";
    context.globalAlpha = prefs.opacity;
    context.lineWidth = Math.max(2, Math.round(size.lineHeight / 9));
    context.strokeStyle = "rgba(0, 0, 0, 0.75)";
    const padding = Math.round((size.lineHeight - size.pixels) / 2);
    for (const { placed, x, y } of visibleAt(layout, video.currentTime - offset, size)) {
      context.fillStyle = cssColor(placed.comment.color);
      context.strokeText(placed.comment.text, x, y + padding);
      context.fillText(placed.comment.text, x, y + padding);
    }
  };

  // Redraw every frame only while the video plays; otherwise on demand.
  const tick = () => {
    frame = 0;
    if (destroyed) return;
    draw();
    if (active() && !video.paused && !video.ended) frame = requestAnimationFrame(tick);
  };
  const schedule = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(tick);
  };
  const refresh = () => {
    relayout();
    schedule();
  };

  const events = ["play", "playing", "pause", "seeked", "seeking", "ratechange", "ended"] as const;
  for (const name of events) video.addEventListener(name, schedule);
  // A single resize (fullscreen) relays out at once; a window drag at most
  // every RELAYOUT_MS, with the canvas scaling in between.
  let lastRelayout = -Infinity;
  let relayoutTimer: ReturnType<typeof setTimeout> | undefined;
  const resized = () => {
    clearTimeout(relayoutTimer);
    const run = () => { lastRelayout = performance.now(); refresh(); };
    if (performance.now() - lastRelayout > RELAYOUT_MS) run();
    else relayoutTimer = setTimeout(run, RELAYOUT_MS);
  };
  const resize = new ResizeObserver(resized);
  resize.observe(canvas);

  return {
    setComments(next) {
      comments = next ?? [];
      refresh();
    },
    setPrefs(next) {
      const changed = !prefs || ["fontSize", "speed", "area", "hideScroll", "hideTop", "hideBottom", "hideColor"]
        .some((key) => prefs?.[key as keyof DanmakuPrefs] !== next[key as keyof DanmakuPrefs]);
      prefs = next;
      canvas.style.display = next.enabled ? "" : "none";
      if (changed || !layout) relayout();
      schedule();
    },
    setOffset(next) {
      offset = next;
      schedule();
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      for (const name of events) video.removeEventListener(name, schedule);
      resize.disconnect();
      clearTimeout(relayoutTimer);
      canvas.remove();
    },
  };
}
