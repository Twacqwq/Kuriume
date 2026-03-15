import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Sidebar } from "@/components/sidebar";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const matches = useMatches();

  // Hide sidebar & make main non-scrollable on player pages
  const isPlayerPage = matches.some((m) =>
    m.routeId.includes("/episode/"),
  );

  return (
    <div className={`flex h-full ${isPlayerPage ? '' : 'bg-background'}`}>
      {!isPlayerPage && <Sidebar />}
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
