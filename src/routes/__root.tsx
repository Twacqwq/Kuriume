import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
// import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Sidebar } from "@/components/sidebar";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { SearchPanel } from "@/components/search-panel";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const matches = useMatches();
  const [searchOpen, setSearchOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const pathname = matches[matches.length - 1]?.pathname;
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

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

  // Transparent webview on player pages so mpv native view shows through
  useEffect(() => {
    const bg = isPlayerPage ? "transparent" : "oklch(0.1 0 0)";
    document.documentElement.style.backgroundColor = bg;
  }, [isPlayerPage]);

  return (
    <div className={`flex h-full overflow-x-hidden ${isPlayerPage ? '' : 'bg-background'}`}>
      {/* macOS title bar drag region — desktop only */}
      {!isPlayerPage && (
        <div
          className="fixed inset-x-0 top-0 z-50 hidden h-8 md:block"
          data-tauri-drag-region
        />
      )}
      {!isPlayerPage && <Sidebar onSearchClick={openSearch} />}
      <SearchPanel open={searchOpen} onClose={closeSearch} />
      <main
        ref={mainRef}
        className={
          isPlayerPage
            ? "flex-1 overflow-hidden"
            : "relative flex-1 overflow-x-hidden overflow-y-auto pb-16 md:pt-8 md:pb-0 transition-all duration-300"
        }
        style={isPlayerPage ? undefined : { paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <Outlet />
      </main>
      {!isPlayerPage && <BottomTabBar />}
      {/* {!isPlayerPage && <TanStackRouterDevtools position="bottom-right" />} */}
    </div>
  );
}
