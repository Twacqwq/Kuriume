import { createFileRoute, useRouter } from "@tanstack/react-router";
import { settingsApi, cacheApi, type Settings } from "@/lib/store";
import { formatBytes } from "@/lib/torrent";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { open } from "@tauri-apps/plugin-dialog";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  FolderOpen,
  HardDrive,
  Loader2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Cpu,
  Database,
  SkipForward,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    if (!settings) return;
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: settings.cache_dir,
      title: "选择缓存目录",
    });
    if (!selected) return;

    const newDir = selected as string;
    if (newDir === settings.cache_dir) return;

    // Ask user whether to migrate existing files
    let shouldMigrate = false;
    if (cacheSize && cacheSize > 0) {
      shouldMigrate = await ask(
        `当前缓存目录有 ${formatBytes(cacheSize)} 的文件，是否将它们迁移到新目录？\n\n选择「是」迁移文件，选择「否」仅更改目录（旧文件保留在原位置）。`,
        { title: "迁移缓存文件", kind: "info", okLabel: "是", cancelLabel: "否" },
      );
    }

    setMigrating(true);
    try {
      await settingsApi.migrateDir(newDir, shouldMigrate);
      setSettings((s) => (s ? { ...s, cache_dir: newDir } : s));
      // Refresh cache size after migration
      const size = await cacheApi.totalSize().catch(() => 0);
      setCacheSize(size);
    } finally {
      setMigrating(false);
    }
  }, [settings, cacheSize]);

  const clearCache = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    clearTimeout(confirmTimerRef.current);
    setClearing(true);
    try {
      await cacheApi.clearAll();
      setCacheSize(0);
    } finally {
      setClearing(false);
    }
  }, [confirmClear]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/6 bg-background/80 px-4 pt-2 pb-4 backdrop-blur-xl md:px-8"
           data-tauri-drag-region
      >
        <button
          type="button"
          onClick={() => router.history.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-bold text-foreground">设置</h1>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 md:px-8 md:py-8">
        {/* ── Cache section ── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">缓存</h2>
          <p className="text-sm text-muted-foreground">
            启用后，播放过的视频会保存到本地。再次播放同一集时直接从本地读取
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
                  disabled={migrating}
                  className="shrink-0"
                >
                  {migrating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      迁移中...
                    </>
                  ) : (
                    "更改"
                  )}
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
                  {clearing
                    ? "清除中..."
                    : confirmClear
                      ? "确认清除？"
                      : "清除缓存"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Player section ── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">播放器</h2>
          <p className="text-sm text-muted-foreground">
            调整播放器的默认行为。更改在下次播放时生效
          </p>

          {settings && (
            <div className="space-y-3">
              {/* Hardware decoding */}
              <div className="flex flex-col gap-3 rounded-xl bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Cpu size={20} className="text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">硬件解码</p>
                    <p className="text-xs text-muted-foreground">
                      使用 GPU 加速视频解码，降低 CPU 占用（默认：自动）
                    </p>
                  </div>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={settings.hwdec}
                  onValueChange={async (value) => {
                    if (!value) return;
                    await settingsApi.setHwdec(value);
                    setSettings((s) => (s ? { ...s, hwdec: value } : s));
                  }}
                >
                  <ToggleGroupItem value="auto">自动</ToggleGroupItem>
                  <ToggleGroupItem value="auto-copy">兼容</ToggleGroupItem>
                  <ToggleGroupItem value="no">关闭</ToggleGroupItem>
                </ToggleGroup>
              </div>

              {/* Buffer size */}
              <div className="flex flex-col gap-3 rounded-xl bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Database size={20} className="text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">缓冲大小</p>
                    <p className="text-xs text-muted-foreground">
                      更大的缓冲减少卡顿，但占用更多内存（默认：150 MiB）
                    </p>
                  </div>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={String(settings.buffer_size)}
                  onValueChange={async (value) => {
                    if (!value) return;
                    const size = Number(value);
                    await settingsApi.setBufferSize(size);
                    setSettings((s) => (s ? { ...s, buffer_size: size } : s));
                  }}
                >
                  <ToggleGroupItem value="50">50</ToggleGroupItem>
                  <ToggleGroupItem value="150">150</ToggleGroupItem>
                  <ToggleGroupItem value="300">300</ToggleGroupItem>
                  <ToggleGroupItem value="500">500</ToggleGroupItem>
                </ToggleGroup>
              </div>

              {/* Auto next episode */}
              <div className="flex items-center justify-between rounded-xl bg-card/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  {settings.auto_next ? (
                    <SkipForward size={20} className="text-primary" />
                  ) : (
                    <SkipForward size={20} className="text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">自动播放下一集</p>
                    <p className="text-xs text-muted-foreground">
                      {settings.auto_next ? "已启用" : "已禁用"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !settings.auto_next;
                    await settingsApi.setAutoNext(next);
                    setSettings((s) => (s ? { ...s, auto_next: next } : s));
                  }}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    settings.auto_next ? "bg-primary" : "bg-white/15"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      settings.auto_next ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>

              {/* Anime4K super-resolution */}
              <div className="flex flex-col gap-3 rounded-xl bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles size={20} className={settings.anime4k_mode !== "off" ? "text-primary" : "text-muted-foreground"} />
                  <div>
                    <p className="text-sm font-medium text-foreground">超分辨率 (Anime4K)</p>
                    <p className="text-xs text-muted-foreground">
                      实时画质增强，使用 GPU 后处理着色器。更高模式需要更强的 GPU
                    </p>
                    <p className="text-xs text-muted-foreground/60 md:hidden">
                      移动端已自动使用轻量级着色器
                    </p>
                  </div>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={settings.anime4k_mode}
                  onValueChange={async (value) => {
                    if (!value) return;
                    await settingsApi.setAnime4kMode(value);
                    setSettings((s) => (s ? { ...s, anime4k_mode: value } : s));
                  }}
                >
                  <ToggleGroupItem value="off">关闭</ToggleGroupItem>
                  <ToggleGroupItem value="A">模式 A</ToggleGroupItem>
                  <ToggleGroupItem value="B">模式 B</ToggleGroupItem>
                  <ToggleGroupItem value="C">模式 C</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          )}
        </section>

        {/* ── Trackers section ── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Tracker 列表</h2>
          <p className="text-sm text-muted-foreground">
            自定义 BitTorrent tracker 地址，用于种子发现和下载加速。留空时使用内置默认列表。修改后需重启应用生效
          </p>

          {settings && (
            <div className="space-y-3">
              <div className="rounded-xl bg-card/50 px-4 py-3">
                <textarea
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  rows={8}
                  placeholder={"留空使用默认 tracker 列表，每行一个地址\n例如：\nudp://tracker.opentrackr.org:1337/announce\nhttp://t.nyaatracker.com/announce"}
                  defaultValue={settings.tracker_list.join("\n")}
                  onBlur={async (e) => {
                    const lines = e.target.value
                      .split("\n")
                      .map((l) => l.trim())
                      .filter((l) => l.length > 0);
                    await settingsApi.setTrackerList(lines);
                    setSettings((s) => (s ? { ...s, tracker_list: lines } : s));
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
