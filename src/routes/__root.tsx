import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Sidebar } from "@/components/sidebar";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex h-full bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto transition-all duration-300 peer-data-collapsed">
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
