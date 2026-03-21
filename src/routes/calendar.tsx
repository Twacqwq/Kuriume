import { createFileRoute } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star, Film } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/query-client";
import type { AnimeInfo, CalendarEntry } from "@/lib/types";

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];

function getTodayWeekdayId(): number {
  const jsDay = new Date().getDay(); // 0=Sun
  return jsDay === 0 ? 7 : jsDay;    // Bangumi: 1=Mon … 7=Sun
}

const calendarQueryOptions = {
  queryKey: ["calendar", "Bangumi"],
  queryFn: async () => {
    return invoke<CalendarEntry[]>("get_calendar", {
      provider: "Bangumi",
    });
  },
  staleTime: 1000 * 60 * 30, // 30 min
};

export const Route = createFileRoute("/calendar")({
  loader: async () => {
    if (queryClient.getQueryData(calendarQueryOptions.queryKey)) {
      queryClient.prefetchQuery(calendarQueryOptions);
      return;
    }
    await queryClient.prefetchQuery(calendarQueryOptions);
  },
  component: CalendarPage,
});

function CalendarPage() {
  const { data: calendar = [] } = useQuery(calendarQueryOptions);
  const todayId = getTodayWeekdayId();

  // Reorder: start from today
  const reordered = reorderFromToday(calendar, todayId);

  if (calendar.length === 0) {
    return (
      <div className="flex items-center justify-center pt-[20vh] text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 md:px-10 lg:px-12 xl:px-16">
      <h1 className="text-xl font-bold text-foreground mb-6">每周放送</h1>

      {/* Weekday tabs */}
      <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
        {reordered.map((entry) => {
          const isToday = entry.weekday.id === todayId;
          return (
            <a
              key={entry.weekday.id}
              href={`#day-${entry.weekday.id}`}
              className={cn(
                "relative shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                isToday
                  ? "bg-primary text-white shadow-md shadow-primary/25"
                  : "bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground"
              )}
            >
              {isToday ? "今天" : `周${WEEKDAY_SHORT[entry.weekday.id % 7]}`}
              <span className="ml-1.5 text-xs opacity-60">{entry.items.length}</span>
            </a>
          );
        })}
      </div>

      {/* Day sections */}
      <div className="space-y-10">
        {reordered.map((entry) => {
          const isToday = entry.weekday.id === todayId;
          return (
            <section key={entry.weekday.id} id={`day-${entry.weekday.id}`}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-lg font-semibold text-foreground">
                  {entry.weekday.cn}
                </h2>
                {isToday && (
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                    今天
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {entry.items.length} 部
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {entry.items.map((item) => (
                  <CalendarCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CalendarCard({ item }: { item: AnimeInfo }) {
  const title = item.title_cn || item.title;
  const [imgFailed, setImgFailed] = useState(false);
  const hasCover = item.cover && !imgFailed;

  return (
    <Link
      to="/anime/$id"
      params={{ id: item.id }}
      className="group cursor-pointer"
    >
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-card">
        {hasCover ? (
          <img
            src={item.cover!}
            alt={title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <CalendarCoverFallback title={title} />
        )}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/30" />
        {item.score != null && item.score > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-yellow-400 backdrop-blur-sm">
            <Star size={10} fill="currentColor" />
            {item.score}
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <h3 className="text-sm font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">
          {title}
        </h3>
        {item.total_episodes > 0 && (
          <p className="text-xs text-muted-foreground">{item.total_episodes}话</p>
        )}
      </div>
    </Link>
  );
}

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
