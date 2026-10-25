import { Channel, invoke } from "@tauri-apps/api/core";
import type { UpdateCheck, UpdatePlatform } from "@/lib/app-update";

/**
 * In-app updates (src-tauri/src/app_update.rs): desktop installs the signed
 * bundle from latest.json, Android hands the release APK to the system
 * installer. iOS keeps opening the release page. One install at a time,
 * shared by the home-page prompt and 我的 › 关于.
 */
export type InstallState =
  | { phase: "idle" }
  | { phase: "downloading"; version: string; downloaded: number; total: number | null }
  | { phase: "installing"; version: string }
  /** Desktop: installed, takes effect after a restart. */
  | { phase: "restart"; version: string }
  /** Android: the system installer is showing. */
  | { phase: "installer"; version: string }
  | { phase: "error"; version: string; reason: InstallFailure; message: string };

/**
 * unavailable: this release has no in-app package (no latest.json, or no
 * updater key in this build) — download it from the release page instead.
 * permission: Android needs "install unknown apps" for Kuriume; the settings
 * page has been opened.
 */
export type InstallFailure = "unavailable" | "permission" | "failed";

type Progress = { stage: "downloading"; downloaded: number; total: number | null } | { stage: "installing" };
type Available = Extract<UpdateCheck, { status: "available" }>;
type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;
type ChannelLike<T> = { onmessage: (message: T) => void };

export function supportsInAppUpdate(platform: UpdatePlatform): boolean {
  return platform === "macos" || platform === "windows" || platform === "android";
}

let state: InstallState = { phase: "idle" };
const listeners = new Set<() => void>();

function set(next: InstallState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getInstallState(): InstallState {
  return state;
}

export function failureReason(message: string): InstallFailure {
  if (message.includes("INSTALL_PERMISSION_REQUIRED")) return "permission";
  if (message.includes("UPDATE_UNAVAILABLE")) return "unavailable";
  return "failed";
}

export function isInstalling(current: InstallState = state): boolean {
  return current.phase === "downloading" || current.phase === "installing";
}

/** Downloads and installs `update`; progress and the result go to the shared state. */
export async function installUpdate(
  update: Available,
  platform: UpdatePlatform,
  invokeImpl: Invoke = invoke,
  createChannel: () => ChannelLike<Progress> = () => new Channel<Progress>(),
): Promise<void> {
  if (isInstalling()) return;
  const version = update.latest;
  const size = update.download?.size ?? null;
  set({ phase: "downloading", version, downloaded: 0, total: size });
  const onProgress = createChannel();
  onProgress.onmessage = (progress) => {
    if (progress.stage === "downloading") set({ phase: "downloading", version, downloaded: progress.downloaded, total: progress.total ?? size });
    else set({ phase: "installing", version });
  };
  const download = platform === "android" ? update.download : null;
  try {
    const outcome = await invokeImpl<"restart" | "installer">("update_install", {
      version,
      package: download ? { url: download.url, sha256: download.sha256 } : null,
      onProgress,
    });
    set({ phase: outcome === "installer" ? "installer" : "restart", version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set({ phase: "error", version, reason: failureReason(message), message });
  }
}

/** Restarts into an installed desktop update. */
export function restartForUpdate(): Promise<void> {
  return invoke("update_restart");
}

export function resetInstall() {
  if (!isInstalling()) set({ phase: "idle" });
}

/** "12.3 / 35.2 MB" */
export function formatProgress(downloaded: number, total: number | null): string {
  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
  return total ? `${mb(downloaded)} / ${mb(total)} MB` : `${mb(downloaded)} MB`;
}
