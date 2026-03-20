import { cn } from "@/lib/utils";
import { Link, useMatches } from "@tanstack/react-router";
import { Clock, CalendarDays, Clapperboard, Library, Search, Settings } from "lucide-react";

const navItems = [
  { icon: Clapperboard, label: "番剧", to: "/" },
  { icon: CalendarDays, label: "放送", to: "/calendar" },
  { icon: Library, label: "追番", to: "/watchlist" },
  { icon: Clock, label: "历史", to: "/history" },
];

interface SidebarProps {
  onSearchClick?: () => void;
}

export function Sidebar({ onSearchClick }: SidebarProps) {
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? "/";

  return (
    <aside
      className={cn(
        "sticky left-0 top-0 z-40 flex h-screen w-17 shrink-0 flex-col",
        "border-r border-white/8 bg-sidebar backdrop-blur-xl transition-all duration-300"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-center">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-bold text-white text-sm shadow-lg shadow-primary/25">
          K
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col items-center px-2">
        <button
          type="button"
          onClick={onSearchClick}
          className="flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-muted-foreground transition-colors hover:bg-white/4 hover:text-foreground"
        >
          <Search size={20} strokeWidth={1.8} />
          <span className="text-[10px] leading-none font-medium">搜索</span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex flex-1 flex-col items-center gap-1 px-2">
        {navItems.map((item) => {
          const isActive = item.to === "/"
            ? currentPath === "/"
            : currentPath.startsWith(item.to);
          return (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                "group relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5 transition-all duration-200",
                isActive
                  ? "bg-white/8 text-primary"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground"
              )}
            >
              {/* Active indicator */}
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-0.75 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              )}
              <item.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] leading-none font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom settings */}
      <div className="flex flex-col items-center gap-1 px-2 pb-4">
        <Link
          to="/settings"
          className={cn(
            "flex w-full flex-col items-center gap-1 rounded-xl py-2.5 transition-colors",
            currentPath === "/settings"
              ? "bg-white/8 text-primary"
              : "text-muted-foreground hover:bg-white/4 hover:text-foreground"
          )}
        >
          <Settings size={20} strokeWidth={currentPath === "/settings" ? 2.2 : 1.8} />
          <span className="text-[10px] leading-none font-medium">设置</span>
        </Link>
      </div>
    </aside>
  );
}