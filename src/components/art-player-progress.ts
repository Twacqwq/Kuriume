import type Artplayer from "artplayer";

/** A tap that reveals the controls must not also press one of them. */
export const CONTROL_ARMING_MS = 250;

/**
 * Touch rules for the bottom bar: reveal before acting, and preview before
 * committing. ArtPlayer seeks on `touchstart` and on every `touchmove`, which
 * both makes a hidden progress bar a seek target and floods HLS with seeks.
 * Capture-phase listeners on the player take over before the library sees the
 * touch; the preview is drawn through ArtPlayer's own `setBar` event.
 */
export function bindTouchProgress(art: Artplayer) {
  const { $player, $progress } = art.template;
  let armingTimer: ReturnType<typeof setTimeout> | undefined;
  let shown = art.controls.show;
  let ratio: number | null = null;
  let blocked = false;

  const arm = (next: boolean) => {
    const revealed = next && !shown;
    shown = next;
    if (!next) {
      clearTimeout(armingTimer);
      delete $player.dataset.arming;
    } else if (revealed) {
      clearTimeout(armingTimer);
      $player.dataset.arming = "";
      armingTimer = setTimeout(() => { delete $player.dataset.arming; }, CONTROL_ARMING_MS);
    }
  };
  const ratioAt = (clientX: number) => {
    const rect = $progress.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  };
  const onProgress = (event: Event) => Boolean((event.target as Element | null)?.closest?.(".art-progress"));
  const seekable = () => Number.isFinite(art.duration) && art.duration > 0;
  const finish = () => {
    ratio = null;
    delete $player.dataset.scrubbing;
  };

  const start = (event: TouchEvent) => {
    if (!onProgress(event)) return;
    event.stopPropagation();
    // Fallback for WebViews without :has(): the stylesheet normally keeps
    // hidden or just-revealed controls from receiving the touch at all.
    if (event.touches.length !== 1 || !art.controls.show || "arming" in $player.dataset || !seekable()) {
      blocked = true;
      art.controls.show = true;
      return;
    }
    ratio = ratioAt(event.touches[0].clientX);
    $player.dataset.scrubbing = "";
    art.controls.show = true;
    art.emit("setBar", "played", ratio, event);
  };
  const move = (event: TouchEvent) => {
    if (ratio === null && !blocked) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    if (ratio === null) return;
    if (event.touches.length !== 1) {
      cancel();
      return;
    }
    ratio = ratioAt(event.touches[0].clientX);
    art.emit("setBar", "played", ratio, event);
  };
  const end = () => {
    blocked = false;
    if (ratio === null) return;
    const target = ratio * art.duration;
    finish();
    art.currentTime = Math.min(target, Math.max(0, art.duration - 0.1));
    // Restart the auto-hide timer from the moment the finger lifts.
    art.controls.show = true;
  };
  const cancel = () => {
    blocked = false;
    if (ratio === null) return;
    finish();
    art.emit("setBar", "played", art.played);
  };
  // timeupdate redraws the played bar; keep the preview on top while dragging.
  const keepPreview = () => { if (ratio !== null) art.emit("setBar", "played", ratio); };

  // Compatibility mouseenter after a tap marks the player as hovered, which
  // reveals the bar visually (and makes it hit-testable) behind ArtPlayer's back.
  const ignoreHover = (hovered: boolean) => { if (hovered && !art.controls.show) $player.classList.remove("art-hover"); };

  art.on("control", arm);
  art.on("hover", ignoreHover);
  art.on("video:timeupdate", keepPreview);
  $player.addEventListener("touchstart", start, { capture: true, passive: true });
  $player.addEventListener("touchmove", move, { capture: true, passive: false });
  $player.addEventListener("touchend", end, true);
  $player.addEventListener("touchcancel", cancel, true);
  return () => {
    clearTimeout(armingTimer);
    art.off("control", arm);
    art.off("hover", ignoreHover);
    art.off("video:timeupdate", keepPreview);
    $player.removeEventListener("touchstart", start, true);
    $player.removeEventListener("touchmove", move, true);
    $player.removeEventListener("touchend", end, true);
    $player.removeEventListener("touchcancel", cancel, true);
    delete $player.dataset.arming;
    delete $player.dataset.scrubbing;
  };
}
