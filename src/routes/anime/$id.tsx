import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/anime/$id")({
  component: AnimeLayout,
});

function AnimeLayout() {
  return <Outlet />;
}
