import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Loader2, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { clearDiagnostics, diagnosticReport, diagnosticText, readDiagnostics, type DiagnosticPage } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings_/logs")({ component: LogsPage });

function LogsPage() {
  const zh = useDisplayLanguage() === "zh";
  const [page, setPage] = useState<DiagnosticPage | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [busy, setBusy] = useState(true);
  const [older, setOlder] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);
  const generation = useRef(0);
  const loading = useRef(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  const load = useCallback(async (before?: number, quiet = false) => {
    if (quiet && loading.current) return;
    const id = ++generation.current;
    loading.current = true;
    if (!quiet) {
      setBusy(true);
      setFailed(false);
      setCopied(false);
      follow.current = before === undefined;
    }
    try {
      const next = await readDiagnostics(before, errorsOnly);
      if (id !== generation.current) return;
      setPage(next);
      setOlder(before !== undefined);
      setFailed(false);
    } catch {
      if (id === generation.current) setFailed(true);
    } finally {
      if (id === generation.current) { loading.current = false; setBusy(false); }
    }
  }, [errorsOnly]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!live || older || manualCopy !== null || clearOpen) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden && !window.getSelection()?.toString()) await load(undefined, true);
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [live, older, manualCopy, clearOpen, load]);

  useEffect(() => {
    if (follow.current && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [page]);

  const clear = async () => {
    const id = ++generation.current;
    setBusy(true);
    loading.current = true;
    setFailed(false);
    try {
      await clearDiagnostics();
      if (id === generation.current) await load();
    } catch {
      if (id === generation.current) { loading.current = false; setFailed(true); setBusy(false); }
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

  return <div className="mx-auto flex h-full min-h-[36rem] w-full max-w-5xl flex-col px-4 pb-4 pt-2 md:px-6 md:pt-10 lg:px-10">
    <Link to="/settings" className="mb-2 inline-flex min-h-12 shrink-0 items-center gap-2 self-start rounded-lg pr-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable">
      <ArrowLeft size={18} aria-hidden="true" />{zh ? "设置" : "Settings"}
    </Link>
    <h1 className="shrink-0 text-2xl font-bold tracking-tight md:text-3xl">{zh ? "日志与诊断" : "Logs & diagnostics"}</h1>

    <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
      <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => void load()}>
        {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{zh ? "刷新" : "Refresh"}
      </Button>
      <Button variant="ghost" className="min-h-12" aria-pressed={live && !older} disabled={older} onClick={() => setLive(!live)}>
        {live && !older ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{live && !older ? (zh ? "暂停更新" : "Pause updates") : (zh ? "实时更新" : "Live updates")}
      </Button>
      <Button variant="ghost" className="min-h-12" disabled={busy || !page?.entries.length || failed} onClick={() => void copy()}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制本页" : "Copy page")}
      </Button>
    </div>

    <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
      <fieldset className="flex flex-wrap gap-1" disabled={busy}>
        <legend className="sr-only">{zh ? "日志筛选" : "Filter logs"}</legend>
        {[false, true].map((value) => <Button key={String(value)} variant={errorsOnly === value ? "secondary" : "ghost"} className="min-h-12" aria-pressed={errorsOnly === value} onClick={() => setErrorsOnly(value)}>
          {value ? (zh ? "警告与错误" : "Warnings & errors") : (zh ? "全部" : "All")}
        </Button>)}
      </fieldset>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
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

    <div className="mb-2 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
      <span>{page ? (zh ? `${page.total} 条记录` : `${page.total} records`) : "—"}{!!page?.evicted && (zh ? ` · 已淘汰 ${page.evicted} 条` : ` · ${page.evicted} evicted`)}</span>
      <span>{zh ? "日志内容" : "Log content"} {page ? `${(page.bytes / 1024).toFixed(1)} KiB` : "—"} / 1 MiB</span>
    </div>

    <section aria-label={zh ? "日志记录" : "Log entries"} aria-busy={busy} className="flex min-h-36 flex-1 flex-col overflow-hidden rounded-xl bg-card">
      {failed && <div className="shrink-0 px-4 py-4 text-sm" role="alert">
        <p className="text-destructive-readable">{zh ? "未能读取或清空日志，请重试。" : "Could not read or clear logs. Please retry."}</p>
        <Button variant="outline" className="mt-4 min-h-12" onClick={() => void load()}>{zh ? "重试" : "Retry"}</Button>
      </div>}
      {busy && !page ? <div role="status" className="space-y-4 p-4">
        <span className="sr-only">{zh ? "正在读取日志" : "Loading logs"}</span>
        {[1, 2, 3].map((key) => <div key={key} className="h-5 animate-pulse rounded bg-secondary/60 motion-reduce:animate-none" />)}
      </div> : !page?.entries.length && !failed ? <div className="grid flex-1 place-items-center px-4 py-12 text-center text-sm text-muted-foreground" role="status">
        {errorsOnly ? (zh ? "暂无警告或错误" : "No warnings or errors") : (zh ? "暂无日志" : "No logs yet")}
      </div> : <div ref={streamRef} role="log" aria-live="off" aria-label={zh ? "日志流" : "Log stream"} tabIndex={0}
        onScroll={(event) => { const el = event.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
        className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 font-mono text-sm font-normal leading-6 tabular-nums outline-none selection:bg-primary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable">
        {[...(page?.entries ?? [])].reverse().map((entry) => <div key={entry.id} data-log-entry className="mb-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] last:mb-0">
          <time className="text-muted-foreground" dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString("en-GB", { hour12: false })}.{String(entry.at % 1000).padStart(3, "0")}</time>{" "}
          <span className={cn("font-bold", entry.level === "error" ? "text-destructive-readable" : entry.level === "warn" ? "text-primary-readable" : "text-foreground")}>[{entry.level.toUpperCase()}]</span>{" "}
          {diagnosticText(entry)}
        </div>)}
      </div>}
    </section>
    <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
      {older ? <Button variant="ghost" className="min-h-12" disabled={busy} onClick={() => void load()}>{zh ? "回到最新" : "Back to latest"}</Button> : <span />}
      {page?.hasMore && <Button variant="outline" className="min-h-12" disabled={busy || failed} onClick={() => void load(page.entries[page.entries.length - 1]?.id)}>{zh ? "更早的记录" : "Older entries"}</Button>}
    </div>
    {page && <p className="mt-2 shrink-0 text-xs text-muted-foreground">Kuriume {page.version} · {page.platform}</p>}
    <p role="status" className="sr-only">{copied ? (zh ? "本页日志已复制" : "Page copied") : ""}</p>

    <AlertDialog open={manualCopy !== null} onOpenChange={(open) => { if (!open) setManualCopy(null); }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader><AlertDialogTitle>{zh ? "手动复制日志" : "Copy logs manually"}</AlertDialogTitle>
          <AlertDialogDescription>{zh ? "当前设备未允许自动复制，请选择下方文本后复制。" : "Automatic copying is unavailable. Select and copy the text below."}</AlertDialogDescription></AlertDialogHeader>
        <textarea aria-label={zh ? "本页日志" : "Logs on this page"} readOnly value={manualCopy ?? ""} onFocus={(event) => event.currentTarget.select()} className="h-60 max-h-[40dvh] w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-readable" />
        <AlertDialogFooter><AlertDialogCancel className="min-h-12">{zh ? "完成" : "Done"}</AlertDialogCancel></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
