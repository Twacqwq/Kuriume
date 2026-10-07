import { MediaDetail } from "@/components/media-detail";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import {
  historyApi,
  historyListQueryKey,
  libraryApi,
  mediaApi,
  type LibraryStatus,
} from "@/lib/store";
import {
  charactersQueryOptions,
  detailQueryOptions,
  episodesQueryOptions,
} from "@/routes/anime/$id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/anime/$id/")({
  component: AnimeDetailPage,
});

function AnimeDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const language = useDisplayLanguage();
  const { data: media } = useQuery(detailQueryOptions(id, language));
  const { data: episodes = [] } = useQuery({
    ...episodesQueryOptions(id, media?.total_episodes ?? 0),
    enabled: !!media,
  });
  const { data: characters = [] } = useQuery({
    ...charactersQueryOptions(id),
    enabled: !!media,
  });
  const { data: storedMedia } = useQuery({
    queryKey: ["stored-media", id, language],
    queryFn: () => mediaApi.ensure(media!, language),
    enabled: !!media,
    staleTime: Infinity,
  });
  const { data: libraryEntry = null, isPending: libraryLoading, isError: libraryLoadError } = useQuery({
    queryKey: ["library-entry", storedMedia?.id],
    queryFn: () => libraryApi.get(storedMedia!.id),
    enabled: !!storedMedia,
  });
  const { data: history = [] } = useQuery({
    queryKey: historyListQueryKey(200, 0),
    queryFn: () => historyApi.list(200, 0),
  });

  const setStatus = useMutation({
    mutationFn: async (status: LibraryStatus) => {
      if (!storedMedia) return;
      if (libraryEntry) {
        await libraryApi.setStatus(storedMedia.id, status);
      } else {
        await libraryApi.add(storedMedia.id, status);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["library-entry", storedMedia?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["library-list"] });
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (storedMedia) await libraryApi.remove(storedMedia.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["library-entry", storedMedia?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["library-list"] });
    },
  });

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
      episodes={episodes}
      characters={characters}
      libraryEntry={libraryEntry}
      libraryPending={!storedMedia || libraryLoading || libraryLoadError || setStatus.isPending || remove.isPending}
      libraryError={libraryLoadError
        ? (language === "zh" ? "追番状态读取失败，请重新打开详情页。" : "Could not load library status. Reopen this page to retry.")
        : setStatus.isError || remove.isError
          ? (language === "zh" ? "资料库更新失败，请重试。" : "Could not update your library. Please retry.")
          : null}
      history={history}
      onBack={() => router.navigate({ to: "/", replace: true })}
      onSetLibraryStatus={(status) => setStatus.mutate(status)}
      onRemoveFromLibrary={() => remove.mutate()}
    />
  );
}
