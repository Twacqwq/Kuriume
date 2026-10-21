import { createFileRoute } from "@tanstack/react-router";
import { useCatalogSource, useDisplayLanguage } from "@/hooks/use-display-language";
import { displayAnimeTitle } from "@/lib/display-language";
import { calendarQueryOptions, ensureCatalogSettings } from "@/lib/catalog-queries";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star, Film } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { sharePoster } from "@/lib/view-transition";
import { libraryApi } from "@/lib/store";
import { airingClock, followedIds } from "@/lib/tracking";
import { Bookmark } from "lucide-react";

const ONLY_FOLLOWED_KEY = "kuriume:calendar-only-following";
function readOnlyFollowed() {
  try { return localStorage.getItem(ONLY_FOLLOWED_KEY) === "1"; } catch { return false; }
}
import type { AnimeInfo, CalendarEntry } from "@/lib/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CalendarPageLoading } from "@/components/page-loading";
import { PullToRefresh } from "@/components/pull-to-refresh";

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getTodayWeekdayId(): number {
  const jsDay = new Date().getDay(); // 0=Sun
  return jsDay === 0 ? 7 : jsDay;    // AniList view model: 1=Mon … 7=Sun
}

export const Route = createFileRoute("/calendar")({
  loader: ensureCatalogSettings,
  pendingComponent: CalendarPageLoading,
  component: CalendarPage,
});

function CalendarPage() {
  const language = useDisplayLanguage();
  const source = useCatalogSource();
  const { data: rawCalendar = [], isPending, isError, refetch } = useQuery(calendarQueryOptions(language, source));
  const { data: library = [] } = useQuery({ queryKey: ["library-list"], queryFn: () => libraryApi.list() });
  const followed = followedIds(library);
  const [onlyFollowed, setOnlyFollowed] = useState(readOnlyFollowed);
  const filterFollowed = onlyFollowed && followed.size > 0;
  const toggleOnlyFollowed = () => {
    setOnlyFollowed((value) => {
      try { localStorage.setItem(ONLY_FOLLOWED_KEY, value ? "0" : "1"); } catch { /* per-device preference */ }
      return !value;
    });
  };
  // Followed works lead each day, in broadcast order; optionally only them.
  const isFollowed = (item: AnimeInfo) => followed.has(item.id);
  const calendar = rawCalendar.map((entry) => ({
    ...entry,
    items: entry.items
      .filter((item) => !filterFollowed || isFollowed(item))
      .sort((a, b) => Number(isFollowed(b)) - Number(isFollowed(a)) || (a.schedule?.airing_at ?? 0) - (b.schedule?.airing_at ?? 0)),
  }));
  const todayId = getTodayWeekdayId();
  const reordered = reorderFromToday(calendar, todayId);
  const [selectedDay, setSelectedDay] = useState(todayId);
  const activeDay = calendar.some((entry) => entry.weekday.id === selectedDay)
    ? selectedDay
    : reordered[0]?.weekday.id;

  if (isPending) return <CalendarPageLoading />;

  if (rawCalendar.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
        <p role={isError ? "alert" : "status"}>{isError
          ? (language === "zh" ? "无法载入放送日历" : "Could not load the schedule")
          : (language === "zh" ? "本周暂无放送安排" : "No anime scheduled this week")}</p>
        <button type="button" onClick={() => void refetch()} className="min-h-12 rounded-lg px-4 py-2 text-primary-readable outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary-readable">{language === "zh" ? "重新载入" : "Reload"}</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-8 pt-4 md:px-6 md:pb-16 md:pt-14 lg:px-10">
      <PullToRefresh onRefresh={() => refetch()} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="sr-only text-3xl font-bold tracking-tight text-foreground md:not-sr-only">{language === "zh" ? "每周放送" : "Weekly schedule"}</h1>
        {followed.size > 0 && (
          <button type="button" aria-pressed={onlyFollowed} onClick={toggleOnlyFollowed}
            className={cn("ml-auto hidden lg:flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable active:bg-accent motion-reduce:transition-none",
              onlyFollowed ? "border-primary/50 bg-primary/16 text-primary-readable" : "border-border/80 text-muted-foreground hover:text-foreground")}>
            <Bookmark size={14} fill={onlyFollowed ? "currentColor" : "none"} />{language === "zh" ? "只看追番" : "Following only"}
          </button>
        )}
      </div>

      <div className="hide-scrollbar -mx-4 overflow-x-auto px-4 pb-2 md:mt-6 lg:hidden">
        <ToggleGroup type="single" value={String(activeDay)} aria-label={language === "zh" ? "选择放送日期" : "Choose a schedule day"}
          className="w-full min-w-max gap-2"
          onValueChange={(value) => { if (value) setSelectedDay(Number(value)); }}>
          {reordered.map((entry) => (
            <ToggleGroupItem key={entry.weekday.id} value={String(entry.weekday.id)}
              aria-label={`${language === "zh" ? entry.weekday.cn : WEEKDAY_EN[entry.weekday.id % 7]} · ${entry.items.length} ${language === "zh" ? "部" : "anime"}`}
              className="h-16 min-w-14 flex-1 flex-col gap-1 rounded-xl! border-0 bg-card px-3 text-sm text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <span>{entry.weekday.id === todayId
                ? (language === "zh" ? "今天" : "Today")
                : (language === "zh" ? `周${WEEKDAY_SHORT[entry.weekday.id % 7]}` : WEEKDAY_EN[entry.weekday.id % 7].slice(0, 3))}</span>
              <span className="text-xs tabular-nums">{entry.items.length}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <nav aria-label={language === "zh" ? "放送日期" : "Schedule days"} className="hide-scrollbar mb-8 mt-6 hidden gap-2 overflow-x-auto pb-1 lg:flex">
        {reordered.map((entry) => {
          const isToday = entry.weekday.id === todayId;
          return (
            <a
              key={entry.weekday.id}
              href={`#day-${entry.weekday.id}`}
              className={cn(
                "relative flex min-h-12 shrink-0 items-center rounded-lg px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable",
                isToday
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground"
              )}
            >
              {isToday ? (language === "zh" ? "今天" : "Today") : (language === "zh" ? `周${WEEKDAY_SHORT[entry.weekday.id % 7]}` : WEEKDAY_EN[entry.weekday.id % 7].slice(0, 3))}
              <span className="ml-1.5 text-xs tabular-nums">{entry.items.length}</span>
            </a>
          );
        })}
      </nav>

      {/* Day sections */}
      <div className="mt-6 lg:space-y-10">
        {reordered.map((entry) => {
          const isToday = entry.weekday.id === todayId;
          return (
            <section key={entry.weekday.id} id={`day-${entry.weekday.id}`} className={cn("scroll-mt-6", entry.weekday.id !== activeDay && "hidden lg:block")}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-lg font-bold text-foreground">
                  {language === "zh" ? entry.weekday.cn : WEEKDAY_EN[entry.weekday.id % 7]}
                </h2>
                {isToday && (
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary-readable">
                    {language === "zh" ? "今天" : "Today"}
                  </span>
                )}
                <span className="ml-auto text-sm tabular-nums text-muted-foreground lg:ml-0">
                  {entry.items.length} {language === "zh" ? "部" : "anime"}
                </span>
                {followed.size > 0 && (
                  <button type="button" aria-pressed={onlyFollowed} onClick={toggleOnlyFollowed}
                    className={cn("-my-1 flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable active:bg-accent motion-reduce:transition-none lg:hidden",
                      onlyFollowed ? "border-primary/50 bg-primary/16 text-primary-readable" : "border-border/80 text-muted-foreground")}>
                    <Bookmark size={14} fill={onlyFollowed ? "currentColor" : "none"} />{language === "zh" ? "只看追番" : "Following"}
                  </button>
                )}
              </div>
              {entry.items.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">{filterFollowed
                ? (language === "zh" ? "这一天没有在追的番" : "Nothing you follow airs this day")
                : (language === "zh" ? "今天暂无放送安排" : "No anime scheduled for this day")}</p>}
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-y-6 xl:grid-cols-5 2xl:grid-cols-6">
                {entry.items.map((item) => (
                  <CalendarCard key={item.id} item={item} followed={isFollowed(item)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const CalendarCard = memo(function CalendarCard({ item, followed }: { item: AnimeInfo; followed: boolean }) {
  const language = useDisplayLanguage();
  const title = displayAnimeTitle(item, language);
  const [imgFailed, setImgFailed] = useState(false);
  const hasCover = item.cover && !imgFailed;

  return (
    <Link
      to="/anime/$id"
      params={{ id: item.id }}
      viewTransition
      onClick={sharePoster}
      className="press group flex min-w-0 items-center gap-4 rounded-lg py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable active:bg-card lg:block lg:py-0"
    >
      <div className={cn("relative aspect-2/3 w-16 shrink-0 overflow-hidden rounded-lg bg-card lg:w-full", followed && "ring-2 ring-primary/70")}>
        {hasCover ? (
          <img
            src={item.cover!}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <CalendarCoverFallback title={title} />
        )}
        {item.score != null && item.score > 0 && (
          <div className="absolute top-2 right-2 hidden items-center gap-1 rounded-md bg-black/80 px-1.5 py-1 text-xs text-yellow-300 lg:flex">
            <Star aria-hidden="true" size={10} fill="currentColor" />
            {item.score.toFixed(1)}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2 lg:mt-3">
        <h3 className="line-clamp-2 text-base font-medium leading-snug text-foreground transition-colors group-hover:text-primary-readable lg:text-sm">
          {title}
        </h3>
        {(followed || item.schedule) && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm tabular-nums text-muted-foreground lg:text-xs">
            {followed && <span className="rounded-full bg-primary/18 px-1.5 py-0.5 text-xs font-bold text-primary-readable">{language === "zh" ? "追番中" : "Following"}</span>}
            {item.schedule && (
              <span>
                {language === "zh" ? `第 ${item.schedule.episode} 话` : `Ep ${item.schedule.episode}`}
                {" · "}
                {item.schedule.airing_at <= Date.now() / 1000
                  ? <span className="text-highlight">{language === "zh" ? "已更新" : "out"}</span>
                  : airingClock(item.schedule.airing_at, language)}
              </span>
            )}
          </p>
        )}
        {!item.schedule && item.total_episodes > 0 && (
          <p className="text-sm text-muted-foreground lg:text-xs">{language === "zh" ? `共 ${item.total_episodes} 话` : `${item.total_episodes} episodes`}</p>
        )}
        {item.score != null && item.score > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground lg:hidden"><Star aria-hidden="true" size={12} className="text-yellow-300" />{item.score.toFixed(1)}</p>}
      </div>
    </Link>
  );
});

function CalendarCoverFallback({ title }: { title: string }) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-3"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 40%, 20%) 0%, hsl(${(hue + 40) % 360}, 35%, 12%) 100%)`,
      }}
    >
      <Film size={28} className="text-white/20" strokeWidth={1.5} />
      <span className="line-clamp-3 text-center text-xs font-medium leading-relaxed text-white/50">
        {title}
      </span>
    </div>
  );
}

/** Reorder calendar so today comes first, then tomorrow, etc. */
function reorderFromToday(
  calendar: CalendarEntry[],
  todayId: number,
): CalendarEntry[] {
  if (calendar.length === 0) return [];
  const idx = calendar.findIndex((e) => e.weekday.id === todayId);
  if (idx <= 0) return calendar;
  return [...calendar.slice(idx), ...calendar.slice(0, idx)];
}
