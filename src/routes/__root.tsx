import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { Sidebar } from "@/components/sidebar";
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

  return (
    <div className="dark flex h-full overflow-hidden bg-background">
      {!isPlayerPage && (
        <div
          className="fixed left-56 right-0 top-0 z-50 h-8"
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
            : "hide-scrollbar relative flex-1 overflow-x-hidden overflow-y-auto"
        }
        style={isPlayerPage ? undefined : { paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <Outlet />
      </main>
    </div>
  );
}
