import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Info, Pause, Play, Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface BannerItem {
  id: number
  title: string
  cover: string
  score: number
  year: number
  episodes: number
  genre: string[]
  description: string
}

interface HeroBannerProps {
  items: BannerItem[]
  /** Auto-rotate interval in ms, default 8000 */
  interval?: number
}

export function HeroBanner({ items, interval = 8000 }: HeroBannerProps) {
  const [current, setCurrent] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval>>(null)
  const count = items.length

  const goTo = useCallback(
    (index: number) => {
      if (isTransitioning) return
      setIsTransitioning(true)
      setCurrent((index + count) % count)
      setTimeout(() => setIsTransitioning(false), 600)
    },
    [count, isTransitioning],
  )

  const next = useCallback(() => goTo(current + 1), [current, goTo])
  const prev = useCallback(() => goTo(current - 1), [current, goTo])

  // Auto-rotate
  useEffect(() => {
    if (isPaused || count <= 1) return
    timerRef.current = setInterval(next, interval)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPaused, next, interval, count])

  const item = items[current]

  if (!item) {
    // Loading skeleton while banner data is being fetched
    return (
      <section className="relative w-full overflow-hidden" style={{ height: '50vh' }}>
        <div className="absolute inset-0 animate-pulse bg-card" />
      </section>
    )
  }

  return (
    <section
      className="group/hero relative w-full overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Blurred background layer */}
      {items.map((it, i) => (
        <div
          key={it.id}
          className={cn(
            'absolute inset-0 transition-opacity duration-700 ease-in-out',
            i === current ? 'opacity-100' : 'opacity-0',
          )}
        >
          <img
            src={it.cover}
            alt=""
            className="h-full w-full scale-110 object-cover blur-sm brightness-65 saturate-130"
          />
        </div>
      ))}

      {/* Gradient overlay for bottom fade */}
      <div className="absolute inset-0 bg-linear-to-t from-background via-transparent to-transparent" />

      {/* Spotlight layout */}
      <div className="relative flex min-h-120 items-center px-8 py-16 md:px-16 lg:px-24">
        {/* Left: text info */}
        <div
          key={`info-${current}`}
          className="flex-1 space-y-4 pr-8 animate-in fade-in slide-in-from-left-4 duration-500 md:pr-16"
        >
          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
              <Star size={12} fill="currentColor" />
              {item.score}
            </Badge>
            <Badge variant="outline" className="border-white/20 text-white/70">
              {item.year}
            </Badge>
            <Badge variant="outline" className="border-white/20 text-white/70">
              全{item.episodes}话
            </Badge>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            {item.title}
          </h1>

          {/* Genre tags */}
          <div className="flex gap-2">
            {item.genre.map((g) => (
              <span key={g} className="text-sm text-white/60">
                {g}
              </span>
            ))}
          </div>

          {/* Description */}
          <p className="text-sm leading-relaxed text-white/60 md:text-base line-clamp-3 max-w-lg">
            {item.description}
          </p>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button size="lg" className="gap-2 rounded-full px-8">
              <Play size={18} fill="currentColor" />
              立即播放
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="gap-2 rounded-full px-6 bg-white/10 hover:bg-white/20 border-0"
            >
              <Info size={18} />
              详情
            </Button>
          </div>
        </div>

        {/* Right: cover card */}
        <div className="hidden md:block relative shrink-0">
          {items.map((it, i) => (
            <div
              key={it.id}
              className={cn(
                'transition-all duration-700 ease-in-out',
                i === current
                  ? 'opacity-100 scale-100 translate-y-0'
                  : 'opacity-0 scale-95 translate-y-4 absolute inset-0',
              )}
            >
              {/* Glow */}
              <img
                src={it.cover}
                alt=""
                className="absolute inset-0 m-auto h-full w-full object-cover blur-2xl opacity-30 scale-110 rounded-2xl"
              />
              {/* Cover */}
              <img
                src={it.cover}
                alt={it.title}
                className="relative h-95 w-auto rounded-2xl object-cover shadow-2xl shadow-black/50 ring-1 ring-white/10 lg:h-105"
              />
            </div>
          ))}
        </div>
      </div>
      {/* Navigation arrows (visible on hover) */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-sm transition-all hover:bg-black/60 group-hover/hero:opacity-100"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-sm transition-all hover:bg-black/60 group-hover/hero:opacity-100"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Bottom indicator bar */}
      {count > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                onClick={() => goTo(i)}
                className="group/dot relative h-1 overflow-hidden rounded-full transition-all duration-300"
                style={{ width: i === current ? 32 : 8 }}
              >
                <div className="absolute inset-0 bg-white/30" />
                {i === current && (
                  <div
                    className="absolute inset-0 rounded-full bg-white"
                    style={{
                      animation: isPaused ? 'none' : `hero-progress ${interval}ms linear`,
                    }}
                  />
                )}
                {i !== current && (
                  <div className="absolute inset-0 rounded-full bg-white/30 hover:bg-white/50 transition-colors" />
                )}
              </button>
            ))}
          </div>

          {/* Play/pause toggle */}
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/60 hover:text-white transition-colors"
          >
            {isPaused ? (
              <Play size={12} fill="currentColor" />
            ) : (
              <Pause size={12} fill="currentColor" />
            )}
          </button>
        </div>
      )}

      {/* Progress animation keyframes */}
      <style>{`
        @keyframes hero-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </section>
  )
}