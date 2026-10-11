import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { cn } from "@/lib/utils";

export function LoadingStatus({ className }: { className?: string }) {
  const language = useDisplayLanguage();
  return (
    <div role="status" className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      <span>{language === "zh" ? "正在载入…" : "Loading…"}</span>
    </div>
  );
}

// Route/chunk fallback. Page-specific skeletons below keep the app shell usable.
export function PageLoading() {
  return <LoadingStatus className="min-h-64 justify-center" />;
}

export function HomePageLoading() {
  const language = useDisplayLanguage();
  return (
    <div data-loading-page="home" className="mx-auto max-w-7xl px-4 pb-8 pt-3 md:px-6 md:pt-10 lg:px-10">
      <div className="relative flex min-h-96 flex-col justify-end overflow-hidden rounded-2xl bg-card p-4 pb-5 md:min-h-[clamp(400px,48vh,520px)] md:p-8 md:pb-10 lg:p-10">
        <LoadingStatus className="absolute left-4 top-5 md:left-8 lg:left-10" />
        <div aria-hidden="true" className="flex items-end gap-4">
          <Skeleton className="aspect-2/3 w-20 shrink-0 rounded-xl md:hidden" />
          <div className="w-full max-w-xl space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-5/6 md:h-10" />
            <Skeleton className="h-7 w-2/3 md:h-10" />
          </div>
        </div>
        <div aria-hidden="true" className="mt-4 hidden max-w-lg space-y-2 md:block">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <Skeleton className="mt-5 h-12 w-32 rounded-xl md:mt-7" />
      </div>
      <section className="mt-8 md:mt-10">
        <h2 className="text-lg font-bold tracking-tight">{language === "zh" ? "本季焦点" : "Season picks"}</h2>
        <div aria-hidden="true" className="hide-scrollbar -mx-4 mt-4 grid auto-cols-[42%] grid-flow-col gap-3 overflow-hidden px-4 min-[480px]:auto-cols-[30%] sm:auto-cols-[23%] md:mx-0 md:px-0 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4 lg:gap-4 xl:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index}>
              <Skeleton className="aspect-2/3 rounded-xl" />
              <Skeleton className="mt-2 h-4 w-4/5" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CalendarPageLoading() {
  const language = useDisplayLanguage();
  return (
    <div data-loading-page="calendar" className="mx-auto max-w-7xl px-4 pb-8 pt-4 md:px-6 md:pt-14 lg:px-10">
      <h1 className="sr-only text-3xl font-bold tracking-tight md:not-sr-only">{language === "zh" ? "每周放送" : "Weekly schedule"}</h1>
      <div aria-hidden="true" className="grid grid-cols-7 gap-2 md:mt-6 lg:max-w-2xl">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-16 rounded-xl lg:h-12" />)}
      </div>
      <LoadingStatus className="my-6" />
      <div aria-hidden="true" className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-y-6 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 py-3 lg:block lg:py-0">
            <Skeleton className="aspect-2/3 w-16 shrink-0 rounded-lg lg:w-full" />
            <div className="flex-1 space-y-3 lg:mt-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LibraryListLoading() {
  return (
    <div data-loading-page="library">
      <LoadingStatus className="mt-5" />
      <div aria-hidden="true" className="mt-2 grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-start gap-3 border-b border-border/60 py-5 sm:gap-4">
            <Skeleton className="h-24 w-16 shrink-0 rounded-lg sm:h-30 sm:w-20" />
            <div className="flex-1 space-y-3 pt-1">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
