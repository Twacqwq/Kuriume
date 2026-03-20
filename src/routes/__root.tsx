import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Sidebar } from "@/components/sidebar";
import { SearchPanel } from "@/components/search-panel";
import { useCallback, useEffect, useState } from "react";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const matches = useMatches();
  const [searchOpen, setSearchOpen] = useState(false);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Cmd+K / Ctrl+K to toggle search
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

  // Hide sidebar & make main non-scrollable on player pages
  const isPlayerPage = matches.some((m) =>
    m.routeId.includes("/episode/"),
  );

  // Make the webview transparent on player pages so the mpv
  // native view underneath can show through.
  useEffect(() => {
    const bg = isPlayerPage ? "transparent" : "oklch(0.1 0 0)";
    document.documentElement.style.backgroundColor = bg;
  }, [isPlayerPage]);

  return (
    <div className={`flex h-full ${isPlayerPage ? '' : 'bg-background'}`}>
      {!isPlayerPage && <Sidebar onSearchClick={openSearch} />}
      <SearchPanel open={searchOpen} onClose={closeSearch} />
      <main
        className={
          isPlayerPage
            ? "flex-1 overflow-hidden"
            : "flex-1 overflow-y-auto transition-all duration-300 peer-data-collapsed"
        }
      >
        <Outlet />
      </main>
      {!isPlayerPage && <TanStackRouterDevtools position="bottom-right" />}
    </div>
  );
}
