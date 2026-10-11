import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { PageLoading } from "@/components/page-loading";
import { routeTree } from "./routeTree.gen";
import "./main.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // Commit the destination shell immediately instead of waiting silently for
  // its loader. Query cache hits still render without a loading detour.
  defaultPendingComponent: PageLoading,
  defaultPendingMs: 0,
  defaultPendingMinMs: 150,
  scrollRestoration: true,
});

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
