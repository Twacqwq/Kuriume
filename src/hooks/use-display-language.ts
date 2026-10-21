import { DEFAULT_CATALOG_SOURCE, DEFAULT_DISPLAY_LANGUAGE, settingsQueryOptions, type CatalogSource, type DisplayLanguage } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";

export function useDisplayLanguage(): DisplayLanguage {
  const { data } = useQuery(settingsQueryOptions);
  return data?.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
}

/** The catalog for browsing, search and the schedule (我的 › 显示 › 数据源). */
export function useCatalogSource(): CatalogSource {
  const { data } = useQuery(settingsQueryOptions);
  return data?.catalog_source ?? DEFAULT_CATALOG_SOURCE;
}
