import { Button } from "@/components/ui/button";
import { KuriMark } from "@/components/kuri-loader";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { refreshCatalogLanguage } from "@/lib/catalog-queries";
import {
  DEFAULT_DISPLAY_LANGUAGE,
  settingsApi,
  settingsQueryOptions,
  type DisplayLanguage,
  type Settings,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  Languages,
  Loader2,
  RefreshCw,
  ScrollText,
  ChevronRight,
  History,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type Feedback = { kind: "success" | "error"; message: string } | null;

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error, refetch } = useQuery(settingsQueryOptions);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reloading, setReloading] = useState(false);
  const language = settings?.display_language ?? DEFAULT_DISPLAY_LANGUAGE;
  const zh = language === "zh";

  const updateSettings = (update: (current: Settings) => Settings) => {
    queryClient.setQueryData<Settings>(settingsQueryOptions.queryKey, (current) =>
      current ? update(current) : current,
    );
  };

  const saveLanguage = async (language: DisplayLanguage) => {
    if (!settings || language === settings.display_language) return;
    const previous = settings.display_language;
    updateSettings((current) => ({ ...current, display_language: language }));
    setSaving(true);
    setFeedback(null);
    try {
      await settingsApi.setDisplayLanguage(language);
    } catch (reason) {
      updateSettings((current) => ({ ...current, display_language: previous }));
      setFeedback({
        kind: "error",
        message: toErrorMessage(reason, previous === "zh" ? "无法更新显示语言" : "Could not update the display language"),
      });
      setSaving(false);
      return;
    }
    setSaving(false);
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

  return (
    <div className="mx-auto min-h-full max-w-3xl px-4 pb-8 pt-4 md:px-6 md:pb-24 md:pt-14 lg:px-10">
      <div className="flex flex-col gap-3">
        <h1 className="sr-only text-3xl font-bold tracking-tight md:not-sr-only">{zh ? "我的" : "Me"}</h1>
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
          <SettingsGroup title={zh ? "观看" : "Watching"}>
            <LinkRow to="/watchlist" search={{ view: "history" }} icon={<History />} label={zh ? "观看历史" : "Watch history"} />
          </SettingsGroup>

          <SettingsGroup title={zh ? "显示" : "Display"} action={
              <Button type="button" variant="ghost" size="icon-sm" className="size-12 text-muted-foreground" disabled={reloading || saving} onClick={() => void reloadCatalog(settings.display_language)} aria-label={zh ? "重新载入动漫列表" : "Reload anime lists"} title={zh ? "重新载入动漫列表" : "Reload anime lists"}>
                {reloading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              </Button>
            }>
            <SettingRow icon={<Languages />} label={zh ? "显示语言" : "Language"} htmlFor="display-language">
              <Select
                value={settings.display_language}
                disabled={saving || reloading}
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

function LinkRow({ to, search, icon, label }: { to: "/watchlist"; search: { view: "history" }; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} search={search} className="press flex min-h-16 items-center gap-3 px-4 py-3 text-sm font-medium outline-none hover:bg-secondary/60 active:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
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
}: {
  icon: React.ReactNode;
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-20 items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 text-muted-foreground [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]">
        {icon}
        <Label htmlFor={htmlFor} className="min-w-0 text-sm leading-snug text-foreground">{label}</Label>
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
      <span aria-hidden="true" className="kuri kuri-sm inline-grid shrink-0"><KuriMark className="size-full" /></span>
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
