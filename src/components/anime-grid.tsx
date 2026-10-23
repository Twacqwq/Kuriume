import { sharePoster } from "@/lib/view-transition";
import { Link } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { AlertCircle, BookOpen, Film, RotateCcw, Star } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadingStatus } from '@/components/page-loading'
import { useDisplayLanguage } from '@/hooks/use-display-language'
import { displayAnimeTitle } from '@/lib/display-language'
import { BROWSE_CACHE } from '@/lib/catalog-queries'
import { mediaKind, type AnimeInfo, type MediaKind, type PagedResult } from '@/lib/types'

/* ── Responsive column count (matches Tailwind grid breakpoints) ── */

function calcColumns(width: number): number {
  if (width >= 1160) return 7
  if (width >= 980) return 6
  if (width >= 820) return 5
  if (width >= 640) return 4
  if (width >= 440) return 3
  return 2
}

/* ── AnimeGrid ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface AnimeGridProps<TPageParam = any> {
  /** TanStack Query cache key */
  queryKey: unknown[]
  /** Fetch function — receives pageParam, returns a PagedResult */
  queryFn: (pageParam: TPageParam) => Promise<PagedResult<AnimeInfo>>
  /** Initial page param (e.g. offset number or { year, offset } object) */
  initialPageParam: TPageParam
  /** Determine next page param from last page result + last param. Return undefined to stop. */
  getNextPageParam: (
    lastPage: PagedResult<AnimeInfo>,
    allPages: PagedResult<AnimeInfo>[],
    lastPageParam: TPageParam,
  ) => TPageParam | undefined
  /** Grid section title */
  title?: string
  /** Items per page (for skeleton count) */
  pageSize?: number
  /** Reuse an already-fetched first page instead of requesting it twice. */
  initialPage?: PagedResult<AnimeInfo>
  initialPageUpdatedAt?: number
  /** What the list shows, for its empty and error messages. */
  kind?: MediaKind
}

export function AnimeGrid<TPageParam>({
  queryKey,
  queryFn,
  initialPageParam,
  getNextPageParam,
  title,
  pageSize = 30,
  initialPage,
  initialPageUpdatedAt,
  kind = 'anime',
}: AnimeGridProps<TPageParam>) {
  const language = useDisplayLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const layoutObserverRef = useRef<ResizeObserver | null>(null)
  const [cols, setCols] = useState(5)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isError,
    isPending,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => queryFn(pageParam as TPageParam),
    initialPageParam,
    getNextPageParam: (lastPage, allPages, lastPageParam) =>
      getNextPageParam(lastPage, allPages, lastPageParam),
    initialData: initialPage
      ? { pages: [initialPage], pageParams: [initialPageParam] }
      : undefined,
    initialDataUpdatedAt: initialPageUpdatedAt,
    ...(initialPage ? BROWSE_CACHE : {}),
  })

  // Flatten all pages into a single list (memoized to avoid re-creating objects)
  const items: AnimeCardItem[] = useMemo(
    () => {
      const seen = new Set<string>()
      return data?.pages.flatMap((page) =>
        page.data.filter((item) => {
          if (seen.has(item.id)) return false
          seen.add(item.id)
          return true
        }).map((item) => ({
          id: item.id,
          kind: mediaKind(item),
          title: displayAnimeTitle(item, language),
          cover: item.cover ?? '',
          score: item.score ?? 0,
          year: item.year ?? 0,
          episodes: item.total_episodes,
          volumes: item.volumes ?? 0,
          genre: [...new Set(item.genres)],
        })),
      ) ?? []
    },
    [data?.pages, language],
  )

  /* ── Scroll container & margin ── */

  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  const measureLayout = useCallback(() => {
    const container = containerRef.current
    if (container) {
      const next = calcColumns(container.clientWidth)
      setCols((current) => (current === next ? current : next))
    }

    const grid = gridRef.current
    const main = grid?.closest('main') as HTMLElement | null
    if (!grid || !main) return
    const gridRect = grid.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    const nextMargin = Math.round(gridRect.top - mainRect.top + main.scrollTop)
    setScrollMargin((current) => current === nextMargin ? current : nextMargin)
  }, [])

  const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect()
    containerRef.current = node
    if (!node) return
    const main = node.closest('main') as HTMLElement | null
    if (main) setScrollEl(main)
    measureLayout()
    resizeObserverRef.current = new ResizeObserver(measureLayout)
    resizeObserverRef.current.observe(node)
  }, [measureLayout])

  // Callback ref: track upstream layout changes so the virtualizer stays aligned
  // when sections above the grid mount asynchronously.
  const gridCallbackRef = useCallback((node: HTMLDivElement | null) => {
    layoutObserverRef.current?.disconnect()
    gridRef.current = node
    if (!node) return
    measureLayout()
    const main = node.closest('main') as HTMLElement | null
    const routeRoot = main?.firstElementChild
    if (routeRoot) {
      layoutObserverRef.current = new ResizeObserver(measureLayout)
      layoutObserverRef.current.observe(routeRoot)
    }
  }, [measureLayout])

  useEffect(() => () => {
    resizeObserverRef.current?.disconnect()
    layoutObserverRef.current?.disconnect()
  }, [])

  // Re-measure margin on resize
  useEffect(() => {
    if (!scrollEl) return
    const handler = () => {
      measureLayout()
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [measureLayout, scrollEl])

  /* ── Virtualizer ── */

  const rowCount = Math.ceil(items.length / cols)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => 340,
    overscan: 3,
    scrollMargin,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Infinite scroll: fetch next page when last virtual rows are visible
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (
      last.index >= rowCount - 2 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      void fetchNextPage()
    }
  }, [
    virtualItems,
    rowCount,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ])

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 lg:px-10">
      {title && (
        <h2 className="text-xl font-bold text-foreground mb-6">{title}</h2>
      )}

      <div ref={containerCallbackRef}>
      {isPending ? (
        <>
          <LoadingStatus className="mb-4" />
          <div
            aria-hidden="true"
            className="grid gap-x-3 gap-y-6 md:gap-x-4"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: Math.min(pageSize, 14) }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </>
      ) : isError && items.length === 0 ? (
        <GridError
          message={toErrorMessage(error, kind)}
          onRetry={() => void refetch()}
        />
      ) : items.length === 0 ? (
        <div role="status" className="flex min-h-56 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>{isFetchingNextPage ? (language === 'zh' ? '正在搜索…' : 'Searching…') : (language === 'zh' ? (kind === 'manga' ? '没有找到相关漫画' : '没有找到相关动画') : (kind === 'manga' ? 'No manga found' : 'No anime found'))}</p>
          {hasNextPage && (
            <Button variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {language === 'zh' ? '继续搜索' : 'Search more'}
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Virtualized grid */}
          <div
            ref={gridCallbackRef}
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualRow) => {
              const startIdx = virtualRow.index * cols
              const rowItems = items.slice(startIdx, startIdx + cols)
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  }}
                >
                  <div
                    className="grid gap-x-3 pb-6 md:gap-x-4"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                  >
                    {rowItems.map((item) => (
                      <AnimeCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Loading more indicator */}
          {isFetchingNextPage && (
            <>
              <LoadingStatus className="mb-4" />
              <div
                aria-hidden="true"
                className="grid gap-x-3 gap-y-6 md:gap-x-4"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: Math.min(pageSize, 14) }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </>
          )}

          {isFetchNextPageError && (
            <div className="flex justify-center py-7">
              <Button type="button" variant="outline" size="sm" onClick={() => void fetchNextPage()}>
                <RotateCcw aria-hidden="true" />
                加载失败，重试
              </Button>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  )
}

function SkeletonCard() {
  return (
    <div aria-hidden="true">
      <Skeleton className="aspect-2/3 rounded-lg" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

function GridError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
      <AlertCircle className="text-destructive-readable" aria-hidden="true" />
      <p role="alert" className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw aria-hidden="true" />
        重试
      </Button>
    </div>
  )
}

interface AnimeCardItem {
  id: string
  kind: MediaKind
  title: string
  cover: string
  score: number
  year: number
  episodes: number
  volumes: number
  genre: string[]
}

interface AnimeCardProps {
  item: AnimeCardItem
}

const AnimeCard = memo(function AnimeCard({ item }: AnimeCardProps) {
  const language = useDisplayLanguage();
  const [imgFailed, setImgFailed] = useState(false);
  const hasCover = item.cover && !imgFailed;
  const manga = item.kind === 'manga';
  // Manga list their volumes; chapter counts are rarely known.
  const count = manga ? item.volumes : item.episodes;
  const countLabel = manga ? (language === 'zh' ? ' 卷' : ' vols') : (language === 'zh' ? ' 话' : ' eps');

  return (
    <Link
      to={manga ? '/manga/$id' : '/anime/$id'}
      params={{ id: String(item.id) }}
      viewTransition
      onClick={sharePoster}
      className="press group block cursor-pointer rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-primary-readable"
    >
      {/* Cover */}
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-card">
        {hasCover ? (
          <img
            src={item.cover}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025] motion-reduce:transition-none"
          />
        ) : (
          <CoverFallback title={item.title} manga={manga} />
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/30 motion-reduce:transition-none" />
        {/* Score badge */}
        {item.score > 0 && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/72 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-yellow-300"
            aria-label={`${language === "zh" ? "评分" : "Score"} ${item.score.toFixed(1)}`}
          >
            <Star size={10} fill="currentColor" aria-hidden="true" />
            {item.score.toFixed(1)}
          </div>
        )}
      </div>
      {/* Info */}
      <div className="mt-2 space-y-1">
        <h3 className="min-h-10 text-sm leading-5 font-medium text-foreground line-clamp-2 group-hover:text-primary-readable transition-colors motion-reduce:transition-none">
          {item.title}
        </h3>
        {(item.year > 0 || count > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {item.year > 0 && <span>{item.year}</span>}
            {item.year > 0 && count > 0 && <span>·</span>}
            {count > 0 && <span>{count}{countLabel}</span>}
          </div>
        )}
        <div className="hidden gap-1.5 sm:flex">
          {item.genre.slice(0, 2).map((g, i) => (
            <span key={`${g}-${i}`} className="text-xs text-muted-foreground/70">
              {g}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
})

/** Hash-based gradient fallback when no cover image is available */
function CoverFallback({ title, manga = false }: { title: string; manga?: boolean }) {
  const hue = hashStringToHue(title);
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-3"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 40%, 20%) 0%, hsl(${(hue + 40) % 360}, 35%, 12%) 100%)`,
      }}
    >
      {manga
        ? <BookOpen size={28} className="text-white/20" strokeWidth={1.5} />
        : <Film size={28} className="text-white/20" strokeWidth={1.5} />}
      <span className="line-clamp-3 text-center text-xs font-medium leading-relaxed text-white/50">
        {title}
      </span>
    </div>
  );
}

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}

function toErrorMessage(error: unknown, kind: MediaKind = 'anime') {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return kind === 'manga' ? '无法加载漫画列表' : '无法加载动画列表'
}
