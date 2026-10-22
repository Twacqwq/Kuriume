/** Frames the GPU may hold at once. Two lets a tiled mobile GPU overlap one
 *  frame's work with the next frame's upload; more would starve the page's own
 *  compositing (taps would update the controls but never show them). */
export const MAX_IN_FLIGHT = 2;
/** Frames ignored after a (re)start, resize or seek: shader compilation and
 *  texture allocation make the first frames slow on every device. */
export const WARMUP_FRAMES = 72;
/** Frames judged together (~6 s at 24 fps). */
export const PACE_WINDOW = 144;

/**
 * Decides when Anime4K cannot keep up with playback: when most decoded frames
 * in a window had to be dropped because the GPU was still busy. Latency alone
 * is not a failure: a frame that finishes before the next one is due is fine,
 * however long the GPU queue made it look.
 */
export class PaceMeter {
  private frames = 0;
  private dropped = 0;
  private warmup = WARMUP_FRAMES;
  private readonly onSlow: () => void;

  constructor(onSlow: () => void) {
    this.onSlow = onSlow;
  }

  /** Start a fresh judgement (new chain, size, quality or position). */
  reset() {
    this.frames = 0;
    this.dropped = 0;
    this.warmup = WARMUP_FRAMES;
  }

  record(drawn: boolean) {
    if (this.warmup > 0) {
      this.warmup -= 1;
      return;
    }
    this.frames += 1;
    if (!drawn) this.dropped += 1;
    if (this.frames < PACE_WINDOW) return;
    const slow = this.dropped / this.frames > 0.5;
    this.frames = 0;
    this.dropped = 0;
    if (slow) this.onSlow();
  }
}
