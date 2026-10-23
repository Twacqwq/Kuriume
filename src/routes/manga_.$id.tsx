import { MediaDetail } from "@/components/media-detail";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { useDetailLibrary } from "@/hooks/use-detail-library";
import { bangumiMangaQueryOptions, listedAnime, relationsQueryOptions } from "@/lib/catalog-queries";
import { queryClient } from "@/lib/query-client";
import { catalogSourceOf, DEFAULT_DISPLAY_LANGUAGE, MANGA_CATALOG_SOURCE, settingsQueryOptions } from "@/lib/store";
import { useEffect } from "react";
import type { AnimeInfo } from "@/lib/types";
import { charactersQueryOptions, detailQueryOptions } from "@/routes/anime/$id";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, redirect, useNavigate, useRouter } from "@tanstack/react-router";

/**
 * The manga tab shows Bangumi entries only: an ID from AniList opens as its
 * Bangumi entry. True while that lookup runs or the redirect is pending.
 */
function useBangumiRedirect(id: string): boolean {
  const foreign = catalogSourceOf(id) !== MANGA_CATALOG_SOURCE;
  const { data: target, isPending } = useQuery({ ...bangumiMangaQueryOptions(id), enabled: foreign });
  const navigate = useNavigate();
  useEffect(() => {
    if (target) void navigate({ to: "/manga/$id", params: { id: target }, replace: true });
  }, [target]);
  return foreign && (isPending || !!target);
}

export const Route = createFileRoute("/manga_/$id")({
  loader: async ({ params, preload }) => {
    // Preloads only use the cache (catalog rate limits; see the anime route).
    if (preload) return;
    const settings = await queryClient.ensureQueryData(settingsQueryOptions);
    const language = settings.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
    // Manga open as their Bangumi entry, whatever catalog the link came from.
    if (catalogSourceOf(params.id) !== MANGA_CATALOG_SOURCE) {
      const target = await queryClient.fetchQuery(bangumiMangaQueryOptions(params.id));
      if (target) throw redirect({ to: "/manga/$id", params: { id: target }, replace: true });
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
  const redirecting = useBangumiRedirect(id);
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
