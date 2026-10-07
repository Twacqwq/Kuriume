import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { settingsQueryOptions } from "@/hooks/use-display-language";
import { refreshCatalogLanguage } from "@/lib/catalog-queries";
import { isMobileApp } from "@/lib/platform";
import {
  settingsApi,
  type DisplayLanguage,
  type Settings,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  Gauge,
  Languages,
  Loader2,
  Radio,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { useRef, useState } from "react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type Feedback = { kind: "success" | "error"; message: string } | null;
type SavingKey = "language" | "volume" | "speed" | "auto-next";

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error, refetch } = useQuery(settingsQueryOptions);
  const [saving, setSaving] = useState<SavingKey | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reloading, setReloading] = useState(false);
  const persistedVolume = useRef<number | null>(null);

  if (settings && persistedVolume.current === null) {
    persistedVolume.current = settings.default_volume;
  }

  const updateSettings = (update: (current: Settings) => Settings) => {
    queryClient.setQueryData<Settings>(settingsQueryOptions.queryKey, (current) =>
      current ? update(current) : current,
    );
  };

  const saveLanguage = async (language: DisplayLanguage) => {
    if (!settings || language === settings.display_language) return;
    const previous = settings.display_language;
    updateSettings((current) => ({ ...current, display_language: language }));
    setSaving("language");
    setFeedback(null);
    try {
      await settingsApi.setDisplayLanguage(language);
    } catch (reason) {
      updateSettings((current) => ({ ...current, display_language: previous }));
      setFeedback({
        kind: "error",
        message: toErrorMessage(reason, "无法更新显示语言"),
      });
      setSaving(null);
      return;
    }
    setSaving(null);
    await reloadCatalog(language);
  };

  const reloadCatalog = async (language: DisplayLanguage) => {
    setReloading(true);
    setFeedback({ kind: "success", message: "正在重新载入动漫列表…" });
    try {
      await refreshCatalogLanguage(language);
      setFeedback({ kind: "success", message: "语言已更新，动漫列表已重新载入" });
    } catch {
      setFeedback({ kind: "error", message: "语言已保存，列表载入失败，请重试" });
    } finally {
      setReloading(false);
    }
  };

  const saveVolume = async (volume: number) => {
    const previous = persistedVolume.current ?? settings?.default_volume ?? 0.8;
    setSaving("volume");
    setFeedback(null);
    try {
      await settingsApi.setDefaultVolume(volume);
      persistedVolume.current = volume;
    } catch (reason) {
      updateSettings((current) => ({ ...current, default_volume: previous }));
      setFeedback({
        kind: "error",
        message: toErrorMessage(reason, "无法保存默认音量"),
      });
    } finally {
      setSaving(null);
    }
  };

  const saveSpeed = async (speed: number) => {
    if (!settings || speed === settings.default_speed) return;
    const previous = settings.default_speed;
    updateSettings((current) => ({ ...current, default_speed: speed }));
    setSaving("speed");
    setFeedback(null);
    try {
      await settingsApi.setDefaultSpeed(speed);
    } catch (reason) {
      updateSettings((current) => ({ ...current, default_speed: previous }));
      setFeedback({
        kind: "error",
        message: toErrorMessage(reason, "无法保存默认倍速"),
      });
    } finally {
      setSaving(null);
    }
  };

  const saveAutoNext = async (enabled: boolean) => {
    if (!settings) return;
    const previous = settings.auto_next;
    updateSettings((current) => ({ ...current, auto_next: enabled }));
    setSaving("auto-next");
    setFeedback(null);
    try {
      await settingsApi.setAutoNext(enabled);
    } catch (reason) {
      updateSettings((current) => ({ ...current, auto_next: previous }));
      setFeedback({
        kind: "error",
        message: toErrorMessage(reason, "无法保存自动连播设置"),
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mx-auto min-h-full max-w-4xl px-4 pb-8 pt-6 md:px-6 md:pb-24 md:pt-14 lg:px-10">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">设置</h1>
        {feedback && <SettingsFeedback feedback={feedback} />}
      </div>

      {isLoading ? (
        <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card">
          <LoadingSettings />
        </div>
      ) : !settings ? (
        <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card">
          <SettingsLoadError
            message={toErrorMessage(error, "无法读取设置")}
            onRetry={() => void refetch()}
          />
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          <SettingsGroup title="显示">
            <SettingRow icon={<Languages />} label="显示语言">
              <div className="flex items-center gap-3">
              <Button type="button" variant="ghost" size="icon-sm" disabled={reloading || saving === "language"} onClick={() => void reloadCatalog(settings.display_language)} aria-label="重新载入动漫列表" title="重新载入动漫列表">
                {reloading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              </Button>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                aria-label="显示语言"
                value={settings.display_language}
                disabled={saving === "language" || reloading}
                onValueChange={(value) => {
                  if (value === "en" || value === "zh") void saveLanguage(value);
                }}
              >
                <ToggleGroupItem value="en">English</ToggleGroupItem>
                <ToggleGroupItem value="zh">中文</ToggleGroupItem>
              </ToggleGroup>
              </div>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="播放">
            {!isMobileApp && <SettingRow icon={<Volume2 />} label="默认音量">
              <div className="flex w-full items-center gap-4 md:w-64">
                <Slider
                  id="default-volume"
                  thumbLabels={["默认音量"]}
                  formatValue={(value) => `${value}%`}
                  value={[Math.round(settings.default_volume * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  disabled={saving === "volume"}
                  onValueChange={([value]) => {
                    if (value === undefined) return;
                    updateSettings((current) => ({
                      ...current,
                      default_volume: value / 100,
                    }));
                  }}
                  onValueCommit={([value]) => {
                    if (value !== undefined) void saveVolume(value / 100);
                  }}
                />
                <output
                  htmlFor="default-volume"
                  className="w-10 text-right text-xs tabular-nums text-muted-foreground"
                >
                  {Math.round(settings.default_volume * 100)}%
                </output>
              </div>
            </SettingRow>}

            <SettingRow icon={<Gauge />} label="默认倍速">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                aria-label="默认倍速"
                value={String(settings.default_speed)}
                disabled={saving === "speed"}
                onValueChange={(value) => {
                  if (value) void saveSpeed(Number(value));
                }}
                className="flex-wrap justify-end"
              >
                {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                  <ToggleGroupItem key={speed} value={String(speed)}>
                    {speed}×
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingRow>

            <SettingRow
              icon={<Radio />}
              label="自动播放下一话"
              htmlFor="auto-next"
            >
              <Switch
                id="auto-next"
                aria-label="自动播放下一话"
                checked={settings.auto_next}
                disabled={saving === "auto-next"}
                onCheckedChange={(checked) => void saveAutoNext(checked)}
              />
            </SettingRow>
          </SettingsGroup>
        </div>
      )}
    </div>
  );
}

function SettingsFeedback({ feedback }: { feedback: NonNullable<Feedback> }) {
  return (
    <p
      role={feedback.kind === "error" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-center gap-2 text-xs",
        feedback.kind === "error"
          ? "text-destructive-readable"
          : "text-muted-foreground",
      )}
    >
      {feedback.kind === "error" ? (
        <AlertCircle aria-hidden="true" size={14} className="shrink-0" />
      ) : (
        <Check aria-hidden="true" size={14} className="shrink-0" />
      )}
      <span className="truncate">{feedback.message}</span>
    </p>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = `settings-${title}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  icon,
  label,
  htmlFor,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-17 flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex shrink-0 items-center gap-3 text-muted-foreground [&_svg]:size-4.5 [&_svg]:stroke-[1.8]">
        {icon}
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{label}</Label>
        ) : (
          <span className="text-sm font-medium text-foreground">{label}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function LoadingSettings() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground"
    >
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      正在读取…
    </div>
  );
}

function SettingsLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-5">
      <p
        role="alert"
        className="flex min-w-0 items-center gap-2 text-xs text-destructive-readable"
      >
        <AlertCircle size={14} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{message}</span>
      </p>
      <Button type="button" variant="outline" size="xs" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

function toErrorMessage(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return fallback;
}
