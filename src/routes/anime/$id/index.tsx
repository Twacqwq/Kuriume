import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/anime/$id/")({
  component: AnimeDetailPage,
});

function AnimeDetailPage() {
//   const { id } = Route.useParams();

  return (
    <div>
    </div>
  );
}
