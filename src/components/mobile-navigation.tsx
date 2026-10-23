import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, CalendarDays, CircleUserRound, Home, Library, Search } from "lucide-react";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { cn } from "@/lib/utils";
import { useUpdateAvailable } from "@/hooks/use-app-update";

export function MobileNavigation({ onSearch }: { onSearch: () => void }) {
  const language = useDisplayLanguage();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const updateAvailable = useUpdateAvailable();
  const items = [
    { to: "/", icon: Home, label: language === "zh" ? "首页" : "Home" },
    { to: "/manga", icon: BookOpen, label: language === "zh" ? "漫画" : "Manga" },
    { to: "/calendar", icon: CalendarDays, label: language === "zh" ? "日历" : "Calendar" },
    { to: "/watchlist", icon: Library, label: language === "zh" ? "追番" : "Following", title: language === "zh" ? "追番/追漫" : "Following" },
    { to: "/settings", icon: CircleUserRound, label: language === "zh" ? "我的" : "Me" },
  ] as const;
  // Detail has its own back navigation; keep browsing chrome on root screens.
  if (path.startsWith("/anime/") || path.startsWith("/manga/")) return null;
  const current = items.find((item) => item.to === path || (item.to !== "/" && path.startsWith(`${item.to}/`)));
  const manga = path === "/manga";
  const searchLabel = language === "zh" ? (manga ? "搜索漫画" : "搜索动画") : (manga ? "Search manga" : "Search anime");
  return <>
    <header className="mobile-topbar flex shrink-0 items-center justify-between gap-3 bg-background px-5 pb-1 md:hidden">
      {path === "/" ? <Link to="/" className="flex min-h-14 items-center gap-2.5 text-lg font-bold tracking-tight">
        <img src="/icon.png" alt="" className="size-8 rounded-[10px]" />Kuriume
      </Link> : <p className="flex min-h-14 items-center text-xl font-bold tracking-tight">{current ? ("title" in current ? current.title : current.label) : (language === "zh" ? "搜索" : "Search")}</p>}
      <button onClick={onSearch} type="button" aria-label={searchLabel} className="grid size-12 place-items-center rounded-xl text-muted-foreground active:bg-secondary focus-visible:ring-2 focus-visible:ring-primary-readable">
        <Search size={21} />
      </button>
    </header>
    <nav aria-label={language === "zh" ? "主导航" : "Main navigation"} className="mobile-tabbar order-last z-40 grid shrink-0 grid-cols-5 border-t border-overlay/6 bg-sidebar md:hidden">
      {items.map(({ to, icon: Icon, label }) => {
        const active = path === to || (to !== "/" && path.startsWith(to));
        return <Link key={to} to={to} aria-current={active ? "page" : undefined} className={cn("flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary-readable", active ? "text-primary-readable" : "text-muted-foreground")}>
          <span className={cn("relative grid h-8 w-12 place-items-center rounded-full", active && "bg-primary/18")}><Icon size={21} strokeWidth={active ? 2.2 : 1.7} />{to === "/settings" && updateAvailable && <UpdateDot />}</span><span>{label}</span>
        </Link>;
      })}
    </nav>
  </>;
}

/** A newer release is out; details are on the 我的 page. */
export function UpdateDot({ className }: { className?: string }) {
  return <span role="img" aria-label="New version available" className={cn("absolute right-3.5 top-0.5 size-2 rounded-full bg-highlight ring-2 ring-sidebar", className)} />;
}
