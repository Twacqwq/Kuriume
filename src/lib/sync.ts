import type { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { invalidateAfterRecordsChange } from "@/lib/records";

/** Which device wins when the settings block differs. */
export type SettingsAuthority = "cloud" | "local";

export type SyncStatusValue = "never" | "ok" | "failed" | "corrupt" | "busy" | "need_password";

export interface SyncConfigView {
  server_url: string;
  username: string;
  remote_path: string;
  auto_sync: boolean;
  sync_settings: boolean;
  settings_authority: SettingsAuthority;
  device_id: string;
  last_synced_at: string | null;
  last_etag: string | null;
  last_status: SyncStatusValue;
  last_error: string | null;
  has_password: boolean;
}

/** Only sent to the backend; the password never comes back. */
export interface SyncConfigInput {
  server_url: string;
  username: string;
  remote_path: string;
  auto_sync: boolean;
  sync_settings: boolean;
  settings_authority: SettingsAuthority;
  password?: string;
}

export interface SyncTestResult {
  exists: boolean;
  etag: string | null;
  last_modified: string | null;
  length: number | null;
}

export interface SyncOutcome {
  written: number;
  skipped: number;
  skipped_no_identity: number;
  fixed_timestamps: number;
  merged_items: number;
  unknown_sources: number;
  uploaded: boolean;
  skipped_download: boolean;
  note: string | null;
  backup: string | null;
  etag: string | null;
}

/** Shape of every rejected sync command. */
export interface SyncFailure {
  code: string;
  message: string;
  phase: string;
}

export function isSyncFailure(reason: unknown): reason is SyncFailure {
  return (
    typeof reason === "object" &&
    reason !== null &&
    typeof (reason as SyncFailure).code === "string" &&
    typeof (reason as SyncFailure).message === "string"
  );
}

export const syncApi = {
  get: () => invoke<SyncConfigView>("sync_config_get"),
  save: (config: SyncConfigInput) => invoke<SyncConfigView>("sync_config_save", { config }),
  test: () => invoke<SyncTestResult>("sync_test_connection"),
  now: (authority: SettingsAuthority, remember: boolean, includeSettings: boolean) =>
    invoke<SyncOutcome>("sync_now", { authority, remember, includeSettings }),
  status: () => invoke<SyncConfigView>("sync_status"),
  onOpen: () => invoke<SyncOutcome>("sync_on_open"),
  backgroundPush: () => invoke<SyncOutcome>("sync_background_push"),
};

export const syncConfigQueryOptions = {
  queryKey: ["sync-config"] as const,
  queryFn: syncApi.get,
  staleTime: Infinity,
  gcTime: Infinity,
};

/** A finished sync may have changed records and settings; reload them. */
export async function invalidateAfterSync(queryClient: QueryClient) {
  await invalidateAfterRecordsChange(queryClient);
  await queryClient.invalidateQueries({ queryKey: syncConfigQueryOptions.queryKey });
}
