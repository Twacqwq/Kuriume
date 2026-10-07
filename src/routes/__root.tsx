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

  const pathname = matches[matches.length - 1]?.pathname;
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

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
