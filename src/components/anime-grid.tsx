import { Link } from '@tanstack/react-router'
import { Star, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface AnimeGridProps {
  /** Fetch a page of items. Return empty array when no more data. */
  fetchPage: (page: number) => Promise<AnimeCardItem[]>
  /** Grid section title */
  title?: string
  /** Items per page, for skeleton count */
  pageSize?: number
}

export function AnimeGrid({ fetchPage, title, pageSize = 20 }: AnimeGridProps) {
  const [items, setItems] = useState<AnimeCardItem[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const nextPage = page + 1
      const newItems = await fetchPage(nextPage)
      if (newItems.length === 0) {
        setHasMore(false)
      } else {
        setItems((prev) => [...prev, ...newItems])
        setPage(nextPage)
      }
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
    <section className="px-6 py-8 md:px-10 lg:px-12 xl:px-16">
      {title && (
        <h2 className="text-xl font-bold text-foreground mb-6">{title}</h2>
      )}
      {/* Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {items.map((item) => (
          <AnimeCard key={item.id} item={item} />
        ))}
        {/* Skeletons while loading */}
        {loading &&
          Array.from({ length: pageSize }).map((_, i) => (
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
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
        </div>
      )}
      {/* End message */}
      {!hasMore && items.length > 0 && (
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