export type GestureKind = "seek" | "volume" | "brightness";
export interface GestureStart {
  x: number; y: number; width: number; height: number;
  position: number; duration: number; volume: number; brightness: number;
}
export interface GestureChange { kind: GestureKind; value: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A gesture keeps its initial axis; seeking commits only when the finger lifts. */
export function playerGesture(start: GestureStart) {
  let kind: GestureKind | undefined;
  if (start.width <= 0 || start.height <= 0 || start.x < 24 || start.x > start.width - 24) return null;
  return (x: number, y: number): GestureChange | null => {
    const dx = x - start.x, dy = start.y - y;
    if (!kind) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return null;
      if (Math.abs(dx) > Math.abs(dy) * 1.25) kind = "seek";
      else if (Math.abs(dy) > Math.abs(dx) * 1.25) kind = start.x < start.width / 2 ? "brightness" : "volume";
      else return null;
    }
    if (kind === "seek") {
      if (!Number.isFinite(start.duration) || start.duration <= 0) return null;
      // One screen-width changes at most two minutes, not an entire episode.
      return { kind, value: clamp(start.position + dx / start.width * Math.min(120, start.duration), 0, Math.max(0, start.duration - 0.1)) };
    }
    return { kind, value: clamp(start[kind] + dy / Math.max(120, start.height * 0.8), kind === "brightness" ? 0.05 : 0, 1) };
  };
}

export function gestureTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export type TapZone = "left" | "center" | "right";
/** Side thirds skip on double tap; the middle third plays/pauses. */
export function tapZone(x: number, width: number): TapZone {
  if (width <= 0) return "center";
  if (x < width * 0.35) return "left";
  if (x > width * 0.65) return "right";
  return "center";
}
