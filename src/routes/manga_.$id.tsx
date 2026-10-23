import { MediaDetail } from "@/components/media-detail";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { useDetailLibrary } from "@/hooks/use-detail-library";
import { counterpartQueryOptions, listedAnime, relationsQueryOptions } from "@/lib/catalog-queries";
import { queryClient } from "@/lib/query-client";
import { catalogSourceOf, DEFAULT_CATALOG_SOURCE, DEFAULT_DISPLAY_LANGUAGE, settingsQueryOptions } from "@/lib/store";
import type { AnimeInfo } from "@/lib/types";
import { charactersQueryOptions, detailQueryOptions, sameView, useCatalogRedirect } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, redirect, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/manga_/$id")({
  loader: async ({ params, preload, location }) => {
    // Preloads only use the cache (catalog rate limits; see the anime route).
    if (preload) return;
    const settings = await queryClient.ensureQueryData(settingsQueryOptions);
    const language = settings.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
    const source = settings.catalog_source ?? DEFAULT_CATALOG_SOURCE;
    if (catalogSourceOf(params.id) !== source) {
      const target = await queryClient.fetchQuery(counterpartQueryOptions(params.id, source));
      if (target) throw redirect({ ...sameView(location.pathname, target), replace: true });
    }
    const cached = queryClient.getQueryData<AnimeInfo>(["anime-detail", params.id, language]);
    const listed = cached ? undefined : listedAnime(params.id);
    if (listed) void queryClient.prefetchQuery(detailQueryOptions(params.id, language));
    const detail = cached ?? listed ?? (await queryClient.fetchQuery(detailQueryOptions(params.id, language)));
    // An anime reached through a manga link opens the anime page.
    if (detail?.kind === "anime") throw redirect({ to: "/anime/$id", params: { id: params.id }, replace: true });
  },
  component: MangaDetailPage,
});

function MangaDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const language = useDisplayLanguage();
  const redirecting = useCatalogRedirect(id);
  const { data: media, error: detailError, isPlaceholderData } = useQuery({ ...detailQueryOptions(id, language), enabled: !redirecting });
  if (detailError) throw detailError;
  const isAnime = media?.kind === "anime";
  const { data: characters = [] } = useQuery({
    ...charactersQueryOptions(id),
    enabled: !!media && !isAnime,
  });
  const { data: relations = [] } = useQuery({
    ...relationsQueryOptions(id),
    enabled: !!media && !isPlaceholderData && !isAnime,
  });
  // Entries cached before manga existed carry no kind; this page is a manga's.
  const manga = media && !isAnime ? { ...media, kind: "manga" as const } : undefined;
  const library = useDetailLibrary(id, manga, language);

  if (isAnime) return <Navigate to="/anime/$id" params={{ id }} replace />;

  if (!manga) {
    return (
      <div className="grid min-h-full place-items-center pt-8 text-sm text-muted-foreground">
        {language === "zh" ? "正在读取作品信息…" : "Loading…"}
      </div>
    );
  }

  return (
    <MediaDetail
      media={manga}
      pendingDetails={isPlaceholderData}
      episodes={[]}
      characters={characters}
      relations={relations}
      libraryEntry={library.entry}
      libraryPending={library.pending}
      libraryError={library.error}
      history={[]}
      onBack={() => {
        if (router.history.canGoBack()) router.history.back();
        else void router.navigate({ to: "/manga", replace: true });
      }}
      onSetLibraryStatus={library.setStatus}
      onRemoveFromLibrary={library.remove}
    />
  );
}
