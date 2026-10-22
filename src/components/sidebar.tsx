import { cn } from "@/lib/utils";
import { useUpdateAvailable } from "@/hooks/use-app-update";
import { UpdateDot } from "@/components/mobile-navigation";
import { isMobileApp } from "@/lib/platform";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { Button } from "@/components/ui/button";
import { Link, useMatches } from "@tanstack/react-router";
import {
  CalendarDays,
  Home,
  Library,
  CircleUserRound,
  Search,
} from "lucide-react";

const NAVIGATION = [
  { icon: Home, label: "首页", english: "Home", to: "/" },
  { icon: CalendarDays, label: "日历", english: "Calendar", to: "/calendar" },
  { icon: Library, label: "追番", english: "Following", to: "/watchlist" },
] as const;

interface SidebarProps {
  onSearchClick?: () => void;
}

export function Sidebar({ onSearchClick }: SidebarProps) {
  const language = useDisplayLanguage();
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? "/";
  const shortcutLabel = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K";
  const updateAvailable = useUpdateAvailable();
  const settingsActive = currentPath === "/settings" || currentPath.startsWith("/settings/");

  return (
    <aside className="app-sidebar relative z-40 hidden h-full w-20 shrink-0 flex-col border-r border-overlay/6 bg-sidebar/92 px-3 pb-4 pt-8 md:flex lg:w-56">
      {!isMobileApp && <div
        className="absolute inset-x-0 top-0 h-8"
        data-tauri-drag-region
      />}
      <Link
        to="/"
        className="mb-8 flex h-12 items-center gap-3 rounded-xl px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-primary-readable"
      >
        <img src="/icon.png" alt="" className="h-10 w-10 rounded-xl" />
        <div className="hidden min-w-0 lg:block">
          <p className="text-sm font-bold tracking-[0.08em]">KURIUME</p>
          <p className="text-[10px] tracking-[0.18em] text-muted-foreground">
            栗梅
          </p>
        </div>
      </Link>

      <Button
        type="button"
        variant="outline"
        onClick={onSearchClick}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "mb-5 h-10 w-full justify-start rounded-xl border-border bg-muted/25 px-3 text-muted-foreground shadow-none hover:bg-muted/55 hover:text-foreground",
          currentPath === "/search" && "border-primary/40 bg-primary/10 text-primary-readable",
        )}
      >
        <Search size={16} />
        <span className="sr-only flex-1 text-left lg:not-sr-only">{language === "zh" ? "搜索动画" : "Search anime"}</span>
        <kbd className="hidden rounded border border-overlay/10 px-1.5 py-0.5 text-[10px] lg:block">
          {shortcutLabel}
        </kbd>
      </Button>

      <nav className="space-y-1">
        {NAVIGATION.map((item) => {
          const active =
            item.to === "/"
              ? currentPath === "/"
              : currentPath.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-[10px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-primary-readable lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
                active
                  ? "bg-primary/14 text-foreground"
                  : "text-muted-foreground hover:bg-overlay/5 hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
              )}
              <item.icon
                size={18}
                strokeWidth={active ? 2.2 : 1.75}
                className={active ? "text-primary-readable" : undefined}
              />
              <span>{language === "zh" ? item.label : item.english}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <Link
          to="/settings"
          aria-current={settingsActive ? "page" : undefined}
          className={cn(
            "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-[10px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-primary-readable lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
            settingsActive
              ? "bg-primary/14 text-foreground"
              : "text-muted-foreground hover:bg-overlay/5 hover:text-foreground",
          )}
        >
          <span className="relative grid place-items-center">
          {updateAvailable && <UpdateDot className="-right-1 -top-1" />}
          <CircleUserRound
            size={18}
            strokeWidth={settingsActive ? 2.2 : 1.75}
            className={
              settingsActive ? "text-primary-readable" : undefined
            }
          />
          </span>
          <span>{language === "zh" ? "我的" : "Me"}</span>
        </Link>
      </div>
    </aside>
  );
}
