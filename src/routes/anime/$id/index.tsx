import { MediaDetail } from "@/components/media-detail";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { useDetailLibrary } from "@/hooks/use-detail-library";
import { relationsQueryOptions } from "@/lib/catalog-queries";
import { historyApi, historyListQueryKey } from "@/lib/store";
import {
  charactersQueryOptions,
  detailQueryOptions,
  episodesQueryOptions,
  useCatalogRedirect,
} from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/anime/$id/")({
  component: AnimeDetailPage,
});

function AnimeDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const language = useDisplayLanguage();
  const redirecting = useCatalogRedirect(id);
  const { data: media, error: detailError, isPlaceholderData } = useQuery({ ...detailQueryOptions(id, language), enabled: !redirecting });
  // After a hover/touch preload the loader may not block navigation, so a
  // failed lookup surfaces here and goes to the route error screen.
  if (detailError) throw detailError;
  const isManga = media?.kind === "manga";
  const { data: episodes = [] } = useQuery({
    ...episodesQueryOptions(id, media?.total_episodes ?? 0),
    enabled: !!media && !isManga,
  });
  const { data: characters = [] } = useQuery({
    ...charactersQueryOptions(id),
    enabled: !!media && !isManga,
  });
  const { data: relations = [] } = useQuery({
    ...relationsQueryOptions(id),
    enabled: !!media && !isPlaceholderData && !isManga,
  });
  const library = useDetailLibrary(id, isManga ? undefined : media, language);
  const { data: history = [] } = useQuery({
    queryKey: historyListQueryKey(200, 0),
    queryFn: () => historyApi.list(200, 0),
  });

  // A manga ID reached through an anime link opens the manga page.
  if (isManga) return <Navigate to="/manga/$id" params={{ id }} replace />;

  if (!media) {
    return (
      <div className="grid min-h-full place-items-center pt-8 text-sm text-muted-foreground">
        正在读取作品信息…
      </div>
    );
  }

  return (
    <MediaDetail
      media={media}
      pendingDetails={isPlaceholderData}
      episodes={episodes}
      characters={characters}
      relations={relations}
      libraryEntry={library.entry}
      libraryPending={library.pending}
      libraryError={library.error}
      history={history}
      onBack={() => {
        if (router.history.canGoBack()) router.history.back();
        else void router.navigate({ to: "/", replace: true });
      }}
      onSetLibraryStatus={library.setStatus}
      onRemoveFromLibrary={library.remove}
    />
  );
}
