import { createFileRoute, useRouter } from "@tanstack/react-router";
import { settingsApi, cacheApi, type Settings } from "@/lib/store";
import { formatBytes } from "@/lib/torrent";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  FolderOpen,
  HardDrive,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;
    settingsApi.get().then((s) => { if (!cancelled) setSettings(s); });
    cacheApi.totalSize()
      .then((n) => { if (!cancelled) setCacheSize(n); })
      .catch(() => { if (!cancelled) setCacheSize(0); });
    return () => { cancelled = true; };
  }, []);

  const toggleCache = useCallback(async () => {
    if (!settings) return;
    const next = !settings.cache_enabled;
    await settingsApi.setCacheEnabled(next);
    setSettings((s) => (s ? { ...s, cache_enabled: next } : s));
  }, [settings]);

  const selectCacheDir = useCallback(async () => {
    // Use prompt-based approach since we don't have tauri dialog plugin
    const dir = window.prompt(
      "输入新的缓存目录路径",
      settings?.cache_dir ?? "",
    );
    if (!dir) return;
    await settingsApi.setCacheDir(dir);
    setSettings((s) => (s ? { ...s, cache_dir: dir } : s));
  }, [settings]);

  const clearCache = useCallback(async () => {
    if (!window.confirm("确定清除所有缓存？此操作不可撤销。")) return;
    setClearing(true);
    try {
      await cacheApi.clearAll();
      setCacheSize(0);
    } finally {
      setClearing(false);
    }
  }, []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/6 bg-background/80 px-8 py-4 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.history.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-bold text-foreground">设置</h1>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
        {/* ── Cache section ── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">缓存</h2>
          <p className="text-sm text-muted-foreground">
            启用后，播放过的视频会保存到本地。再次播放同一集时直接从本地读取，无需重新下载。
            文件按 Jellyfin 刮削格式组织，可直接被媒体服务器识别。
          </p>

          {settings && (
            <div className="space-y-3">
              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-xl bg-card/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  {settings.cache_enabled ? (
                    <ToggleRight size={20} className="text-primary" />
                  ) : (
                    <ToggleLeft size={20} className="text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      启用视频缓存
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {settings.cache_enabled ? "已启用" : "已禁用"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleCache}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    settings.cache_enabled ? "bg-primary" : "bg-white/15"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      settings.cache_enabled ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>

              {/* Cache directory */}
              <div className="flex items-center justify-between rounded-xl bg-card/50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FolderOpen size={20} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      缓存目录
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {settings.cache_dir}
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={selectCacheDir}
                  className="shrink-0"
                >
                  更改
                </Button>
              </div>

              {/* Cache size & clear */}
              <div className="flex items-center justify-between rounded-xl bg-card/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <HardDrive size={20} className="text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      已用空间
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cacheSize === null ? "计算中..." : formatBytes(cacheSize)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={clearCache}
                  disabled={clearing || cacheSize === 0}
                  className="gap-1.5"
                >
                  <Trash2 size={14} />
                  {clearing ? "清除中..." : "清除缓存"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Placeholder for future settings */}
        <section className="space-y-4 opacity-40">
          <h2 className="text-lg font-semibold text-foreground">播放器</h2>
          <p className="text-sm text-muted-foreground">即将推出</p>
        </section>
      </div>
    </div>
  );
}
