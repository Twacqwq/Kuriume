import { DEFAULT_DISPLAY_LANGUAGE, settingsQueryOptions, type DisplayLanguage } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";

export function useDisplayLanguage(): DisplayLanguage {
  const { data } = useQuery(settingsQueryOptions);
  return data?.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
}
