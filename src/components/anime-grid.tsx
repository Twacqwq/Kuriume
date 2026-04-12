import { Link } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Star, Film } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { AnimeInfo, PagedResult } from '@/lib/types'

/* ── Responsive column count (matches Tailwind grid breakpoints) ── */

function calcColumns(width: number): number {
  if (width >= 1536) return 7  // 2xl
  if (width >= 1280) return 6  // xl
  if (width >= 1024) return 5  // lg
  if (width >= 768) return 4   // md
  return 2
}

function useColumnCount(): number {
  const [cols, setCols] = useState(() => calcColumns(window.innerWidth))
  useEffect(() => {
    const handler = () => setCols(calcColumns(window.innerWidth))
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return cols
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
}

export function AnimeGrid<TPageParam>({
  queryKey,
  queryFn,
  initialPageParam,
  getNextPageParam,
  title,
  pageSize = 30,
}: AnimeGridProps<TPageParam>) {
  const gridRef = useRef<HTMLDivElement>(null)
  const cols = useColumnCount()

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => queryFn(pageParam as TPageParam),
    initialPageParam,
    getNextPageParam: (lastPage, allPages, lastPageParam) =>
      getNextPageParam(lastPage, allPages, lastPageParam),
  })

  // Flatten all pages into a single list (memoized to avoid re-creating objects)
  const items: AnimeCardItem[] = useMemo(
    () =>
      data?.pages.flatMap((page) =>
        page.data.map((item) => ({
          id: Number(item.id),
          title: item.title_cn || item.title,
          cover: item.cover ?? '',
          score: item.score ?? 0,
          year: item.year ?? 0,
          episodes: item.total_episodes,
          genre: [...new Set(item.genres)],
        })),
      ) ?? [],
    [data?.pages],
  )

  /* ── Scroll container & margin ── */

  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  // Callback ref: find scroll container and measure offset when grid mounts
  const gridCallbackRef = useCallback((node: HTMLDivElement | null) => {
    gridRef.current = node
    if (!node) return
    const main = node.closest('main') as HTMLElement | null
    if (!main) return
    setScrollEl(main)
    const gridRect = node.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    setScrollMargin(Math.round(gridRect.top - mainRect.top + main.scrollTop))
  }, [])

  // Re-measure margin on resize
  useEffect(() => {
    if (!scrollEl) return
    const handler = () => {
      const grid = gridRef.current
      if (!grid) return
      const gridRect = grid.getBoundingClientRect()
      const mainRect = scrollEl.getBoundingClientRect()
      setScrollMargin((prev) => {
        const next = Math.round(gridRect.top - mainRect.top + scrollEl.scrollTop)
        return prev === next ? prev : next
      })
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [scrollEl])

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
    if (last.index >= rowCount - 2 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [virtualItems, rowCount, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <section className="px-4 py-6 md:px-10 md:py-8 lg:px-12 xl:px-16">
      {title && (
        <h2 className="text-xl font-bold text-foreground mb-6">{title}</h2>
      )}

      {isLoading ? (
        /* Skeleton while initial data loads */
        <div className="grid grid-cols-3 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {Array.from({ length: pageSize }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
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
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {Array.from({ length: Math.min(pageSize, 14) }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {/* End message */}
          {!hasNextPage && items.length > 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              已经到底了 ~
            </p>
          )}
        </>
      )}
    </section>
  )
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-2/3 rounded-lg bg-card" />
      <div className="mt-2 space-y-1.5">
        <div className="h-4 w-3/4 rounded bg-card" />
        <div className="h-3 w-1/2 rounded bg-card" />
      </div>
    </div>
  )
}

interface AnimeCardItem {
  id: number
  title: string
  cover: string
  score: number
  year: number
  episodes: number
  genre: string[]
}

interface AnimeCardProps {
  item: AnimeCardItem
}

const AnimeCard = memo(function AnimeCard({ item }: AnimeCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasCover = item.cover && !imgFailed;

  return (
    <Link to="/anime/$id" params={{ id: String(item.id) }} className="group cursor-pointer">
      {/* Cover */}
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-card">
        {hasCover ? (
          <img
            src={item.cover}
            alt={item.title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <CoverFallback title={item.title} />
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/30" />
        {/* Score badge */}
        {item.score > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-yellow-400 backdrop-blur-sm">
            <Star size={10} fill="currentColor" />
            {item.score}
          </div>
        )}
      </div>
      {/* Info */}
      <div className="mt-2 space-y-1">
        <h3 className="text-sm font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">
          {item.title}
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{item.year}</span>
          <span>·</span>
          <span>{item.episodes}话</span>
        </div>
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
function CoverFallback({ title }: { title: string }) {
  const hue = hashStringToHue(title);
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

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}