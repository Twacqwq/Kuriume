import { getInstallState, subscribeInstall, type InstallState } from "@/lib/update-installer";
import { useSyncExternalStore } from "react";

/** The in-app update in progress, shared by every screen that offers it. */
export function useUpdateInstall(): InstallState {
  return useSyncExternalStore(subscribeInstall, getInstallState, getInstallState);
}
