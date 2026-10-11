import { DEFAULT_DISPLAY_LANGUAGE, settingsApi, type DisplayLanguage } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";

export const settingsQueryOptions = {
  queryKey: ["settings"] as const,
  queryFn: settingsApi.get,
  staleTime: Infinity,
};

export function useDisplayLanguage(): DisplayLanguage {
  const { data } = useQuery(settingsQueryOptions);
  return data?.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
}
