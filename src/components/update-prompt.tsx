import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAppUpdate } from "@/hooks/use-app-update";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { openExternal, plainReleaseNotes } from "@/lib/app-update";
import { readKey, shouldPromptUpdate, SKIPPED_VERSION_KEY, writeKey } from "@/lib/update-prompt";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";

const NOTE_LINES = 12;
/** One prompt per launch, however often the home page mounts. */
let promptedThisLaunch = false;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The launch splash covers everything; open dialogs only once it is gone. */
function useSplashGone(): boolean {
  const [gone, setGone] = useState(() => !document.getElementById("splash"));
  useEffect(() => {
    if (gone) return;
    const observer = new MutationObserver(() => {
      if (!document.getElementById("splash")) setGone(true);
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [gone]);
  return gone;
}

/**
 * On the home page: a newer release with its notes, once per launch.
 * "稍后" waits for the next launch; "跳过此版本" until a newer release.
 */
export function UpdatePrompt() {
  const zh = useDisplayLanguage() === "zh";
  const { update } = useAppUpdate();
  const splashGone = useSplashGone();
  const [closed, setClosed] = useState(promptedThisLaunch);
  const [openError, setOpenError] = useState<string | null>(null);

  const close = () => {
    promptedThisLaunch = true;
    setClosed(true);
  };
  const open = (url: string) => {
    setOpenError(null);
    openExternal(url).then(close, () => setOpenError(zh ? "无法打开链接，请稍后再试" : "Could not open the link"));
  };

  const result = update.data;
  if (closed || !splashGone || result?.status !== "available"
    || !shouldPromptUpdate(result, readKey(storage(), SKIPPED_VERSION_KEY))) return null;
  const lines = plainReleaseNotes(result.notes, NOTE_LINES);
  return (
    <Dialog open onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md">
        <div className="px-6 pb-5 pt-6">
          <PromptHeading icon={<Download className="size-5" aria-hidden="true" />}
            title={zh ? "发现新版本" : "A new version is available"}
            description={[`v${result.current} → v${result.latest}`, result.publishedAt && new Date(result.publishedAt).toLocaleDateString(zh ? "zh-CN" : "en-US")].filter(Boolean).join(" · ")} />
          {lines.length > 0 && <NoteList lines={lines} />}
          {result.download?.name.endsWith(".apk") && (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">{zh ? "下载完成后点开安装包即可覆盖安装，追番和观看记录都会保留。" : "Open the downloaded package to install over this version; your library and history are kept."}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-overlay/6 px-6 py-4 sm:flex-row-reverse">
          <Button type="button" className="h-12 px-5 sm:min-w-28" onClick={() => open(result.download?.url ?? result.pageUrl)}>
            <Download aria-hidden="true" />
            {result.download ? (zh ? "下载更新" : "Download") : (zh ? "前往发布页" : "Open release")}
          </Button>
          <Button type="button" variant="secondary" className="h-12 px-4" onClick={close}>{zh ? "稍后" : "Later"}</Button>
          <Button type="button" variant="ghost" className="h-12 px-4 text-muted-foreground sm:mr-auto"
            onClick={() => { writeKey(storage(), SKIPPED_VERSION_KEY, result.latest); close(); }}>
            {zh ? "跳过此版本" : "Skip this version"}
          </Button>
        </div>
        {openError && <p role="alert" className="px-6 pb-4 text-xs text-destructive-readable">{openError}</p>}
      </DialogContent>
    </Dialog>
  );
}

function PromptHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/16 text-primary-readable">{icon}</span>
      <div className="min-w-0">
        <DialogTitle className="text-lg font-bold leading-tight">{title}</DialogTitle>
        <DialogDescription className="mt-1 text-xs tabular-nums text-muted-foreground">{description}</DialogDescription>
      </div>
    </div>
  );
}

/** Release-note section headings (scripts/release-notes.mjs), in the interface language. */
const SECTION_ZH: Record<string, string> = {
  "Features": "新功能",
  "Bug Fixes": "问题修复",
  "Performance Improvements": "性能优化",
  "Reverts": "回退",
  "Documentation": "文档",
  "Miscellaneous Chores": "其他",
  "⚠ BREAKING CHANGES": "重要变更",
};

function NoteList({ lines }: { lines: string[] }) {
  const zh = useDisplayLanguage() === "zh";
  if (zh) lines = lines.map((line) => SECTION_ZH[line] ?? line);
  return (
    <ul className="hide-scrollbar mt-4 max-h-[40vh] space-y-1.5 overflow-y-auto overscroll-contain text-sm leading-6 text-muted-foreground">
      {lines.map((line, index) => (
        <li key={index} className={line.startsWith("• ") ? "break-words" : "break-words pt-1 font-medium text-foreground/85"}>{line}</li>
      ))}
    </ul>
  );
}
