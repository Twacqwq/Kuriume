import { Badge } from '@/components/ui/badge'
import type { Anime } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface AnimeGridProps {
  /** Function to fetch a page of anime. Returns items + whether more exist. */
  fetchPage: (page: number) => Promise<{ items: Anime[]; hasMore: boolean }>
  /** Grid section title */
  title?: string
  /** Initial page size hint (for skeleton count), default 20 */
  pageSize?: number
}

export function AnimeGrid({ fetchPage, title, pageSize = 20 }: AnimeGridProps) {
  const [items, setItems] = useState<Anime[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const result = await fetchPage(page)
      setItems((prev) => [...prev, ...result.items])
      setHasMore(result.hasMore)
      setPage((p) => p + 1)
    } finally {
      setLoading(false)
    }
  }, [fetchPage, page, loading, hasMore])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  return (
    <section className="space-y-4">
      {title && (
        <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          {title}
        </h2>
      )}

      {/* Grid */}
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
        {items.map((anime) => (
          <AnimeCard key={anime.id} anime={anime} />
        ))}

        {/* Loading skeletons */}
        {loading &&
          Array.from({ length: pageSize }).map((_, i) => (
            <AnimeCardSkeleton key={`skeleton-${i}`} />
          ))}
      </div>

      {/* Sentinel element for intersection observer */}
      {hasMore && <div ref={sentinelRef} className="h-1" />}

      {/* End of list */}
      {!hasMore && items.length > 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">已经到底了</p>
      )}
    </section>
  )
}

function AnimeCard({ anime }: { anime: Anime }) {
  const [imgLoaded, setImgLoaded] = useState(false)

  return (
    <button
      type="button"
      className="group relative flex flex-col gap-2 text-left outline-none"
    >
      {/* Cover */}
      <div className="relative overflow-hidden rounded-lg aspect-2/3 bg-muted">
        <img
          src={anime.cover}
          alt={anime.title}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          className={cn(
            'h-full w-full object-cover transition-all duration-300 group-hover:scale-105',
            imgLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/20" />

        {/* Score badge */}
        <div className="absolute top-1.5 right-1.5">
          <Badge
            variant="secondary"
            className="gap-0.5 bg-black/60 text-yellow-400 backdrop-blur-sm text-xs px-1.5 py-0.5"
          >
            <Star size={10} fill="currentColor" />
            {anime.score}
          </Badge>
        </div>
      </div>

      {/* Info */}
      <div className="space-y-0.5 px-0.5">
        <h3 className="text-sm font-medium leading-tight text-foreground line-clamp-2 group-hover:text-primary transition-colors">
          {anime.title}
        </h3>
        <p className="text-xs text-muted-foreground">
          {anime.year} · 全{anime.episodes}话
        </p>
      </div>
    </button>
  )
}

function AnimeCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      <div className="rounded-lg aspect-2/3 bg-muted" />
      <div className="space-y-1.5 px-0.5">
        <div className="h-3.5 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
      </div>
    </div>
  )
}
