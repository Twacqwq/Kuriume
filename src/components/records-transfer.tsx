import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkRow, SettingRow, SettingsFeedback, SettingsGroup } from "@/components/settings-rows";
import { showToast } from "@/components/toast";
import { Switch } from "@/components/ui/switch";
import {
  invalidateAfterRecordsChange,
  recordsApi,
  recordsFileName,
  type RecordCounts,
  type RecordsExportOutcome,
  type RecordsImportMode,
  type RecordsImportOutcome,
  type RecordsImportPreview,
} from "@/lib/records";
import { isMobileApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { Cloud, Download, Loader2, Upload } from "lucide-react";
import { useState } from "react";

const JSON_FILTER = [{ name: "Kuriume records", extensions: ["json"] }];

/** "数据" group: move records and settings to another device through a file. */
export function RecordsGroup({ zh }: { zh: boolean }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <SettingsGroup title={zh ? "数据" : "Data"}>
        <SettingRow icon={<Download />} label={zh ? "导出记录" : "Export records"} htmlFor="records-export">
          <Button id="records-export" type="button" variant="outline" className="min-h-12 shrink-0" onClick={() => setExportOpen(true)}>
            {zh ? "导出" : "Export"}
          </Button>
        </SettingRow>
        <SettingRow icon={<Upload />} label={zh ? "导入记录" : "Import records"} htmlFor="records-import">
          <Button id="records-import" type="button" variant="outline" className="min-h-12 shrink-0" onClick={() => setImportOpen(true)}>
            {zh ? "导入" : "Import"}
          </Button>
        </SettingRow>
        <LinkRow to="/settings/sync" icon={<Cloud />} label={zh ? "WebDAV 同步" : "WebDAV sync"} />
      </SettingsGroup>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} zh={zh} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} zh={zh} />
    </>
  );
}

function ExportDialog({ open, onOpenChange, zh }: { open: boolean; onOpenChange: (open: boolean) => void; zh: boolean }) {
  const [includeRecords, setIncludeRecords] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RecordsExportOutcome | null>(null);

  const reset = () => {
    setBusy(false);
    setError(null);
    setDone(null);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const run = async () => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      if (isMobileApp) {
        // Mobile saves into Download/Kuriume, then opens the system share sheet.
        const outcome = await recordsApi.exportShare(includeRecords, includeSettings);
        setDone(outcome);
        showToast("success", zh ? "导出成功" : "Export complete", exportMessage(outcome, zh));
        return;
      }
      let target: string | null;
      try {
        target = await saveFile({ defaultPath: recordsFileName(), filters: JSON_FILTER });
      } catch (reason) {
        const message = toMessage(reason, zh ? "无法打开保存窗口" : "Could not open the save dialog");
        setError(message);
        showToast("error", zh ? "导出失败" : "Export failed", message);
        return;
      }
      if (!target) return;
      const outcome = await recordsApi.export(target, includeRecords, includeSettings);
      setDone(outcome);
      showToast("success", zh ? "导出成功" : "Export complete", exportMessage(outcome, zh));
    } catch (reason) {
      const message = toMessage(reason, zh ? "导出失败" : "Export failed");
      const title = zh ? "导出失败" : "Export failed";
      setError(message);
      showToast("error", title, message === title ? undefined : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{zh ? "导出记录" : "Export records"}</DialogTitle>
          <DialogDescription>
            {isMobileApp
              ? zh
                ? "选择要导出的内容。文件会保存到手机的 Download/Kuriume 文件夹，然后打开系统分享面板。"
                : "Choose what to export. The file is saved to Download/Kuriume, then the system share sheet opens."
              : zh
                ? "选择要写入文件的内容，之后可以在另一台设备上导入。"
                : "Choose what the file should carry; import it on another device."}
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/60 rounded-xl bg-secondary/40">
          <label className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>{zh ? "追番与观看记录" : "Library and watch history"}</span>
            <Switch checked={includeRecords} onCheckedChange={setIncludeRecords} disabled={busy} />
          </label>
          <label className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>{zh ? "应用设置" : "App settings"}</span>
            <Switch checked={includeSettings} onCheckedChange={setIncludeSettings} disabled={busy} />
          </label>
        </div>
        {error && <SettingsFeedback feedback={{ kind: "error", message: error }} />}
        {done && (
          <SettingsFeedback
            feedback={{
              kind: "success",
              message: exportMessage(done, zh),
            }}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
            {zh ? "关闭" : "Close"}
          </Button>
          <Button type="button" onClick={() => void run()} disabled={busy || (!includeRecords && !includeSettings)}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {zh ? "导出" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange, zh }: { open: boolean; onOpenChange: (open: boolean) => void; zh: boolean }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecordsImportPreview | null>(null);
  const [mode, setMode] = useState<RecordsImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RecordsImportOutcome | null>(null);

  const reset = () => {
    setPath(null);
    setPreview(null);
    setMode("merge");
    setBusy(false);
    setError(null);
    setOutcome(null);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const pick = async () => {
    setError(null);
    setOutcome(null);
    let picked: string | string[] | null;
    try {
      picked = await openFile({
        multiple: false,
        directory: false,
        filters: JSON_FILTER,
        pickerMode: "document",
      });
    } catch (reason) {
      const message = toMessage(reason, zh ? "无法打开文件选择窗口" : "Could not open the file dialog");
      setError(message);
      showToast("error", zh ? "导入失败" : "Import failed", message);
      return;
    }
    if (!picked) return;
    const chosen = Array.isArray(picked) ? picked[0] : picked;
    if (!chosen) return;
    setBusy(true);
    try {
      // Android hands back a content:// URI; copy it into the cache first.
      const local = isMobileApp ? await recordsApi.copyImport(chosen) : chosen;
      setPreview(await recordsApi.preview(local));
      setPath(local);
    } catch (reason) {
      const message = toMessage(reason, zh ? "无法读取这个文件" : "This file cannot be read");
      setPreview(null);
      setPath(null);
      setError(message);
      showToast("error", zh ? "导入失败" : "Import failed", message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordsApi.import(path, mode);
      setOutcome(result);
      showToast("success", zh ? "导入成功" : "Import complete", summaryLine(result, zh));
      await invalidateAfterRecordsChange(queryClient);
    } catch (reason) {
      const message = toMessage(reason, zh ? "导入失败" : "Import failed");
      const title = zh ? "导入失败" : "Import failed";
      setError(message);
      showToast("error", title, message === title ? undefined : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{zh ? "导入记录" : "Import records"}</DialogTitle>
          <DialogDescription>
            {zh ? "先选择一个由 Kuriume 导出的 JSON 文件，确认内容后再导入。" : "Pick a JSON file exported by Kuriume, review it, then import."}
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="flex flex-col gap-3">
            <Button type="button" variant="outline" className="min-h-12" onClick={() => void pick()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
              {zh ? "选择文件" : "Choose file"}
            </Button>
            {path && <p className="break-all text-xs text-muted-foreground">{path}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-secondary/40 px-3 py-3 text-sm">
              <p className="font-medium">{preview.app_version || (zh ? "未知版本" : "Unknown version")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {zh ? "导出时间" : "Exported"} {preview.exported_at || "—"}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {preview.records_included && (
                  <li>
                    {zh
                      ? `${preview.items} 部作品 · ${preview.library} 条追番 · ${preview.history} 条观看记录 · ${preview.bindings} 条片源绑定`
                      : `${preview.items} works · ${preview.library} library · ${preview.history} history · ${preview.bindings} bindings`}
                  </li>
                )}
                <li>{preview.settings_included ? (zh ? "包含应用设置" : "Includes app settings") : (zh ? "不含应用设置" : "No app settings")}</li>
              </ul>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <ModeButton selected={mode === "merge"} title={zh ? "合并" : "Merge"} detail={zh ? "保留本机时间更新的记录，只补上文件里更晚的" : "Keep newer local progress; only take newer rows from the file"} onSelect={() => setMode("merge")} disabled={busy || !preview.records_included} />
              <ModeButton selected={mode === "overwrite"} title={zh ? "用文件替换" : "Replace"} detail={zh ? "先备份本机数据库，再用文件内容替换记录；已识别的作品条目保留" : "Back up the database, then replace records with the file; identified works stay"} onSelect={() => setMode("overwrite")} disabled={busy || !preview.records_included} />
            </div>

            {error && <SettingsFeedback feedback={{ kind: "error", message: error }} />}
            {outcome && (
              <div className="space-y-1">
                <SettingsFeedback feedback={{ kind: "success", message: summaryLine(outcome, zh) }} />
                {outcome.backup && (
                  <p className="break-all text-xs text-muted-foreground">
                    {zh ? "覆盖前的备份" : "Backup before replacing"} {outcome.backup}
                  </p>
                )}
              </div>
            )}

            <Button type="button" variant="ghost" className="self-start px-0" onClick={() => void pick()} disabled={busy}>
              {zh ? "换一个文件" : "Choose another file"}
            </Button>
          </div>
        )}

        {error && !preview && <SettingsFeedback feedback={{ kind: "error", message: error }} />}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
            {outcome ? (zh ? "关闭" : "Close") : zh ? "取消" : "Cancel"}
          </Button>
          <Button type="button" onClick={() => void run()} disabled={busy || !preview || Boolean(outcome)}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {zh ? "导入" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  selected,
  title,
  detail,
  onSelect,
  disabled,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50",
        selected ? "border-primary bg-secondary/60" : "border-border hover:bg-secondary/40",
      )}
    >
      <span className="block font-medium">{title}</span>
      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{detail}</span>
    </button>
  );
}

function countsLine(counts: RecordCounts, zh: boolean) {
  return zh
    ? `${counts.items} 部作品、${counts.library} 条追番、${counts.history} 条观看记录`
    : `${counts.items} works, ${counts.library} library entries, ${counts.history} history rows`;
}

function exportMessage(outcome: RecordsExportOutcome, zh: boolean) {
  const summary = countsLine(outcome.counts, zh);
  if (outcome.saved_to) {
    return zh
      ? `已导出 ${summary}（${formatBytes(outcome.bytes)}），文件保存在 ${outcome.saved_to}。`
      : `Exported ${summary} (${formatBytes(outcome.bytes)}) to ${outcome.saved_to}.`;
  }
  return zh
    ? `已导出 ${summary}，文件 ${formatBytes(outcome.bytes)}。`
    : `Exported ${summary} (${formatBytes(outcome.bytes)}).`;
}

function summaryLine(outcome: RecordsImportOutcome, zh: boolean) {
  const { summary } = outcome;
  const parts = [
    zh ? `导入 ${summary.written} 部作品` : `${summary.written} works imported`,
    zh ? `追番 ${summary.library}` : `library ${summary.library}`,
    zh ? `观看记录 ${summary.history}` : `history ${summary.history}`,
    zh ? `片源绑定 ${summary.bindings}` : `bindings ${summary.bindings}`,
  ];
  if (summary.skipped_no_identity > 0) {
    parts.push(zh ? `${summary.skipped_no_identity} 部缺少目录身份已跳过` : `${summary.skipped_no_identity} skipped without a catalog identity`);
  }
  if (summary.skipped > 0) {
    parts.push(zh ? `${summary.skipped} 部未通过校验已跳过` : `${summary.skipped} skipped by validation`);
  }
  if (summary.merged_items > 0) {
    parts.push(zh ? `${summary.merged_items} 部并入已保存的作品` : `${summary.merged_items} merged into saved works`);
  }
  if (summary.fixed_timestamps > 0) {
    parts.push(zh ? `修正 ${summary.fixed_timestamps} 个未来时间` : `${summary.fixed_timestamps} future timestamps fixed`);
  }
  if (summary.unknown_sources > 0) {
    parts.push(zh ? `${summary.unknown_sources} 个片源本机没有` : `${summary.unknown_sources} unknown sources`);
  }
  return parts.join(zh ? "，" : ", ");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toMessage(reason: unknown, fallback: string) {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return fallback;
}
