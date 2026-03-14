import { VideoPlayer } from "@/components/video-player";
import { queryClient } from "@/lib/query-client";
import type { AnimeEpisodes, AnimeInfo } from "@/lib/types";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";

export const Route = createFileRoute("/anime/$id/episode/$ep")({
  component: EpisodePage,
});

function EpisodePage() {
  const { id, ep } = Route.useParams();
  const router = useRouter();
  const epNum = Number(ep);

  // Pull cached anime info & episodes from TanStack Query
  const animeInfo = queryClient.getQueryData<AnimeInfo>(["anime-detail", id]);
  const episodes =
    queryClient.getQueryData<AnimeEpisodes[]>(["anime-episodes", id]) ?? [];

  const currentEp = useMemo(
    () => episodes.find((e) => e.ep === epNum),
    [episodes, epNum],
  );

  const hasPrev = epNum > 1;
  const hasNext = episodes.some((e) => e.ep === epNum + 1);

  // TODO: Replace with actual video URL once streaming is implemented
  const videoUrl =
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

  const title = currentEp?.title_cn || currentEp?.title || `第 ${epNum} 话`;
  const subtitle = animeInfo
    ? `${animeInfo.title_cn || animeInfo.title} · 第 ${epNum} 话`
    : `第 ${epNum} 话`;

  return (
    <div className="h-full w-full">
      <VideoPlayer
        key={`${id}-${ep}`}
        url={videoUrl}
        title={title}
        subtitle={subtitle}
        onBack={() => router.navigate({ to: "/anime/$id", params: { id } })}
        onPrev={
          hasPrev
            ? () =>
                router.navigate({
                  to: "/anime/$id/episode/$ep",
                  params: { id, ep: String(epNum - 1) },
                })
            : undefined
        }
        onNext={
          hasNext
            ? () =>
                router.navigate({
                  to: "/anime/$id/episode/$ep",
                  params: { id, ep: String(epNum + 1) },
                })
            : undefined
        }
      />
    </div>
  );
}
