import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SettingRow, SettingsFeedback, SettingsGroup } from "@/components/settings-rows";
import { Switch } from "@/components/ui/switch";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import {
  invalidateAfterSync,
  isSyncFailure,
  syncApi,
  syncConfigQueryOptions,
  type SettingsAuthority,
  type SyncConfigView,
  type SyncOutcome,
  type SyncStatusValue,
} from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRightLeft, Cloud, FolderOpen, KeyRound, Loader2, RefreshCw, Server, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/settings_/sync")({
  component: SyncPage,
});

type Feedback = { kind: "success" | "error"; message: string } | null;

interface SyncForm {
  server_url: string;
  username: string;
  remote_path: string;
  auto_sync: boolean;
  sync_settings: boolean;
  settings_authority: SettingsAuthority;
  password: string;
}

const DEFAULT_REMOTE_PATH = "/kuriume/records.json";

function toForm(config: SyncConfigView): SyncForm {
  return {
    server_url: config.server_url,
    username: config.username,
    remote_path: config.remote_path || DEFAULT_REMOTE_PATH,
    auto_sync: config.auto_sync,
    sync_settings: config.sync_settings,
    settings_authority: config.settings_authority,
    password: "",
  };
}

function SyncPage() {
  const zh = useDisplayLanguage() === "zh";
  const queryClient = useQueryClient();
  const { data: config, isLoading, error: loadError, refetch } = useQuery(syncConfigQueryOptions);
  const [form, setForm] = useState<SyncForm | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    if (config) setForm(toForm(config));
  }, [config]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void listen<SyncOutcome>("sync:applied", () => {
      void invalidateAfterSync(queryClient);
    }).then((unlisten) => {
      stop = unlisten;
    });
    return () => stop?.();
  }, [queryClient]);

  const update = (patch: Partial<SyncForm>) => setForm((current) => (current ? { ...current, ...patch } : current));

  const dirty =
    form !== null &&
    config !== undefined &&
    (form.server_url !== config.server_url ||
      form.username !== config.username ||
      form.remote_path !== config.remote_path ||
      form.auto_sync !== config.auto_sync ||
      form.sync_settings !== config.sync_settings ||
      form.settings_authority !== config.settings_authority ||
      form.password !== "");

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await syncApi.save({
        server_url: form.server_url,
        username: form.username,
        remote_path: form.remote_path,
        auto_sync: form.auto_sync,
        sync_settings: form.sync_settings,
        settings_authority: form.settings_authority,
        password: form.password || undefined,
      });
      queryClient.setQueryData(syncConfigQueryOptions.queryKey, saved);
      setForm(toForm(saved));
      setFeedback({ kind: "success", message: zh ? "同步设置已保存" : "Sync settings saved" });
    } catch (reason) {
      setFeedback({ kind: "error", message: describeFailure(reason, zh, zh ? "保存失败" : "Could not save") });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const probe = await syncApi.test();
      setFeedback({
        kind: "success",
        message: probe.exists
          ? zh
            ? `连接正常，云端已有同步文件${probe.length ? `（${formatBytes(probe.length)}）` : ""}。`
            : `Connection works; the remote file is there${probe.length ? ` (${formatBytes(probe.length)})` : ""}.`
          : zh
            ? "连接正常，云端还没有同步文件，第一次同步会创建它。"
            : "Connection works; the first sync will create the remote file.",
      });
    } catch (reason) {
      setFeedback({ kind: "error", message: describeFailure(reason, zh, zh ? "连接失败" : "Connection failed") });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto min-h-full max-w-3xl px-4 pb-8 pt-4 md:px-6 md:pb-24 md:pt-14 lg:px-10">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="size-12 shrink-0">
          <Link to="/settings" aria-label={zh ? "返回设置" : "Back to settings"}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{zh ? "WebDAV 同步" : "WebDAV sync"}</h1>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {zh
          ? "记录按时间合并；应用设置按你选择的方向覆盖。密码保存在系统的凭据管理器中，不写进数据库。只支持 HTTPS 与 HTTP Basic 认证。"
          : "Records merge by timestamp; app settings follow the direction you pick. The password lives in the system credential store, never in the database. HTTPS and HTTP Basic auth only."}
      </p>

      {feedback && <div className="mt-4"><SettingsFeedback feedback={feedback} /></div>}

      {isLoading ? (
        <div className="mt-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" aria-hidden="true" /></div>
      ) : !config || !form ? (
        <div className="mt-8 flex flex-col items-start gap-3">
          <SettingsFeedback feedback={{ kind: "error", message: toMessage(loadError, zh ? "无法读取同步设置" : "Could not load sync settings") }} />
          <Button type="button" variant="outline" onClick={() => void refetch()}>{zh ? "重试" : "Retry"}</Button>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <SettingsGroup title={zh ? "服务器" : "Server"}>
            <SettingRow icon={<Server />} label={zh ? "服务器地址" : "Server address"} htmlFor="sync-server">
              <Input
                id="sync-server"
                className="h-12 w-full max-w-64 border-0 bg-secondary/60"
                inputMode="url"
                autoComplete="off"
                placeholder="https://dav.example.com/dav/"
                value={form.server_url}
                disabled={saving}
                onChange={(event) => update({ server_url: event.target.value })}
              />
            </SettingRow>
            <SettingRow icon={<UserRound />} label={zh ? "用户名" : "Username"} htmlFor="sync-username">
              <Input
                id="sync-username"
                className="h-12 w-full max-w-64 border-0 bg-secondary/60"
                autoComplete="username"
                value={form.username}
                disabled={saving}
                onChange={(event) => update({ username: event.target.value })}
              />
            </SettingRow>
            <SettingRow icon={<KeyRound />} label={zh ? "密码" : "Password"} htmlFor="sync-password">
              <Input
                id="sync-password"
                type="password"
                className="h-12 w-full max-w-64 border-0 bg-secondary/60"
                autoComplete="current-password"
                placeholder={config.has_password ? (zh ? "已保存，留空不修改" : "Saved; leave empty to keep") : zh ? "请输入密码" : "Enter the password"}
                value={form.password}
                disabled={saving}
                onChange={(event) => update({ password: event.target.value })}
              />
            </SettingRow>
            <SettingRow icon={<FolderOpen />} label={zh ? "远程文件路径" : "Remote file path"} htmlFor="sync-path">
              <Input
                id="sync-path"
                className="h-12 w-full max-w-64 border-0 bg-secondary/60"
                autoComplete="off"
                placeholder={DEFAULT_REMOTE_PATH}
                value={form.remote_path}
                disabled={saving}
                onChange={(event) => update({ remote_path: event.target.value })}
              />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title={zh ? "同步方式" : "How it syncs"}>
            <SettingRow icon={<RefreshCw />} label={zh ? "自动同步" : "Automatic sync"} htmlFor="sync-auto">
              <Switch
                id="sync-auto"
                checked={form.auto_sync}
                disabled={saving}
                onCheckedChange={(checked) => update({ auto_sync: checked })}
              />
            </SettingRow>
            <SettingRow icon={<Cloud />} label={zh ? "同时同步应用设置" : "Sync app settings too"} htmlFor="sync-settings">
              <Switch
                id="sync-settings"
                checked={form.sync_settings}
                disabled={saving}
                onCheckedChange={(checked) => update({ sync_settings: checked })}
              />
            </SettingRow>
            <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {zh
                ? "打开应用时从云端拉取记录，关闭应用时把本机记录推到云端；设置方向在手动同步时选择，也可以记住选择。"
                : "Opening the app pulls records from the cloud; closing pushes local records up. Pick the settings direction each time you sync manually, or remember it."}
            </p>
            <div className="px-4 pb-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{zh ? "设置方向" : "Settings direction"}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <DirectionButton
                  selected={form.settings_authority === "cloud"}
                  title={zh ? "云端覆盖本机" : "Cloud wins"}
                  detail={zh ? "应用设置以云端文件为准" : "App settings come from the cloud file"}
                  disabled={saving}
                  onSelect={() => update({ settings_authority: "cloud" })}
                />
                <DirectionButton
                  selected={form.settings_authority === "local"}
                  title={zh ? "本机覆盖云端" : "This device wins"}
                  detail={zh ? "应用设置以本机为准" : "App settings come from this device"}
                  disabled={saving}
                  onSelect={() => update({ settings_authority: "local" })}
                />
              </div>
            </div>
          </SettingsGroup>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              {zh ? "保存设置" : "Save settings"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void test()} disabled={testing || !config.has_password}>
              {testing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Server aria-hidden="true" />}
              {zh ? "测试连接" : "Test connection"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setManualOpen(true)} disabled={!config.has_password}>
              <ArrowRightLeft aria-hidden="true" />
              {zh ? "立即同步" : "Sync now"}
            </Button>
          </div>

          <SettingsGroup title={zh ? "上次同步" : "Last sync"}>
            <div className="px-4 py-3 text-sm">
              <p className="font-medium">{statusText(config.last_status, zh)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {config.last_synced_at ? (zh ? `时间 ${config.last_synced_at}` : `At ${config.last_synced_at}`) : zh ? "还没有同步过" : "Never synced"}
              </p>
              {config.last_error && <p className="mt-2 break-words text-xs text-muted-foreground">{config.last_error}</p>}
              {config.device_id && (
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  {zh ? "设备标识" : "Device ID"} {config.device_id}
                </p>
              )}
            </div>
          </SettingsGroup>
        </div>
      )}

      {config && form && (
        <ManualSyncDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          zh={zh}
          config={config}
          defaultAuthority={form.settings_authority}
        />
      )}
    </div>
  );
}

function ManualSyncDialog({
  open,
  onOpenChange,
  zh,
  config,
  defaultAuthority,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zh: boolean;
  config: SyncConfigView;
  defaultAuthority: SettingsAuthority;
}) {
  const queryClient = useQueryClient();
  const [authority, setAuthority] = useState<SettingsAuthority>(defaultAuthority);
  const [remember, setRemember] = useState(false);
  const [includeSettings, setIncludeSettings] = useState(config.sync_settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const reset = () => {
    setAuthority(defaultAuthority);
    setRemember(false);
    setIncludeSettings(config.sync_settings);
    setBusy(false);
    setError(null);
    setOutcome(null);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await syncApi.now(authority, remember, includeSettings);
      setOutcome(result);
      await invalidateAfterSync(queryClient);
    } catch (reason) {
      setError(describeFailure(reason, zh, zh ? "同步失败" : "Sync failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{zh ? "立即同步" : "Sync now"}</DialogTitle>
          <DialogDescription>
            {zh
              ? "记录始终按时间合并；下面的方向只决定应用设置以哪边为准。"
              : "Records always merge by timestamp; the direction below only decides which settings win."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          <DirectionButton
            selected={authority === "cloud"}
            title={zh ? "云端覆盖本机" : "Cloud wins"}
            detail={zh ? "应用设置以云端文件为准" : "App settings come from the cloud file"}
            disabled={busy}
            onSelect={() => setAuthority("cloud")}
          />
          <DirectionButton
            selected={authority === "local"}
            title={zh ? "本机覆盖云端" : "This device wins"}
            detail={zh ? "应用设置以本机为准" : "App settings come from this device"}
            disabled={busy}
            onSelect={() => setAuthority("local")}
          />
        </div>

        <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2 text-sm">
          <span>{zh ? "记住这次选择" : "Remember this choice"}</span>
          <Switch checked={remember} onCheckedChange={setRemember} disabled={busy} />
        </label>

        {config.sync_settings && (
          <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2 text-sm">
            <span>{zh ? "同时同步应用设置" : "Sync app settings too"}</span>
            <Switch checked={includeSettings} onCheckedChange={setIncludeSettings} disabled={busy} />
          </label>
        )}

        {error && <SettingsFeedback feedback={{ kind: "error", message: error }} />}
        {outcome && (
          <div className="space-y-1">
            <SettingsFeedback feedback={{ kind: "success", message: describeOutcome(outcome, zh) }} />
            {outcome.backup && (
              <p className="break-all text-xs text-muted-foreground">
                {zh ? "同步前的备份" : "Backup before syncing"} {outcome.backup}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
            {outcome ? (zh ? "关闭" : "Close") : zh ? "取消" : "Cancel"}
          </Button>
          <Button type="button" onClick={() => void run()} disabled={busy || Boolean(outcome)}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {zh ? "开始同步" : "Sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectionButton({
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

function statusText(status: SyncStatusValue, zh: boolean) {
  switch (status) {
    case "ok":
      return zh ? "上次同步成功" : "Last sync succeeded";
    case "failed":
      return zh ? "上次同步失败" : "Last sync failed";
    case "corrupt":
      return zh ? "云端文件无法读取，已停止同步" : "Remote file unreadable; syncing stopped";
    case "busy":
      return zh ? "已有同步在进行" : "Another sync is running";
    case "need_password":
      return zh ? "需要重新输入密码" : "The password needs to be entered again";
    default:
      return zh ? "还没有同步过" : "Never synced";
  }
}

function describeOutcome(outcome: SyncOutcome, zh: boolean) {
  const parts: string[] = [];
  if (outcome.uploaded) parts.push(zh ? "已上传本机记录" : "uploaded local records");
  if (outcome.skipped_download) parts.push(zh ? "云端没有记录，未下载" : "nothing downloaded");
  if (outcome.written > 0) parts.push(zh ? `合并 ${outcome.written} 部作品` : `merged ${outcome.written} works`);
  if (outcome.note) parts.push(noteText(outcome.note, zh));
  if (parts.length === 0) parts.push(zh ? "同步完成" : "sync finished");
  return parts.join(zh ? "，" : ", ");
}

function noteText(note: string, zh: boolean) {
  switch (note) {
    case "no_etag":
      return zh ? "服务器没有提供 ETag，关闭应用时不会快速推送" : "the server sent no ETag, so closing will not fast-push";
    case "weak_etag":
      return zh ? "服务器只提供弱 ETag，已按完整流程同步" : "only a weak ETag was available; the full round-trip ran";
    case "auto_disabled":
      return zh ? "自动同步没有开启" : "automatic sync is off";
    case "recent":
      return zh ? "5 分钟内刚同步过，已跳过" : "already synced within 5 minutes";
    default:
      return note;
  }
}

function describeFailure(reason: unknown, zh: boolean, fallback: string) {
  if (!isSyncFailure(reason)) return toMessage(reason, fallback);
  const text = {
    config_missing: zh ? "还没有填写服务器地址" : "No sync server is configured yet.",
    need_password: zh ? "需要重新输入密码" : "Enter the password again.",
    not_https: zh ? "只支持以 https:// 开头的地址" : "Only HTTPS addresses are supported.",
    invalid_url: zh ? "服务器地址无效" : "The server address is not valid.",
    invalid_path: zh ? "远程路径必须以 / 开头，且不能包含 .. 或 //" : "The remote path must start with / and must not contain .. or //.",
    auth: zh ? "用户名或密码被拒绝（401）" : "The username or password was rejected (401).",
    forbidden: zh ? "服务器拒绝访问（403）" : "The server refused access (403).",
    not_found: zh ? "远程地址不存在（404）" : "The remote address does not exist (404).",
    mkcol_failed: zh ? "无法创建远程文件夹" : "The remote folder could not be created.",
    conflict: zh ? "云端文件在另一台设备上被改动过，请重试" : "The file changed on another device; retry.",
    too_large: zh ? "云端文件超过 32 MB" : "The remote file is larger than 32 MB.",
    corrupt: zh ? "云端文件不是 Kuriume 记录文件，未改动本机数据" : "The remote file is not a Kuriume records file; nothing changed.",
    schema_too_new: zh ? "云端文件来自更新版本的 Kuriume" : "The remote file comes from a newer Kuriume.",
    insufficient_storage: zh ? "服务器空间不足（507）" : "The server is out of space (507).",
    redirect: zh ? "服务器返回了重定向，请检查地址" : "The server returned a redirect; check the address.",
    tls: zh ? "TLS 证书校验失败" : "The TLS certificate was rejected.",
    timeout: zh ? "同步超时" : "The sync ran out of time.",
    busy: zh ? "已有同步在进行" : "A sync is already running.",
    keyring: zh ? "系统凭据管理器不可用" : "The system credential store is unavailable.",
    unsupported_platform: zh ? "这个平台暂不支持同步" : "Sync is not supported on this platform yet.",
    server: zh ? "服务器返回错误" : "The server returned an error.",
    network: zh ? "无法连接到服务器" : "The server could not be reached.",
    internal: zh ? "同步出现内部错误" : "The sync failed unexpectedly.",
  } as Record<string, string>;
  return text[reason.code] ?? (reason.message || fallback);
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
