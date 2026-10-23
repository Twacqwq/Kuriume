import { useLibraryEntry } from "@/hooks/use-library-entry";
import { mediaApi, type DisplayLanguage } from "@/lib/store";
import { mediaKind, type AnimeInfo } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

/**
 * A details page's library state: the work saved as media once it is known,
 * then its 追番/追漫 entry and the actions that change it.
 */
export function useDetailLibrary(id: string, media: AnimeInfo | undefined, language: DisplayLanguage) {
  const { data: storedMedia } = useQuery({
    queryKey: ["stored-media", id, language],
    queryFn: () => mediaApi.ensure(media!, language),
    enabled: !!media,
    staleTime: Infinity,
  });
  const library = useLibraryEntry(storedMedia?.id);
  const zh = language === "zh";
  const following = media && mediaKind(media) === "manga" ? "追漫" : "追番";
  return {
    entry: library.entry,
    pending: library.pending,
    error: library.loadError
      ? (zh ? `${following}状态读取失败，请重新打开详情页。` : "Could not load library status. Reopen this page to retry.")
      : library.updateError
        ? (zh ? "资料库更新失败，请重试。" : "Could not update your library. Please retry.")
        : null,
    setStatus: library.setStatus,
    remove: library.remove,
  };
}
