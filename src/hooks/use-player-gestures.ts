import { useCallback, useRef } from "react";

/**
 * Touch gesture handler for video players.
 *
 * - Single tap: toggle controls
 * - Double tap left/right: seek ±10s
 * - Horizontal swipe: seek forward/backward
 */
export interface PlayerGestureCallbacks {
  onToggleControls: () => void;
  onTogglePause: () => void;
  onSeekDelta: (delta: number) => void;
  onResetHideTimer: () => void;
}

export function usePlayerGestures({
  onToggleControls,
  onTogglePause,
  onSeekDelta,
  onResetHideTimer,
}: PlayerGestureCallbacks) {
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTapRef = useRef(0);
  const lastTapXRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeHandledRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    swipeHandledRef.current = false;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const start = touchStartRef.current;
      if (!touch || !start || swipeHandledRef.current) return;

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      // Only treat as horizontal swipe if dx is dominant
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
        const seekSeconds = Math.round(dx / 10); // ~1s per 10px
        onSeekDelta(seekSeconds);
        onResetHideTimer();
        swipeHandledRef.current = true;
      }
    },
    [onSeekDelta, onResetHideTimer],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current;
      if (!start) return;

      // If swipe was handled, don't process tap
      if (swipeHandledRef.current) {
        touchStartRef.current = null;
        return;
      }

      const now = Date.now();
      const elapsed = now - start.time;

      // Only treat as tap if it was quick and didn't move much
      if (elapsed > 300) {
        touchStartRef.current = null;
        return;
      }

      const changedTouch = e.changedTouches[0];
      if (!changedTouch) return;
      const tapX = changedTouch.clientX;

      // Double-tap detection
      if (now - lastTapRef.current < 300) {
        // Double tap detected — cancel pending single-tap
        clearTimeout(tapTimeoutRef.current);

        // Determine left/right side of screen
        const screenWidth = window.innerWidth;
        if (tapX < screenWidth / 3) {
          onSeekDelta(-10);
        } else if (tapX > (screenWidth * 2) / 3) {
          onSeekDelta(10);
        } else {
          // Center double-tap: toggle pause
          onTogglePause();
        }
        onResetHideTimer();
        lastTapRef.current = 0;
      } else {
        // Single tap — delay to wait for potential double-tap
        lastTapRef.current = now;
        lastTapXRef.current = tapX;
        tapTimeoutRef.current = setTimeout(() => {
          onToggleControls();
        }, 300);
      }

      touchStartRef.current = null;
    },
    [onToggleControls, onTogglePause, onSeekDelta, onResetHideTimer],
  );

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
