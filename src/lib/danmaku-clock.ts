/**
 * The time danmaku are drawn at. `video.currentTime` does not advance evenly
 * per display frame: it follows the decoder and audio clock, so read on each
 * animation frame it moves 14 ms one frame and 19 ms the next, and now and
 * then not at all, and scrolling text visibly hitches. This clock advances by
 * the animation frame's own timestamps instead (times the playback rate) and
 * only follows the video:
 *
 * - small differences are absorbed gradually (well under a frame of video);
 * - a large one (a seek the events missed) is taken at once;
 * - it never runs further ahead of the video than the video's own update
 *   step, so while the video stalls the danmaku stall with it;
 * - while the video is not playing, or after a seek, pause, resume or rate
 *   change, it is the video's time exactly.
 */

/** Seconds over which a small difference from the video is absorbed. */
const SLEW_SECONDS = 0.5;
/** A difference larger than this (seconds) is taken at once. */
const SNAP_SECONDS = 0.4;
/** Ahead of the video by at most this, or the video's update step if larger. */
const MIN_LEAD_SECONDS = 0.06;
/** Longer frame gaps (a hidden tab, a long task) count as this long. */
const MAX_FRAME_SECONDS = 0.1;

export class DanmakuClock {
  private time = 0;
  private frameAt: number | null = null;
  private lastMedia = Number.NaN;
  private lastMediaAt = 0;
  /** Typical seconds between changes of the video's reported time. */
  private updateStep = 1 / 60;

  /** Take the video's time on the next frame (seek, pause, resume, rate change). */
  reset() {
    this.frameAt = null;
  }

  /**
   * The time to draw at, for an animation frame at `now` (ms, the frame's
   * timestamp) while the video reports `media` seconds.
   */
  next(now: number, media: number, rate: number, playing: boolean): number {
    if (media !== this.lastMedia) {
      if (playing && Number.isFinite(this.lastMedia) && media > this.lastMedia) {
        const step = (now - this.lastMediaAt) / 1000;
        if (step > 0 && step < 1) this.updateStep += (step - this.updateStep) * 0.1;
      }
      this.lastMedia = media;
      this.lastMediaAt = now;
    }
    if (!playing || this.frameAt === null || !Number.isFinite(this.time)) {
      this.time = media;
      this.frameAt = playing ? now : null;
      return this.time;
    }
    const elapsed = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.frameAt) / 1000));
    this.frameAt = now;
    this.time += elapsed * rate;
    // Where the video is now: its last reported time plus the time since it
    // changed, up to one update step (a stalled video stops there).
    const lead = Math.max(MIN_LEAD_SECONDS, this.updateStep * 1.5) * Math.max(1, rate);
    const video = media + Math.min(((now - this.lastMediaAt) / 1000) * rate, lead);
    const difference = video - this.time;
    if (Math.abs(difference) > SNAP_SECONDS) {
      this.time = video;
    } else {
      this.time = Math.min(this.time + difference * Math.min(1, elapsed / SLEW_SECONDS), media + lead);
    }
    return this.time;
  }
}
