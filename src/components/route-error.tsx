import { Button } from "@/components/ui/button";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

/** Tauri commands reject with plain strings, which carry no `message`. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
}

export function friendlyRouteError(detail: string, zh: boolean): string {
  if (/429|too many requests|rate.?limit/i.test(detail)) {
    return zh ? "AniList 暂时限制了请求频率，请稍等片刻再试。" : "AniList is rate limiting requests. Wait a moment and retry.";
  }
  if (/timeout|timed out/i.test(detail)) return zh ? "作品信息请求超时，请重试。" : "The catalog request timed out. Please retry.";
  if (/http request failed|dns|network|connect/i.test(detail)) {
    return zh ? "暂时无法连接 AniList，请检查网络后重试。" : "Could not reach AniList. Check your connection and retry.";
  }
  return zh ? "页面没有加载出来，请重试。" : "This page could not load. Please retry.";
}

/** Shared route error: says what failed, offers retry and a way back. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const zh = useDisplayLanguage() === "zh";
  const detail = errorText(error);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      reset();
      await router.invalidate();
    } finally {
      setRetrying(false);
    }
  };
  const back = () => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/", replace: true });
  };
  return (
    <div role="alert" className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <TriangleAlert className="size-9 text-destructive-readable" aria-hidden="true" />
      <div className="max-w-md">
        <p className="text-base font-bold">{zh ? "加载失败" : "Something went wrong"}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{friendlyRouteError(detail, zh)}</p>
        {detail && (
          <details className="mt-3 text-left text-xs text-muted-foreground">
            <summary className="mx-auto w-fit cursor-pointer rounded px-2 py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable">{zh ? "错误详情" : "Error details"}</summary>
            <p className="mt-2 max-h-40 overflow-auto break-all rounded-lg bg-white/5 p-3 leading-5 select-text">{detail}</p>
          </details>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={back}><ArrowLeft size={15} />{zh ? "返回" : "Back"}</Button>
        <Button onClick={() => void retry()} disabled={retrying}><RefreshCw size={15} className={retrying ? "animate-spin motion-reduce:animate-none" : undefined} />{zh ? "重试" : "Retry"}</Button>
      </div>
    </div>
  );
}
