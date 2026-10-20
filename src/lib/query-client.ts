import { QueryClient } from "@tanstack/react-query";

/** A rate-limited request must not be retried: AniList answers a 429 with a
 *  one-minute timeout, and every extra request during it is wasted. */
export function shouldRetry(failureCount: number, error: unknown) {
  return failureCount < 1 && !/429|rate.?limit|too many requests/i.test(String(error instanceof Error ? error.message : error));
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — data stays fresh across route changes
      gcTime: 10 * 60 * 1000, // 10 min — cache kept after unmount
      refetchOnWindowFocus: false,
      retry: shouldRetry,
    },
  },
});
