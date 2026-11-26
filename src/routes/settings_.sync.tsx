import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SettingRow, SettingsFeedback, SettingsGroup } from "@/components/settings-rows";
import { showToast } from "@/components/toast";
import { Switch } from "@/components/ui/switch";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import {
  invalidateAfterSync,
  syncApi,
  syncConfigQueryOptions,
  type SettingsAuthority,
  type SyncConfigView,
  type SyncOutcome,
  type SyncStatusValue,
} from "@/lib/sync";
import { describeSyncFailure, describeSyncOutcome, messageFromReason } from "@/lib/sync-messages";
import { recordsFeaturesHidden } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRightLeft, Cloud, FolderOpen, KeyRound, Loader2, RefreshCw, Server, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/settings_/sync")({
  beforeLoad: () => {
    if (recordsFeaturesHidden) throw redirect({ to: "/settings", replace: true });
  },
  component: SyncPage,
});

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
      showToast("success", zh ? "保存成功" : "Settings saved", zh ? "同步设置已保存" : "Sync settings saved");
    } catch (reason) {
      const title = zh ? "保存失败" : "Could not save";
      const message = describeSyncFailure(reason, zh, title);
      showToast("error", title, message === title ? undefined : message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const probe = await syncApi.test();
      const message = probe.exists
        ? zh
          ? `连接正常，云端已有同步文件${probe.length ? `（${formatBytes(probe.length)}）` : ""}。`
          : `Connection works; the remote file is there${probe.length ? ` (${formatBytes(probe.length)})` : ""}.`
        : zh
          ? "连接正常，云端还没有同步文件，第一次同步会创建它。"
          : "Connection works; the first sync will create the remote file.";
      showToast("success", zh ? "连接成功" : "Connection works", message);
    } catch (reason) {
      const title = zh ? "连接失败" : "Connection failed";
      const message = describeSyncFailure(reason, zh, title);
      showToast("error", title, message === title ? undefined : message);
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


      {isLoading ? (
        <div className="mt-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" aria-hidden="true" /></div>
      ) : !config || !form ? (
        <div className="mt-8 flex flex-col items-start gap-3">
          <SettingsFeedback feedback={{ kind: "error", message: messageFromReason(loadError, zh ? "无法读取同步设置" : "Could not load sync settings") }} />
          <Button type="button" variant="outline" onClick={() => void refetch()}>{zh ? "重试" : "Retry"}</Button>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <SettingsGroup title={zh ? "服务器" : "Server"}>
            <SettingRow icon={<Server />} label={zh ? "服务器地址" : "Server address"} htmlFor="sync-server" stackOnMobile>
              <Input
                id="sync-server"
                className="h-12 w-full border-0 bg-secondary/60 sm:max-w-64"
                inputMode="url"
                autoComplete="off"
                placeholder="https://dav.example.com/dav/"
                value={form.server_url}
                disabled={saving}
                onChange={(event) => update({ server_url: event.target.value })}
              />
            </SettingRow>
            <SettingRow icon={<UserRound />} label={zh ? "用户名" : "Username"} htmlFor="sync-username" stackOnMobile>
              <Input
                id="sync-username"
                className="h-12 w-full border-0 bg-secondary/60 sm:max-w-64"
                autoComplete="username"
                value={form.username}
                disabled={saving}
                onChange={(event) => update({ username: event.target.value })}
              />
            </SettingRow>
            <SettingRow icon={<KeyRound />} label={zh ? "密码" : "Password"} htmlFor="sync-password" stackOnMobile>
              <Input
                id="sync-password"
                type="password"
                className="h-12 w-full border-0 bg-secondary/60 sm:max-w-64"
                autoComplete="current-password"
                placeholder={config.has_password ? (zh ? "已保存，留空不修改" : "Saved; leave empty to keep") : zh ? "请输入密码" : "Enter the password"}
                value={form.password}
                disabled={saving}
                onChange={(event) => update({ password: event.target.value })}
              />
            </SettingRow>
            <SettingRow icon={<FolderOpen />} label={zh ? "远程文件路径" : "Remote file path"} htmlFor="sync-path" stackOnMobile>
              <Input
                id="sync-path"
                className="h-12 w-full border-0 bg-secondary/60 sm:max-w-64"
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
                ? "打开应用时从云端拉取记录，关闭应用时把本机记录推到云端；"
                : "Opening the app pulls records from the cloud; closing pushes local records up."}
            </p>
            <div className="px-4 pb-3 pt-3">
              <p className="mb-2 text-sm font-medium text-foreground">{zh ? "应用设置自动同步方向" : "App settings sync direction"}</p>
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
      showToast("success", zh ? "同步成功" : "Sync complete", describeSyncOutcome(result, zh));
      await invalidateAfterSync(queryClient);
    } catch (reason) {
      const title = zh ? "同步失败" : "Sync failed";
      const message = describeSyncFailure(reason, zh, title);
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
            <SettingsFeedback feedback={{ kind: "success", message: describeSyncOutcome(outcome, zh) }} />
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
