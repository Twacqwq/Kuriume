import { checkForUpdate, detectPlatform, type UpdateCheck } from "@/lib/app-update";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";

const CACHE_KEY = "kuriume:update-check";
/** Background checks run at most this often; "检查更新" always asks GitHub. */
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

type Cached = { checkedAt: number; result: UpdateCheck };

function readCache(current: string | undefined): Cached | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cached | null;
    // A cached result describes the version that was running when it was made.
    if (cached && typeof cached.checkedAt === "number" && cached.result?.current === current) return cached;
  } catch { /* per-device cache only */ }
  return undefined;
}

function writeCache(result: UpdateCheck) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), result } satisfies Cached)); } catch { /* best effort */ }
}

export const appVersionQuery = {
  queryKey: ["app-version"],
  queryFn: () => getVersion(),
  staleTime: Infinity,
  gcTime: Infinity,
} as const;

/** The running version, and the latest GitHub release compared with it. */
export function useAppUpdate() {
  const version = useQuery(appVersionQuery);
  const cached = version.data ? readCache(version.data) : undefined;
  const update = useQuery({
    queryKey: ["app-update", version.data],
    queryFn: async () => {
      const result = await checkForUpdate(version.data!, detectPlatform(navigator.userAgent));
      writeCache(result);
      return result;
    },
    enabled: Boolean(version.data),
    initialData: cached?.result,
    initialDataUpdatedAt: cached?.checkedAt,
    staleTime: UPDATE_CHECK_INTERVAL_MS,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { version: version.data, update };
}

/** Whether a newer release is known, for the nav badge. Mounted with the app
 *  shell, so this is also the background check (at most every 12 hours). */
export function useUpdateAvailable() {
  const { update } = useAppUpdate();
  return update.data?.status === "available";
}
