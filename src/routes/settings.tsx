import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { settingsQueryOptions } from "@/hooks/use-display-language";
import { refreshCatalogLanguage } from "@/lib/catalog-queries";
import { isMobileApp } from "@/lib/platform";
import {
  DEFAULT_DISPLAY_LANGUAGE,
  settingsApi,
  type DisplayLanguage,
  type Settings,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  Gauge,
  Languages,
  Loader2,
  Radio,
  RefreshCw,
  Volume2,
  ScrollText,
  ChevronRight,
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
  const language = settings?.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
  const zh = language === "zh";

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
        message: toErrorMessage(reason, previous === "zh" ? "无法更新显示语言" : "Could not update the display language"),
      });
      setSaving(null);
      return;
    }
    setSaving(null);
    await reloadCatalog(language);
  };

  const reloadCatalog = async (language: DisplayLanguage) => {
    setReloading(true);
    setFeedback({ kind: "success", message: language === "zh" ? "正在重新载入动漫列表…" : "Reloading anime lists…" });
    try {
      await refreshCatalogLanguage(language);
      setFeedback({ kind: "success", message: language === "zh" ? "动漫列表已重新载入" : "Anime lists reloaded" });
    } catch {
      setFeedback({ kind: "error", message: language === "zh" ? "语言已保存，列表载入失败，请重试" : "Language saved. Could not reload lists; please retry." });
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
        message: toErrorMessage(reason, zh ? "无法保存默认音量" : "Could not save the default volume"),
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
        message: toErrorMessage(reason, zh ? "无法保存默认倍速" : "Could not save the playback speed"),
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
        message: toErrorMessage(reason, zh ? "无法保存自动连播设置" : "Could not save autoplay preferences"),
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mx-auto min-h-full max-w-3xl px-4 pb-8 pt-4 md:px-6 md:pb-24 md:pt-14 lg:px-10">
      <div className="flex flex-col gap-3">
        <h1 className="sr-only text-3xl font-bold tracking-tight md:not-sr-only">{zh ? "设置" : "Settings"}</h1>
        {feedback && <SettingsFeedback feedback={feedback} />}
      </div>

      {isLoading ? (
        <div className="mt-6 overflow-hidden rounded-xl bg-card md:mt-8">
          <LoadingSettings language={language} />
        </div>
      ) : !settings ? (
        <div className="mt-6 overflow-hidden rounded-xl bg-card md:mt-8">
          <SettingsLoadError
            message={toErrorMessage(error, zh ? "无法读取设置" : "Could not load settings")}
            language={language}
            onRetry={() => void refetch()}
          />
        </div>
      ) : (
        <div className="space-y-8 md:mt-8">
          <SettingsGroup title={zh ? "显示" : "Display"} action={
              <Button type="button" variant="ghost" size="icon-sm" className="size-12 text-muted-foreground" disabled={reloading || saving === "language"} onClick={() => void reloadCatalog(settings.display_language)} aria-label={zh ? "重新载入动漫列表" : "Reload anime lists"} title={zh ? "重新载入动漫列表" : "Reload anime lists"}>
                {reloading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              </Button>
            }>
            <SettingRow icon={<Languages />} label={zh ? "显示语言" : "Language"} htmlFor="display-language">
              <Select
                value={settings.display_language}
                disabled={saving === "language" || reloading}
                onValueChange={(value) => {
                  if (value === "en" || value === "zh") void saveLanguage(value);
                }}
              >
                <SelectTrigger id="display-language" className="h-12 w-32 shrink-0 border-0 bg-secondary/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en" className="min-h-12">English</SelectItem>
                  <SelectItem value="zh" className="min-h-12">中文</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title={zh ? "播放" : "Playback"}>
            {!isMobileApp && <SettingRow icon={<Volume2 />} label={zh ? "默认音量" : "Default volume"} htmlFor="default-volume" stacked>
              <div className="flex w-full items-center gap-4 md:w-56">
                <Slider
                  id="default-volume"
                  thumbLabels={[zh ? "默认音量" : "Default volume"]}
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

            <SettingRow icon={<Gauge />} label={zh ? "默认倍速" : "Playback speed"} htmlFor="default-speed">
              <Select
                value={String(settings.default_speed)}
                disabled={saving === "speed"}
                onValueChange={(value) => {
                  if (value) void saveSpeed(Number(value));
                }}
              >
                <SelectTrigger id="default-speed" className="h-12 w-24 shrink-0 border-0 bg-secondary/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                    <SelectItem key={speed} value={String(speed)} className="min-h-12">{speed}×</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow
              icon={<Radio />}
              label={zh ? "自动播放下一话" : "Autoplay next episode"}
              htmlFor="auto-next"
            >
              <Switch
                id="auto-next"
                aria-label={zh ? "自动播放下一话" : "Autoplay next episode"}
                checked={settings.auto_next}
                disabled={saving === "auto-next"}
                onCheckedChange={(checked) => void saveAutoNext(checked)}
              />
            </SettingRow>
          </SettingsGroup>
          <SettingsGroup title={zh ? "诊断" : "Diagnostics"}>
            <Link to="/settings/logs" className="flex min-h-20 items-center gap-3 px-4 py-3 text-sm font-medium outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable">
              <ScrollText className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{zh ? "日志与诊断" : "Logs & diagnostics"}</span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
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
        "flex min-w-0 items-start gap-2 py-2 text-sm leading-relaxed",
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
      <span className="min-w-0 break-words">{feedback.message}</span>
    </p>
  );
}

function SettingsGroup({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const id = `settings-${title}`;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex min-h-12 items-center justify-between gap-3 pl-1">
        <h2 id={id} className="text-sm font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
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
  stacked = false,
}: {
  icon: React.ReactNode;
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={cn("flex min-h-20 gap-3 px-4 py-3", stacked ? "flex-col md:flex-row md:items-center md:justify-between" : "items-center justify-between")}>
      <div className="flex min-w-0 flex-1 items-center gap-3 text-muted-foreground [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]">
        {icon}
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="min-w-0 text-sm leading-snug text-foreground">{label}</Label>
        ) : (
          <span className="text-sm font-medium text-foreground">{label}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function LoadingSettings({ language }: { language: DisplayLanguage }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground"
    >
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      {language === "zh" ? "正在读取…" : "Loading…"}
    </div>
  );
}

function SettingsLoadError({
  message,
  onRetry,
  language,
}: {
  message: string;
  onRetry: () => void;
  language: DisplayLanguage;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-5">
      <p
        role="alert"
        className="flex min-w-0 flex-1 items-start gap-2 text-sm text-destructive-readable"
      >
        <AlertCircle size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 break-words">{message}</span>
      </p>
      <Button type="button" variant="outline" className="min-h-12" onClick={onRetry}>
        {language === "zh" ? "重试" : "Retry"}
      </Button>
    </div>
  );
}

function toErrorMessage(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return fallback;
}
