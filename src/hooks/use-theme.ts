import { useSyncExternalStore } from "react";
import { readTheme, subscribeTheme, type ThemeId } from "@/lib/theme";

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribeTheme, readTheme, readTheme);
}
