import { Link } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Star, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { AnimeInfo, PagedResult } from '@/lib/types'

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
  const sentinelRef = useRef<HTMLDivElement>(null)

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

  // Flatten all pages into a single list
  const items: AnimeCardItem[] =
    data?.pages.flatMap((page) =>
      page.data.map((item) => ({
        id: Number(item.id),
        title: item.title_cn || item.title,
        cover: item.cover ?? '',
        score: item.score ?? 0,
        year: item.year ?? 0,
        episodes: item.total_episodes,
        genre: item.genres,
      })),
    ) ?? []

  // IntersectionObserver — prefetch when sentinel is near viewport
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    // Find the actual scroll container (<main> with overflow-y-auto)
    const scrollRoot = sentinel.closest('main')

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { root: scrollRoot, rootMargin: '1200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const showInitialSkeleton = isLoading

  return (
    <section className="px-6 py-8 md:px-10 lg:px-12 xl:px-16">
      {title && (
        <h2 className="text-xl font-bold text-foreground mb-6">{title}</h2>
      )}
      {/* Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {items.map((item) => (
          <AnimeCard key={item.id} item={item} />
        ))}
        {/* Initial skeleton or loading-more skeleton */}
        {(showInitialSkeleton || isFetchingNextPage) &&
          Array.from({
            length: showInitialSkeleton ? pageSize : Math.min(pageSize, 14),
          }).map((_, i) => (
            <div key={`skeleton-${i}`} className="animate-pulse">
              <div className="aspect-2/3 rounded-lg bg-card" />
              <div className="mt-2 space-y-1.5">
                <div className="h-4 w-3/4 rounded bg-card" />
                <div className="h-3 w-1/2 rounded bg-card" />
              </div>
            </div>
          ))}
      </div>
      {/* Sentinel for triggering next page */}
      {hasNextPage && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {isFetchingNextPage && !showInitialSkeleton && (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
      {/* End message */}
      {!hasNextPage && items.length > 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">
          已经到底了 ~
        </p>
      )}
    </section>
  )
}

export interface AnimeCardItem {
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

function AnimeCard({ item }: AnimeCardProps) {
  return (
    <Link to="/anime/$id" params={{ id: String(item.id) }} className="group cursor-pointer">
      {/* Cover */}
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-card">
        <img
          src={item.cover}
          alt={item.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
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
        <div className="flex gap-1.5">
          {item.genre.slice(0, 2).map((g) => (
            <span key={g} className="text-xs text-muted-foreground/70">
              {g}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}