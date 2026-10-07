import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, Home, Library, Search, Settings } from "lucide-react";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { cn } from "@/lib/utils";

export function MobileNavigation({ onSearch }: { onSearch: () => void }) {
  const language = useDisplayLanguage();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const items = [
    { to: "/", icon: Home, label: language === "zh" ? "首页" : "Home" },
    { to: "/calendar", icon: CalendarDays, label: language === "zh" ? "日历" : "Calendar" },
    { to: "/watchlist", icon: Library, label: language === "zh" ? "资料库" : "Library" },
    { to: "/settings", icon: Settings, label: language === "zh" ? "设置" : "Settings" },
  ] as const;
  return <>
    <header className="mobile-topbar flex shrink-0 items-center justify-between border-b border-border/50 bg-background px-4 md:hidden">
      <Link to="/" className="flex min-h-12 items-center gap-2.5 font-semibold tracking-wide">
        <img src="/icon.png" alt="" className="size-8 rounded-lg" />Kuriume
      </Link>
      <button onClick={onSearch} type="button" aria-label={language === "zh" ? "搜索动画" : "Search anime"} className="grid size-12 place-items-center rounded-xl text-muted-foreground active:bg-secondary focus-visible:ring-2 focus-visible:ring-primary-readable">
        <Search size={21} />
      </button>
    </header>
    <nav aria-label={language === "zh" ? "主导航" : "Main navigation"} className="mobile-tabbar order-last z-40 grid shrink-0 grid-cols-4 border-t border-border/60 bg-background md:hidden">
      {items.map(({ to, icon: Icon, label }) => {
        const active = path === to || (to !== "/" && path.startsWith(to));
        return <Link key={to} to={to} aria-current={active ? "page" : undefined} className={cn("flex min-h-15 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary-readable", active ? "text-primary-readable" : "text-muted-foreground")}>
          <Icon size={21} strokeWidth={active ? 2.2 : 1.7} /><span>{label}</span>
        </Link>;
      })}
    </nav>
  </>;
}
