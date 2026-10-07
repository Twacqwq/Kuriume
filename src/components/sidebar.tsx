import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link, useMatches } from "@tanstack/react-router";
import {
  CalendarDays,
  Home,
  Library,
  Search,
  Settings,
} from "lucide-react";

const NAVIGATION = [
  { icon: Home, label: "首页", to: "/" },
  { icon: CalendarDays, label: "日历", to: "/calendar" },
  { icon: Library, label: "资料库", to: "/watchlist" },
] as const;

interface SidebarProps {
  onSearchClick?: () => void;
}

export function Sidebar({ onSearchClick }: SidebarProps) {
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? "/";
  const shortcutLabel = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K";

  return (
    <aside className="relative z-40 flex h-screen w-56 shrink-0 flex-col border-r border-white/6 bg-sidebar/92 px-3 pb-4 pt-8">
      <div
        className="absolute inset-x-0 top-0 h-8"
        data-tauri-drag-region
      />
      <Link
        to="/"
        className="mb-8 flex h-12 items-center gap-3 rounded-xl px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-primary-readable"
      >
        <img src="/icon.png" alt="" className="h-10 w-10 rounded-xl" />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-[0.08em]">KURIUME</p>
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
        <span className="flex-1 text-left">搜索动画</span>
        <kbd className="rounded border border-white/8 px-1.5 py-0.5 text-[10px]">
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
                "relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm outline-none transition focus-visible:ring-[3px] focus-visible:ring-primary-readable",
                active
                  ? "bg-primary/14 text-foreground"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
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
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <Link
          to="/settings"
          aria-current={currentPath === "/settings" ? "page" : undefined}
          className={cn(
            "flex h-11 items-center gap-3 rounded-xl px-3 text-sm outline-none transition focus-visible:ring-[3px] focus-visible:ring-primary-readable",
            currentPath === "/settings"
              ? "bg-primary/14 text-foreground"
              : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
          )}
        >
          <Settings
            size={18}
            strokeWidth={currentPath === "/settings" ? 2.2 : 1.75}
            className={
              currentPath === "/settings" ? "text-primary-readable" : undefined
            }
          />
          设置
        </Link>
      </div>
    </aside>
  );
}
