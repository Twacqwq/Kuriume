import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { Sidebar } from "@/components/sidebar";
import { MobileNavigation } from "@/components/mobile-navigation";
import { isAndroidApp, isMobileApp } from "@/lib/platform";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { mobileControl } from "@/lib/mobile-player";
import { SearchPanel } from "@/components/search-panel";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const matches = useMatches();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);


  // Each history entry keeps its own scroll position: back returns to where
  // the list was, a new page starts at the top. The position is read before
  // navigating; scroll events during the swap would record the next page's.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const saved = new Map<string, number>();
    const keyOf = (location: { href: string; state: { __TSR_key?: string } }) => location.state.__TSR_key ?? location.href;
    let leaving: { key: string; pathname: string } | null = null;
    let frame = 0;
    let stop = () => {};
    const offBefore = router.subscribe("onBeforeNavigate", ({ fromLocation }) => {
      if (!fromLocation) return;
      const key = keyOf(fromLocation);
      leaving = { key, pathname: fromLocation.pathname };
      saved.delete(key);
      saved.set(key, main.scrollTop);
      if (saved.size > 100) saved.delete(saved.keys().next().value!);
    });
    const offRendered = router.subscribe("onRendered", ({ toLocation }) => {
      const from = leaving;
      leaving = null;
      if (!from || from.key === keyOf(toLocation)) return;
      stop();
      const top = saved.get(keyOf(toLocation));
      // A filter or tab change on the same page keeps its place.
      if (top === undefined && from.pathname === toLocation.pathname) return;
      const target = top ?? 0;
      // The page may still swap a loading state for its content and grow for
      // a few frames: hold the position until then, unless the user scrolls.
      const deadline = performance.now() + 800;
      const apply = () => {
        if (main.scrollTop !== target) main.scrollTop = target;
        if (performance.now() < deadline) frame = requestAnimationFrame(apply);
        else stop();
      };
      const release = () => stop();
      stop = () => {
        cancelAnimationFrame(frame);
        main.removeEventListener("touchstart", release);
        main.removeEventListener("wheel", release);
        main.removeEventListener("keydown", release);
        stop = () => {};
      };
      main.addEventListener("touchstart", release, { passive: true });
      main.addEventListener("wheel", release, { passive: true });
      main.addEventListener("keydown", release);
      apply();
    });
    return () => { offBefore(); offRendered(); stop(); };
  }, [router]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    if (!isAndroidApp) return;
    const listener = onBackButtonPress(({ canGoBack }) => {
      // The active player/modal gets first refusal, then route history.
      if (searchOpen) { closeSearch(); return; }
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return;
      }
      const playerSettings = document.querySelector(".art-setting-show .art-settings");
      if (playerSettings) {
        playerSettings.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return;
      }
      const event = new Event("kuriume-back", { cancelable: true });
      if (!window.dispatchEvent(event)) return;
      if (canGoBack) router.history.back();
      else if (router.state.location.pathname !== "/") void router.navigate({ to: "/", replace: true });
      else void mobileControl("leave");
    });
    return () => { void listener.then((handle) => handle.unregister()); };
  }, [router, searchOpen, closeSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isPlayerPage = matches.some((m) =>
    m.routeId.includes("/episode/"),
  );

  return (
    <div className="app-shell dark flex h-full min-w-0 flex-col overflow-hidden bg-background md:flex-row" data-mobile={isMobileApp}>
      {!isPlayerPage && !isMobileApp && (
        <div
          className="fixed left-20 right-0 top-0 z-50 hidden h-8 md:block lg:left-56"
          data-tauri-drag-region
        />
      )}
      {!isPlayerPage && <Sidebar onSearchClick={openSearch} />}
      {!isPlayerPage && <MobileNavigation onSearch={openSearch} />}
      <SearchPanel open={searchOpen} onClose={closeSearch} />
      <main
        ref={mainRef}
        className={
          isPlayerPage
            ? "min-h-0 min-w-0 flex-1 overflow-hidden"
            : "app-content hide-scrollbar relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        }
      >
        <Outlet />
      </main>
    </div>
  );
}
