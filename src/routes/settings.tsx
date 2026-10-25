import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { linkFollowedToCatalog, refreshCatalog } from "@/lib/catalog-queries";
import {
  DEFAULT_CATALOG_SOURCE,
  DEFAULT_DISPLAY_LANGUAGE,
  settingsApi,
  type CatalogSource,
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
  Database,
  History,
  ExternalLink,
  Github,
  Info,
  Palette,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { setTheme, THEMES } from "@/lib/theme";
import { useState } from "react";
import { UpdateButton, UpdateStatus } from "@/components/update-action";
import { useAppUpdate } from "@/hooks/use-app-update";
import { openExternal, plainReleaseNotes, PROJECT_URL } from "@/lib/app-update";

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

  const catalogSource = settings?.catalog_source ?? DEFAULT_CATALOG_SOURCE;
  const saveCatalogSource = async (source: CatalogSource) => {
    if (!settings || source === catalogSource) return;
    const previous = catalogSource;
    updateSettings((current) => ({ ...current, catalog_source: source }));
    setSaving(true);
    setFeedback(null);
    try {
      await settingsApi.setCatalogSource(source);
    } catch (reason) {
      updateSettings((current) => ({ ...current, catalog_source: previous }));
      setFeedback({ kind: "error", message: toErrorMessage(reason, zh ? "无法切换数据源" : "Could not change the data source") });
      setSaving(false);
      return;
    }
    setSaving(false);
    await reloadCatalog(settings.display_language, source);
    void linkFollowedToCatalog().catch(() => undefined);
  };

  const reloadCatalog = async (language: DisplayLanguage, source: CatalogSource = catalogSource) => {
    setReloading(true);
    setFeedback({ kind: "success", message: language === "zh" ? "正在重新载入动漫列表…" : "Reloading anime lists…" });
    try {
      await refreshCatalog(language, source);
      setFeedback({ kind: "success", message: language === "zh" ? "动漫列表已重新载入" : "Anime lists reloaded" });
    } catch {
      setFeedback({ kind: "error", message: language === "zh" ? "设置已保存，列表载入失败，请重试" : "Saved. Could not reload lists; please retry." });
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
            <ThemePicker zh={zh} />
            <SettingRow icon={<Database />} label={zh ? "数据源" : "Data source"} htmlFor="catalog-source">
              <Select
                value={catalogSource}
                disabled={saving || reloading}
                onValueChange={(value) => {
                  if (value === "anilist" || value === "bangumi") void saveCatalogSource(value);
                }}
              >
                <SelectTrigger id="catalog-source" className="h-12 w-32 shrink-0 border-0 bg-secondary/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anilist" className="min-h-12">AniList</SelectItem>
                  <SelectItem value="bangumi" className="min-h-12">Bangumi</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </SettingsGroup>

          <AboutGroup zh={zh} />

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

/** Built-in colour themes; applies at once and is kept on this device. */
function ThemePicker({ zh }: { zh: boolean }) {
  const current = useTheme();
  return (
    <div className="px-4 py-3">
      <div className="flex min-h-11 items-center gap-3 text-muted-foreground [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]">
        <Palette aria-hidden="true" />
        <span id="theme-label" className="text-sm leading-snug text-foreground">{zh ? "主题" : "Theme"}</span>
      </div>
      <div role="radiogroup" aria-labelledby="theme-label" className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {THEMES.map((theme) => {
          const selected = theme.id === current;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(theme.id)}
              className={cn(
                "group relative flex min-h-12 flex-col overflow-hidden rounded-xl border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
                selected ? "border-primary-readable/70" : "border-border hover:border-muted-foreground/50",
              )}
            >
              {/* A miniature of the theme: canvas, a card, its primary and reminder colours. */}
              <span aria-hidden="true" className="flex h-16 items-end gap-1.5 p-2.5" style={{ backgroundColor: theme.background }}>
                <span className="flex h-full flex-1 flex-col justify-end gap-1 rounded-md p-1.5" style={{ backgroundColor: theme.card }}>
                  <span className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: theme.primary }} />
                  <span className="h-1.5 w-1/2 rounded-full opacity-35" style={{ backgroundColor: "#ffffff" }} />
                </span>
                <span className="size-4 rounded-full" style={{ backgroundColor: theme.highlight }} />
              </span>
              <span className="flex items-center justify-between gap-2 bg-card px-3 py-2 text-sm font-medium">
                {zh ? theme.zh : theme.en}
                {selected && <Check className="size-4 text-primary-readable" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AboutGroup({ zh }: { zh: boolean }) {
  const { version, update } = useAppUpdate();
  const [openError, setOpenError] = useState<string | null>(null);
  const open = (url: string) => {
    setOpenError(null);
    openExternal(url).catch((reason) => setOpenError(toErrorMessage(reason, zh ? "无法打开链接" : "Could not open the link")));
  };
  const result = update.data;
  const checking = update.isFetching;
  const status = checking
    ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{zh ? "正在检查…" : "Checking…"}</span>
    : update.isError
      ? <span className="text-destructive-readable">{zh ? "检查失败" : "Check failed"}</span>
      : result?.status === "available"
        ? <span className="rounded-full bg-highlight/14 px-2 py-0.5 font-bold text-highlight">{zh ? `新版本 v${result.latest}` : `v${result.latest} available`}</span>
        : result?.status === "latest"
          ? <span className="inline-flex items-center gap-1"><Check className="size-3.5" aria-hidden="true" />{zh ? "已是最新版本" : "Up to date"}</span>
          : null;
  const notes = result?.status === "available" ? plainReleaseNotes(result.notes) : [];

  return (
    <SettingsGroup title={zh ? "关于" : "About"}>
      <div className="flex min-h-20 items-center gap-3 px-4 py-3 text-sm">
        <Info className="size-4.5 shrink-0 stroke-[1.8] text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{zh ? "版本" : "Version"} <span className="ml-1 tabular-nums text-muted-foreground">{version ? `v${version}` : "—"}</span></p>
          <p role="status" className="mt-1 text-xs text-muted-foreground">{status}</p>
        </div>
        <Button type="button" variant="secondary" className="h-12 shrink-0 px-4" disabled={!version || checking} onClick={() => void update.refetch()}>
          {zh ? "检查更新" : "Check for updates"}
        </Button>
      </div>
      {result?.status === "available" && (
        <div className="space-y-3 bg-highlight/6 px-4 py-4">
          <div>
            <p className="text-sm font-bold">{zh ? `Kuriume v${result.latest} 已发布` : `Kuriume v${result.latest} is out`}</p>
            {result.publishedAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(result.publishedAt).toLocaleDateString(zh ? "zh-CN" : "en-US")}</p>
            )}
          </div>
          {notes.length > 0 && (
            <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
              {notes.map((line, index) => <li key={index} className="break-words">{line}</li>)}
            </ul>
          )}
          <UpdateStatus update={result} zh={zh} />
          <div className="flex flex-wrap gap-2">
            <UpdateButton update={result} zh={zh} onOpen={open} className="h-12 px-4" />
            {result.download && (
              <Button type="button" variant="ghost" className="h-12 px-4 text-muted-foreground" onClick={() => open(result.pageUrl)}>
                {zh ? "更新说明" : "Release notes"}
              </Button>
            )}
          </div>
        </div>
      )}
      <button type="button" onClick={() => open(PROJECT_URL)} className="press flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium outline-none hover:bg-secondary/60 active:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable">
        <Github className="size-4.5 shrink-0 stroke-[1.8] text-muted-foreground" aria-hidden="true" />
        <span className="flex-1">{zh ? "项目主页" : "Project page"}</span>
        <span className="hidden text-xs text-muted-foreground min-[380px]:inline">github.com/Twacqwq/Kuriume</span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {(openError || update.isError) && (
        <p role="alert" className="px-4 py-3 text-xs text-destructive-readable">{openError ?? toErrorMessage(update.error, zh ? "检查更新失败" : "Update check failed")}</p>
      )}
    </SettingsGroup>
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
