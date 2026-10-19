import { useDisplayLanguage } from "@/hooks/use-display-language";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TRIGGER_PX = 64;
const MAX_PX = 112;

/**
 * Pull-down-to-refresh for the app's main scroll area on touch screens.
 * Only starts at the very top, only for downward pulls, and never during a
 * refresh; horizontal shelves keep their own scrolling.
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const zh = useDisplayLanguage() === "zh";
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busy = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
    const scroller = document.querySelector<HTMLElement>("main.app-content");
    if (!scroller) return;
    let start: { x: number; y: number } | null = null;
    let distance = 0;
    const touchstart = (event: TouchEvent) => {
      start = !busy.current && scroller.scrollTop <= 0 && event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      distance = 0;
    };
    const touchmove = (event: TouchEvent) => {
      if (!start) return;
      const dy = event.touches[0].clientY - start.y;
      const dx = event.touches[0].clientX - start.x;
      if (dy <= 0 || scroller.scrollTop > 0 || (distance === 0 && Math.abs(dx) > dy)) {
        start = null;
        distance = 0;
        setPull(0);
        return;
      }
      distance = Math.min(MAX_PX, dy * 0.5);
      setPull(distance);
      if (event.cancelable) event.preventDefault();
    };
    const touchend = () => {
      if (!start) return;
      start = null;
      if (distance < TRIGGER_PX) { distance = 0; setPull(0); return; }
      distance = 0;
      busy.current = true;
      setRefreshing(true);
      setPull(52);
      void refreshRef.current().catch(() => undefined).finally(() => {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      });
    };
    scroller.addEventListener("touchstart", touchstart, { passive: true });
    scroller.addEventListener("touchmove", touchmove, { passive: false });
    scroller.addEventListener("touchend", touchend);
    scroller.addEventListener("touchcancel", touchend);
    return () => {
      scroller.removeEventListener("touchstart", touchstart);
      scroller.removeEventListener("touchmove", touchmove);
      scroller.removeEventListener("touchend", touchend);
      scroller.removeEventListener("touchcancel", touchend);
    };
  }, []);

  const armed = pull >= TRIGGER_PX;
  return (
    <div aria-hidden={!refreshing} className="flex items-end justify-center overflow-hidden transition-[height] duration-150 motion-reduce:transition-none" style={{ height: pull }}>
      <div role={refreshing ? "status" : undefined} className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw size={16} className={refreshing ? "animate-spin text-primary-readable motion-reduce:animate-none" : armed ? "text-primary-readable" : ""}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
        {refreshing ? (zh ? "正在刷新…" : "Refreshing…") : armed ? (zh ? "松开刷新" : "Release to refresh") : (zh ? "下拉刷新" : "Pull to refresh")}
      </div>
    </div>
  );
}
