import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — data stays fresh across route changes
      gcTime: 10 * 60 * 1000, // 10 min — cache kept after unmount
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
