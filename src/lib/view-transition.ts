import type { MouseEvent } from "react";

const SHARED_POSTER = "kuriume-poster";

/**
 * Give the clicked card's poster the shared view-transition name, so it flies
 * into the details page's cover. Only one element may carry a name at a time,
 * so any earlier one is cleared first. No-op where View Transitions are missing.
 */
export function sharePoster(event: MouseEvent<HTMLElement>) {
  if (typeof document === "undefined" || !("startViewTransition" in document)) return;
  for (const element of document.querySelectorAll<HTMLElement>("[data-shared-poster]")) {
    element.style.removeProperty("view-transition-name");
    delete element.dataset.sharedPoster;
  }
  const image = event.currentTarget.querySelector<HTMLElement>("img");
  if (!image) return;
  image.style.setProperty("view-transition-name", SHARED_POSTER);
  image.dataset.sharedPoster = "";
}

export const SHARED_POSTER_NAME = SHARED_POSTER;
