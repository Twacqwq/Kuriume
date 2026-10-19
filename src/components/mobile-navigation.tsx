import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, CircleUserRound, Home, Library, Search } from "lucide-react";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { cn } from "@/lib/utils";

export function MobileNavigation({ onSearch }: { onSearch: () => void }) {
  const language = useDisplayLanguage();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const items = [
    { to: "/", icon: Home, label: language === "zh" ? "首页" : "Home" },
    { to: "/calendar", icon: CalendarDays, label: language === "zh" ? "日历" : "Calendar" },
    { to: "/watchlist", icon: Library, label: language === "zh" ? "追番" : "Following" },
    { to: "/settings", icon: CircleUserRound, label: language === "zh" ? "我的" : "Me" },
  ] as const;
  // Detail has its own back navigation; keep browsing chrome on root screens.
  if (path.startsWith("/anime/")) return null;
  const current = items.find((item) => item.to === path || (item.to !== "/" && path.startsWith(`${item.to}/`)));
  return <>
    <header className="mobile-topbar flex shrink-0 items-center justify-between gap-3 bg-background px-5 pb-1 md:hidden">
      {path === "/" ? <Link to="/" className="flex min-h-14 items-center gap-2.5 text-lg font-bold tracking-tight">
        <img src="/icon.png" alt="" className="size-8 rounded-[10px]" />Kuriume
      </Link> : <p className="flex min-h-14 items-center text-xl font-bold tracking-tight">{current?.label ?? (language === "zh" ? "搜索" : "Search")}</p>}
      <button onClick={onSearch} type="button" aria-label={language === "zh" ? "搜索动画" : "Search anime"} className="grid size-12 place-items-center rounded-xl text-muted-foreground active:bg-secondary focus-visible:ring-2 focus-visible:ring-primary-readable">
        <Search size={21} />
      </button>
    </header>
    <nav aria-label={language === "zh" ? "主导航" : "Main navigation"} className="mobile-tabbar order-last z-40 grid shrink-0 grid-cols-4 border-t border-white/5 bg-sidebar md:hidden">
      {items.map(({ to, icon: Icon, label }) => {
        const active = path === to || (to !== "/" && path.startsWith(to));
        return <Link key={to} to={to} aria-current={active ? "page" : undefined} className={cn("flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary-readable", active ? "text-primary-readable" : "text-muted-foreground")}>
          <span className={cn("grid h-8 w-14 place-items-center rounded-full", active && "bg-primary/18")}><Icon size={21} strokeWidth={active ? 2.2 : 1.7} /></span><span>{label}</span>
        </Link>;
      })}
    </nav>
  </>;
}
