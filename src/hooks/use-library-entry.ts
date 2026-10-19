import { libraryApi, type LibraryStatus } from "@/lib/store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Library status for one stored work, shared by the details and player pages. */
export function useLibraryEntry(mediaId: string | undefined) {
  const queryClient = useQueryClient();
  const entry = useQuery({
    queryKey: ["library-entry", mediaId],
    queryFn: () => libraryApi.get(mediaId!),
    enabled: !!mediaId,
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["library-entry", mediaId] }),
    queryClient.invalidateQueries({ queryKey: ["library-list"] }),
  ]);
  const setStatus = useMutation({
    mutationFn: async (status: LibraryStatus) => {
      if (!mediaId) return;
      if (entry.data) await libraryApi.setStatus(mediaId, status);
      else await libraryApi.add(mediaId, status);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async () => { if (mediaId) await libraryApi.remove(mediaId); },
    onSuccess: refresh,
  });
  return {
    entry: entry.data ?? null,
    pending: !mediaId || entry.isPending || entry.isError || setStatus.isPending || remove.isPending,
    loadError: entry.isError,
    updateError: setStatus.isError || remove.isError,
    setStatus: (status: LibraryStatus) => setStatus.mutate(status),
    remove: () => remove.mutate(),
  };
}
