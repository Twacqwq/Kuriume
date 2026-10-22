export type GestureKind = "seek" | "volume" | "brightness";
export interface GestureStart {
  x: number; y: number; width: number; height: number;
  position: number; duration: number; volume: number; brightness: number;
  /** Raises the distance before a swipe counts, e.g. for the second tap of a double tap. */
  slop?: number;
}
/** Finger travel before a swipe counts. A tap (or the jitter of a quick
 *  double tap) moves a few px; seeking needs a deliberate horizontal drag. */
export const SEEK_SLOP = 28;
export const LEVEL_SLOP = 20;
export interface GestureChange { kind: GestureKind; value: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A gesture keeps its initial axis; seeking commits only when the finger lifts. */
export function playerGesture(start: GestureStart) {
  let kind: GestureKind | undefined;
  if (start.width <= 0 || start.height <= 0 || start.x < 24 || start.x > start.width - 24) return null;
  return (x: number, y: number): GestureChange | null => {
    const dx = x - start.x, dy = start.y - y;
    const factor = Math.max(1, start.slop ?? 1);
    if (!kind) {
      if (Math.abs(dx) >= SEEK_SLOP * factor && Math.abs(dx) > Math.abs(dy) * 1.5) kind = "seek";
      else if (Math.abs(dy) >= LEVEL_SLOP * factor && Math.abs(dy) > Math.abs(dx) * 1.5) kind = start.x < start.width / 2 ? "brightness" : "volume";
      else return null;
    }
    // Measure from where the swipe was recognised, so it starts at the current value.
    const travel = (delta: number, slop: number) => Math.sign(delta) * Math.max(0, Math.abs(delta) - slop * factor);
    if (kind === "seek") {
      if (!Number.isFinite(start.duration) || start.duration <= 0) return null;
      // One screen-width changes at most two minutes, not an entire episode.
      return { kind, value: clamp(start.position + travel(dx, SEEK_SLOP) / start.width * Math.min(120, start.duration), 0, Math.max(0, start.duration - 0.1)) };
    }
    return { kind, value: clamp(start[kind] + travel(dy, LEVEL_SLOP) / Math.max(120, start.height * 0.8), kind === "brightness" ? 0.05 : 0, 1) };
  };
}

export function gestureTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
