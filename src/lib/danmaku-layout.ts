/**
 * Where each danmaku comment goes, computed once for the whole episode so any
 * moment (after a seek, while paused) draws the same picture.
 *
 * Scrolling comments move at one speed (the screen width per `scrollSeconds`),
 * so a comment can never catch the one ahead of it: a lane is free again once
 * the previous comment has fully entered the screen. Top and bottom comments
 * hold still for `fixedSeconds`. A comment with no free lane is dropped, which
 * is also what keeps busy scenes readable.
 */

export type DanmakuMode = "scroll" | "top" | "bottom";

export type DanmakuComment = {
  /** Seconds into the episode. */
  time: number;
  mode: DanmakuMode;
  /** 0xRRGGBB. */
  color: number;
  text: string;
};

export type LayoutOptions = {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  lineHeight: number;
  /** Share of the height scrolling and top comments may use (0–1]. */
  area: number;
  scrollSeconds: number;
  fixedSeconds: number;
  /** Horizontal space kept between two comments in one lane. */
  gap: number;
  hidden: { scroll: boolean; top: boolean; bottom: boolean; color: boolean };
  measure: (text: string) => number;
};

export type Placed = {
  comment: DanmakuComment;
  lane: number;
  width: number;
  /** Seconds the comment stays on screen. */
  duration: number;
};

export type DanmakuLayout = {
  placed: Placed[];
  /** Pixels per second for scrolling comments. */
  speed: number;
  /** The longest `duration`, for finding what is on screen at a time. */
  longest: number;
};

const WHITE = 0xffffff;

export function layoutDanmaku(comments: readonly DanmakuComment[], options: LayoutOptions): DanmakuLayout {
  const { width, height, lineHeight, scrollSeconds, fixedSeconds, gap, hidden } = options;
  const speed = width / scrollSeconds;
  const lanes = Math.max(1, Math.floor((height * Math.min(1, Math.max(0.1, options.area))) / lineHeight));
  // Bottom comments start from the bottom edge and may use half the height.
  const bottomLanes = Math.max(1, Math.floor((height * 0.5) / lineHeight));
  // When each lane next becomes free (seconds).
  const freeAt = { scroll: new Array<number>(lanes).fill(-Infinity), top: new Array<number>(lanes).fill(-Infinity), bottom: new Array<number>(bottomLanes).fill(-Infinity) };
  const placed: Placed[] = [];
  let longest = fixedSeconds;
  for (const comment of comments) {
    if (hidden[comment.mode] || (hidden.color && comment.color !== WHITE)) continue;
    const lanesFor = freeAt[comment.mode];
    const lane = lanesFor.findIndex((free) => free <= comment.time);
    if (lane < 0) continue;
    const textWidth = options.measure(comment.text);
    if (comment.mode === "scroll") {
      const duration = (width + textWidth) / speed;
      lanesFor[lane] = comment.time + (textWidth + gap) / speed;
      longest = Math.max(longest, duration);
      placed.push({ comment, lane, width: textWidth, duration });
    } else {
      lanesFor[lane] = comment.time + fixedSeconds;
      placed.push({ comment, lane, width: textWidth, duration: fixedSeconds });
    }
  }
  return { placed, speed, longest };
}

/** Index of the first placed comment at or after `time` (placed is time-ordered). */
function lowerBound(placed: readonly Placed[], time: number): number {
  let low = 0;
  let high = placed.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (placed[middle].comment.time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export type Visible = { placed: Placed; x: number; y: number };

/** What is on screen at `time`, with each comment's top-left corner. */
export function visibleAt(layout: DanmakuLayout, time: number, size: { width: number; height: number; lineHeight: number }): Visible[] {
  const { placed, speed, longest } = layout;
  const visible: Visible[] = [];
  for (let index = lowerBound(placed, time - longest); index < placed.length; index++) {
    const item = placed[index];
    const elapsed = time - item.comment.time;
    if (elapsed < 0) break;
    if (elapsed >= item.duration) continue;
    if (item.comment.mode === "scroll") {
      visible.push({ placed: item, x: size.width - elapsed * speed, y: item.lane * size.lineHeight });
    } else {
      const x = (size.width - item.width) / 2;
      const y = item.comment.mode === "top" ? item.lane * size.lineHeight : size.height - (item.lane + 1) * size.lineHeight;
      visible.push({ placed: item, x, y });
    }
  }
  return visible;
}

/** "#rrggbb" for 0xRRGGBB. */
export function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}
