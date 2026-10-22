import { useCatalogSource, useDisplayLanguage } from "@/hooks/use-display-language";
import { calendarQueryOptions } from "@/lib/catalog-queries";
import { displayAnimeTitle } from "@/lib/display-language";
import { historyApi, historyListQueryKey, libraryApi } from "@/lib/store";
import { airingClock, followedIds, watchedThrough } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Clock3 } from "lucide-react";

function todayWeekdayId() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

/** Followed works that broadcast today: what a tracker opens the app for. */
export function TodayUpdates() {
  const language = useDisplayLanguage();
  const zh = language === "zh";
  const source = useCatalogSource();
  const { data: calendar = [] } = useQuery(calendarQueryOptions(language, source));
  const { data: library = [] } = useQuery({ queryKey: ["library-list"], queryFn: () => libraryApi.list() });
  const { data: history = [] } = useQuery({ queryKey: historyListQueryKey(200, 0), queryFn: () => historyApi.list(200, 0) });
  const followed = followedIds(library);
  const now = Date.now() / 1000;
  const items = (calendar.find((entry) => entry.weekday.id === todayWeekdayId())?.items ?? [])
    .filter((media) => followed.has(media.id))
    .sort((a, b) => (a.schedule?.airing_at ?? 0) - (b.schedule?.airing_at ?? 0));
  if (items.length === 0) return null;

  return (
    <section className="mt-8 first:mt-0 md:mt-10" aria-labelledby="today-updates-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="today-updates-title" className="text-lg font-bold tracking-tight">{zh ? "今日更新" : "New today"}</h2>
        <Link to="/calendar" className="flex min-h-11 items-center rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary-readable">{zh ? "日历" : "Schedule"}</Link>
      </div>
      <div className="hide-scrollbar -mx-4 mt-3 grid auto-cols-[min(72%,17rem)] grid-flow-col snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:scroll-px-0 md:mx-0 md:px-0 lg:auto-cols-[minmax(0,1fr)] lg:grid-flow-row lg:grid-cols-3">
        {items.map((media) => {
          const slot = media.schedule;
          const aired = slot ? slot.airing_at <= now : false;
          const seen = slot ? watchedThrough(history, media.id) >= slot.episode : false;
          const label = slot ? (zh ? `第 ${slot.episode} 话` : `Episode ${slot.episode}`) : "";
          const content = (
            <>
              <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
                {media.cover && <img src={media.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col py-0.5">
                <p className="line-clamp-2 text-sm font-medium leading-5">{displayAnimeTitle(media, language)}</p>
                <p className="mt-auto flex items-center gap-1.5 pt-2 text-xs tabular-nums">
                  <span className="text-muted-foreground">{label}</span>
                  {slot && (seen ? (
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Check size={12} />{zh ? "已看" : "Watched"}</span>
                  ) : aired ? (
                    <span className="rounded-full bg-highlight/14 px-1.5 py-0.5 font-bold text-highlight">{zh ? "已更新" : "Out now"}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock3 size={11} />{zh ? `${airingClock(slot.airing_at, language)} 更新` : `at ${airingClock(slot.airing_at, language)}`}</span>
                  ))}
                </p>
              </div>
            </>
          );
          const className = cn("press flex min-w-0 snap-start gap-3 rounded-xl bg-card p-3 outline-none transition-colors hover:bg-secondary active:bg-secondary focus-visible:ring-[3px] focus-visible:ring-primary-readable motion-reduce:transition-none",
            aired && !seen && "ring-1 ring-inset ring-highlight/40");
          return aired && slot ? (
            <Link key={media.id} to="/anime/$id/episode/$ep" params={{ id: media.id, ep: String(slot.episode) }} search={{ t: undefined }} className={className}>{content}</Link>
          ) : (
            <Link key={media.id} to="/anime/$id" params={{ id: media.id }} className={className}>{content}</Link>
          );
        })}
      </div>
    </section>
  );
}
