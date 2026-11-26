import type { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { CATALOG_KEYS } from "@/lib/catalog-queries";

/** How an imported file meets what is already saved on this device. */
export type RecordsImportMode = "merge" | "overwrite";

export interface RecordCounts {
  items: number;
  library: number;
  history: number;
  bindings: number;
}

export interface RecordsExportOutcome {
  counts: RecordCounts;
  bytes: number;
  /** Android: relative path of the copy saved under Download/Kuriume. */
  saved_to?: string;
}

/** What the import dialog shows before the user confirms. */
export interface RecordsImportPreview {
  format_version: number;
  schema_version: number;
  app_version: string;
  exported_at: string;
  device_id: string;
  records_included: boolean;
  settings_included: boolean;
  items: number;
  library: number;
  history: number;
  bindings: number;
  file_counts: RecordCounts;
}

export interface RecordsImportSummary {
  written: number;
  skipped: number;
  skipped_no_identity: number;
  fixed_timestamps: number;
  merged_items: number;
  unknown_sources: number;
  library: number;
  history: number;
  bindings: number;
}

export interface RecordsImportOutcome {
  summary: RecordsImportSummary;
  /** The database snapshot taken before an overwrite import. */
  backup: string | null;
}

export const recordsApi = {
  export: (path: string, includeRecords: boolean, includeSettings: boolean) =>
    invoke<RecordsExportOutcome>("records_export", { path, includeRecords, includeSettings }),
  preview: (path: string) => invoke<RecordsImportPreview>("records_import_preview", { path }),
  import: (path: string, mode: RecordsImportMode) =>
    invoke<RecordsImportOutcome>("records_import", { path, mode }),
  /** Mobile: saves a copy to Download/Kuriume, then opens the system share sheet. */
  exportShare: (includeRecords: boolean, includeSettings: boolean) =>
    invoke<RecordsExportOutcome>("records_export_share", { includeRecords, includeSettings }),
  /** Mobile: copies a picked document URI into the app cache and returns its path. */
  copyImport: (uri: string) => invoke<string>("records_copy_import", { uri }),
};

/** Keys that must be dropped after records or settings changed on disk. */
const RECORD_KEYS = new Set(["library-entry", "history-entry", "source-bindings"]);

export async function invalidateAfterRecordsChange(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: ["settings"] });
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const key = String(query.queryKey[0]);
      return CATALOG_KEYS.has(key) || RECORD_KEYS.has(key);
    },
  });
}

/** "kuriume-records-20260102-030405.json" for the save dialog. */
export function recordsFileName(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `kuriume-records-${day}-${time}.json`;
}
