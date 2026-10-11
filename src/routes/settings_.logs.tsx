import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { clearDiagnostics, diagnosticReport, readDiagnostics, type DiagnosticEvent, type DiagnosticPage } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings_/logs")({ component: LogsPage });

const eventLabels: Record<DiagnosticEvent, [string, string]> = {
  app_started: ["应用启动", "App started"], ui_error: ["界面异常", "Interface error"],
  catalog_request: ["目录请求", "Catalog request"], source_search: ["匹配播放源", "Source search"],
  source_episodes: ["读取剧集", "Episode list"], source_resolve: ["解析播放地址", "Source resolution"],
  source_prepare: ["准备播放资源", "Preparing media"],
  media_request: ["媒体请求", "Media request"], player_load: ["加载视频", "Loading video"],
  player_playing: ["开始播放", "Playback started"], player_buffering: ["视频缓冲", "Buffering"],
  player_seek: ["跳转进度", "Seek"], player_error: ["播放异常", "Playback error"],
  subtitle_error: ["字幕异常", "Subtitle error"], native_control: ["设备控制异常", "Device control error"],
  player_fallback: ["切换播放线路", "Playback fallback"],
};

function LogsPage() {
  const zh = useDisplayLanguage() === "zh";
  const [page, setPage] = useState<DiagnosticPage | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [busy, setBusy] = useState(true);
  const [older, setOlder] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (before?: number) => {
    const id = ++generation.current;
    setBusy(true);
    setFailed(false);
    setCopied(false);
    try {
      const next = await readDiagnostics(before, errorsOnly);
      if (id !== generation.current) return;
      setPage(next);
      setOlder(before !== undefined);
    } catch {
      if (id === generation.current) setFailed(true);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }, [errorsOnly]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const clear = async () => {
    const id = ++generation.current;
    setBusy(true);
    setFailed(false);
    try {
      await clearDiagnostics();
      if (id === generation.current) await load();
    } catch {
      if (id === generation.current) { setFailed(true); setBusy(false); }
    }
  };
  const copy = async () => {
    if (!page) return;
    const report = diagnosticReport(page);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      // Some mobile WebViews lack Clipboard API support. Native text selection
      // remains usable, without adding a plugin or writing an export file.
      setManualCopy(report);
    }
  };

  return <div className="mx-auto min-h-full max-w-3xl px-4 pb-8 pt-2 md:px-6 md:pb-24 md:pt-10 lg:px-10">
    <Link to="/settings" className="mb-4 inline-flex min-h-12 items-center gap-2 rounded-lg pr-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable">
      <ArrowLeft size={18} aria-hidden="true" />{zh ? "设置" : "Settings"}
    </Link>
    <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{zh ? "日志与诊断" : "Logs & diagnostics"}</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{zh ? "仅本次运行 · 重启清空 · 不自动上传" : "This session only · Cleared on restart · Never uploaded automatically"}</p>

    <div className="mt-6 flex flex-wrap items-center gap-2">
      <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => void load()}>
        {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{zh ? "刷新" : "Refresh"}
      </Button>
      <Button variant="ghost" className="min-h-12" disabled={busy || !page?.entries.length || failed} onClick={() => void copy()}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制本页" : "Copy page")}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild><Button variant="ghost" className="ml-auto min-h-12 text-muted-foreground" disabled={busy || !page?.total}>
          <Trash2 aria-hidden="true" />{zh ? "清空" : "Clear"}
        </Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{zh ? "清空本次日志？" : "Clear session logs?"}</AlertDialogTitle>
            <AlertDialogDescription>{zh ? "当前记录将被移除，之后的新日志仍会继续记录。" : "Current records will be removed. New events will still be recorded."}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="min-h-12">{zh ? "取消" : "Cancel"}</AlertDialogCancel><AlertDialogAction className="min-h-12" onClick={() => void clear()}>{zh ? "清空日志" : "Clear logs"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

    <fieldset className="mt-4 flex flex-wrap gap-1" disabled={busy}>
      <legend className="sr-only">{zh ? "日志筛选" : "Filter logs"}</legend>
      {[false, true].map((value) => <Button key={String(value)} variant={errorsOnly === value ? "secondary" : "ghost"} className="min-h-12" aria-pressed={errorsOnly === value} onClick={() => setErrorsOnly(value)}>
        {value ? (zh ? "警告与错误" : "Warnings & errors") : (zh ? "全部" : "All")}
      </Button>)}
    </fieldset>
    <div className="mb-3 mt-4 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
      <span>{page ? (zh ? `${page.total} 条记录` : `${page.total} records`) : "—"}{!!page?.evicted && (zh ? ` · 已淘汰 ${page.evicted} 条` : ` · ${page.evicted} evicted`)}</span>
      <span>{zh ? "日志内容" : "Log content"} {page ? `${(page.bytes / 1024).toFixed(1)} KiB` : "—"} / 1 MiB</span>
    </div>

    <section aria-label={zh ? "日志记录" : "Log entries"} aria-busy={busy} className="overflow-hidden rounded-2xl bg-card">
      {failed ? <div className="px-4 py-8 text-sm" role="alert">
        <p className="text-destructive-readable">{zh ? "未能读取或清空日志，请重试。" : "Could not read or clear logs. Please retry."}</p>
        <Button variant="outline" className="mt-4 min-h-12" onClick={() => void load()}>{zh ? "重试" : "Retry"}</Button>
      </div> : busy ? <div role="status" className="space-y-5 p-4">
        <span className="sr-only">{zh ? "正在读取日志" : "Loading logs"}</span>
        {[1, 2, 3].map((key) => <div key={key} className="h-12 animate-pulse rounded-lg bg-secondary/60 motion-reduce:animate-none" />)}
      </div> : !page?.entries.length ? <div className="px-4 py-12 text-center text-sm text-muted-foreground" role="status">
        {errorsOnly ? (zh ? "暂无警告或错误" : "No warnings or errors") : (zh ? "暂无日志" : "No logs yet")}
      </div> : <div className="divide-y divide-border/60">
        {page.entries.map((entry) => <details key={entry.id} className="group">
          <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable [&::-webkit-details-marker]:hidden">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString(zh ? "zh-CN" : "en-GB", { hour12: false })}</time>
                <span className={cn(entry.level === "error" && "text-destructive-readable", entry.level === "warn" && "text-primary-readable")}>
                  {entry.level === "error" ? (zh ? "错误" : "Error") : entry.level === "warn" ? (zh ? "警告" : "Warning") : (zh ? "信息" : "Info")}
                </span>
                {entry.repeats > 1 && <span>×{entry.repeats}</span>}
              </div>
              <p className="mt-1 text-sm font-medium">{eventLabels[entry.event][zh ? 0 : 1]}</p>
              {entry.details.code && <p className="mt-1 break-words text-xs text-muted-foreground">{entry.details.provider && `${entry.details.provider} · `}{entry.details.code}{entry.details.status ? ` · HTTP ${entry.details.status}` : ""}</p>}
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="px-4 pb-4">
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-background p-3 font-mono text-xs tabular-nums">
              {Object.entries(entry.details).filter(([, value]) => value != null).map(([key, value]) => <Fragment key={key}>
                <dt className="break-all text-muted-foreground">{key}</dt><dd className="break-all">{String(value)}</dd>
              </Fragment>)}
              <dt className="text-muted-foreground">{zh ? "最近发生" : "Last seen"}</dt><dd>{new Date(entry.lastAt).toLocaleTimeString(zh ? "zh-CN" : "en-GB", { hour12: false })}</dd>
            </dl>
          </div>
        </details>)}
      </div>}
    </section>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      {older ? <Button variant="ghost" className="min-h-12" disabled={busy} onClick={() => void load()}>{zh ? "回到最新" : "Back to latest"}</Button> : <span className="text-xs text-muted-foreground">{zh ? "每页最多 50 条" : "Up to 50 entries per page"}</span>}
      {page?.hasMore && <Button variant="outline" className="min-h-12" disabled={busy || failed} onClick={() => void load(page.entries[page.entries.length - 1]?.id)}>{zh ? "更早的记录" : "Older entries"}</Button>}
    </div>
    {page && <p className="mt-5 text-xs text-muted-foreground">Kuriume {page.version} · {page.platform}</p>}
    <p role="status" className="sr-only">{copied ? (zh ? "本页日志已复制" : "Page copied") : ""}</p>

    <AlertDialog open={manualCopy !== null} onOpenChange={(open) => { if (!open) setManualCopy(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{zh ? "手动复制日志" : "Copy logs manually"}</AlertDialogTitle>
          <AlertDialogDescription>{zh ? "当前设备未允许自动复制，请选择下方文本后复制。" : "Automatic copying is unavailable. Select and copy the text below."}</AlertDialogDescription></AlertDialogHeader>
        <textarea aria-label={zh ? "本页日志" : "Logs on this page"} readOnly value={manualCopy ?? ""} onFocus={(event) => event.currentTarget.select()} className="h-60 w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary-readable" />
        <AlertDialogFooter><AlertDialogCancel className="min-h-12">{zh ? "完成" : "Done"}</AlertDialogCancel></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
