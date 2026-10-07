import type { DisplayLanguage } from "@/lib/store";

// Title visibility owns this query's lifecycle. Route loaders must never share
// its observer key, because unmounting a title cancels its pending request.
export function storedTitleQueryKey(id: string, language: DisplayLanguage) {
  return ["stored-title", id, language] as const;
}
