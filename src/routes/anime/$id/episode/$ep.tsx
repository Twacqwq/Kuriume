import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  component: EpisodePage,
});

function EpisodePage() {
//   const { id, ep } = Route.useParams();

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">
      </p>
    </div>
  );
}
