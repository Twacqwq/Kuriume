import { cn } from "@/lib/utils";
import { Link, useMatches } from "@tanstack/react-router";
import { Clapperboard, CalendarDays, Library, User, Clock } from "lucide-react";

const navTabs = [
  { icon: Clapperboard, label: "番剧", to: "/" },
  { icon: CalendarDays, label: "放送", to: "/calendar" },
  { icon: Library, label: "追番", to: "/watchlist" },
  { icon: Clock, label: "历史", to: "/history" },
  { icon: User, label: "我的", to: "/me" },
] as const;

export function BottomTabBar() {
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? "/";

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex md:hidden",
        "border-t border-white/8 bg-background/90 backdrop-blur-xl",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {navTabs.map((tab) => {
        const isActive =
          tab.to === "/"
            ? currentPath === "/"
            : currentPath.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground active:text-foreground",
            )}
          >
            <tab.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="text-[10px] leading-none font-medium">
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
