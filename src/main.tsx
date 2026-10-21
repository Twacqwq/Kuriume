import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { PageLoading } from "@/components/page-loading";
import { RouteError } from "@/components/route-error";
import { routeTree } from "./routeTree.gen";
import "./main.css";
import { installErrorDiagnostics } from "@/lib/diagnostics";
import { linkFollowedToCatalog, prefetchBrowseData } from "@/lib/catalog-queries";
import { dismissSplash } from "@/lib/splash";

const removeErrorDiagnostics = installErrorDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(removeErrorDiagnostics);
// Start once, outside StrictMode effects. Pages share these queries and own
// loading/retry UI, so a failed warm-up never blocks the app shell.
const browseData = prefetchBrowseData().catch(() => undefined);
// The launch splash covers the first catalog load (bounded; see lib/splash).
void dismissSplash(browseData);
// After the first screen: map followed works saved under the other catalog.
void browseData.then(() => linkFollowedToCatalog()).catch(() => undefined);

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // Commit the destination shell immediately instead of waiting silently for
  // its loader. Query cache hits still render without a loading detour.
  defaultPendingComponent: PageLoading,
  // Tauri commands reject with strings; show them readably with retry/back.
  defaultErrorComponent: RouteError,
  defaultPendingMs: 0,
  defaultPendingMinMs: 150,
  scrollRestoration: true,
});

// Data alone is not enough: a cold lazy route can still flash its pending UI.
// These are bundled local chunks in Tauri, not more catalog/network requests.
void router.preloadRoute({ to: "/calendar" }).catch(() => undefined);
void router.preloadRoute({ to: "/settings" }).catch(() => undefined);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
