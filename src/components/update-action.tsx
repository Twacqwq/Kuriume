import { Button } from "@/components/ui/button";
import { useUpdateInstall } from "@/hooks/use-update-install";
import { detectPlatform, type UpdateCheck } from "@/lib/app-update";
import { formatProgress, installUpdate, restartForUpdate, supportsInAppUpdate, type InstallState } from "@/lib/update-installer";
import { cn } from "@/lib/utils";
import { Download, ExternalLink, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";

type Available = Extract<UpdateCheck, { status: "available" }>;

/** The install state for this release, or idle for any other. */
function useInstallFor(update: Available): InstallState {
  const install = useUpdateInstall();
  return install.phase !== "idle" && install.version === update.latest ? install : { phase: "idle" };
}

function inAppPlatform(update: Available) {
  const platform = detectPlatform(navigator.userAgent);
  // Android installs the release APK; desktop reads latest.json instead.
  const inApp = supportsInAppUpdate(platform) && (platform !== "android" || Boolean(update.download));
  return { platform, inApp };
}

/**
 * The main update button: installs in the app where the platform can,
 * otherwise (iOS, or a release without in-app packages) opens the download.
 */
export function UpdateButton({ update, zh, onOpen, className }: {
  update: Available;
  zh: boolean;
  onOpen: (url: string) => void;
  className?: string;
}) {
  const install = useInstallFor(update);
  const { platform, inApp } = inAppPlatform(update);
  const [restartError, setRestartError] = useState(false);
  const page = update.download?.url ?? update.pageUrl;
  const start = () => void installUpdate(update, platform);

  if (install.phase === "downloading" || install.phase === "installing") {
    const percent = install.phase === "downloading" && install.total ? Math.min(99, Math.floor((install.downloaded / install.total) * 100)) : null;
    return (
      <Button type="button" className={className} disabled>
        <Loader2 className="animate-spin" aria-hidden="true" />
        {install.phase === "installing" ? (zh ? "正在安装" : "Installing") : percent === null ? (zh ? "正在下载" : "Downloading") : `${percent}%`}
      </Button>
    );
  }
  if (install.phase === "restart") {
    return (
      <Button type="button" className={className}
        onClick={() => { setRestartError(false); restartForUpdate().catch(() => setRestartError(true)); }}>
        <RotateCw aria-hidden="true" />
        {restartError ? (zh ? "重启失败，再试一次" : "Restart failed, try again") : (zh ? "立即重启" : "Restart now")}
      </Button>
    );
  }
  if (!inApp || (install.phase === "error" && install.reason === "unavailable")) {
    return (
      <Button type="button" className={className} onClick={() => onOpen(page)}>
        {update.download ? <Download aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
        {update.download ? (zh ? "下载安装包" : "Download") : (zh ? "前往发布页" : "Open release")}
      </Button>
    );
  }
  return (
    <Button type="button" className={className} onClick={start}>
      <Download aria-hidden="true" />
      {install.phase === "error" ? (zh ? "重试" : "Try again") : install.phase === "installer" ? (zh ? "重新安装" : "Install again") : (zh ? "下载更新" : "Update")}
    </Button>
  );
}

/** Progress and the next step, under the notes. */
export function UpdateStatus({ update, zh, className }: { update: Available; zh: boolean; className?: string }) {
  const install = useInstallFor(update);
  const { platform, inApp } = inAppPlatform(update);
  const text = "text-xs leading-5 text-muted-foreground";

  if (install.phase === "downloading") {
    const percent = install.total ? Math.min(100, (install.downloaded / install.total) * 100) : null;
    return (
      <div className={cn("space-y-1.5", className)}>
        <div role="progressbar" aria-label={zh ? "下载进度" : "Download progress"} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={percent === null ? undefined : Math.round(percent)} className="h-1.5 overflow-hidden rounded-full bg-overlay/10">
          <div className={cn("h-full rounded-full bg-primary transition-[width] duration-300", percent === null && "w-1/3 animate-pulse")}
            style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <p className={cn(text, "tabular-nums")}>{zh ? "正在下载 " : "Downloading "}{formatProgress(install.downloaded, install.total)}</p>
      </div>
    );
  }
  const message = statusMessage(install, platform, zh);
  if (message) {
    const failed = install.phase === "error" && install.reason === "failed";
    return <p role={failed ? "alert" : "status"} className={cn(text, failed && "text-destructive-readable", className)}>{message}</p>;
  }
  if (inApp && platform === "android") {
    return <p className={cn(text, className)}>{zh ? "更新会直接覆盖安装，追番和观看记录都会保留。" : "The update installs over this version; your library and history are kept."}</p>;
  }
  return null;
}

function statusMessage(install: InstallState, platform: string, zh: boolean): string | null {
  switch (install.phase) {
    case "installing":
      if (platform === "android") return zh ? "正在打开系统安装程序…" : "Opening the system installer…";
      if (platform === "windows") return zh ? "正在安装，Kuriume 会自动关闭并完成更新。" : "Installing. Kuriume closes itself to finish the update.";
      return zh ? "正在安装更新…" : "Installing the update…";
    case "restart":
      return zh ? "更新已安装，重启 Kuriume 后生效。" : "The update is installed; it takes effect after a restart.";
    case "installer":
      return zh ? "请在系统安装界面中确认更新，追番和观看记录都会保留。" : "Confirm the update in the system installer; your library and history are kept.";
    case "error":
      if (install.reason === "permission") {
        return zh
          ? "需要允许 Kuriume 安装应用：在刚打开的设置里开启「允许来自此来源的应用」，返回后点「重试」。"
          : "Allow Kuriume to install apps in the settings that just opened, then come back and try again.";
      }
      if (install.reason === "unavailable") {
        return zh ? "这个版本暂不支持在应用内更新，请下载安装包手动安装。" : "This release can't be installed from the app; download the package instead.";
      }
      return zh ? `更新失败：${install.message}` : `Update failed: ${install.message}`;
    default:
      return null;
  }
}

