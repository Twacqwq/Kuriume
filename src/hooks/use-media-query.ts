import { useSyncExternalStore } from "react";

/** Subscribe to a CSS media query; matches the stylesheet's layout breakpoints. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Wide enough for the video and the panel side by side (see `.player-layout`). */
export const SIDE_PANEL_QUERY = "(min-width: 900px) and (min-height: 540px)";
