import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { HeroItem } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Info, Pause, Play, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface HeroBannerProps {
  items: HeroItem[]
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

  const item = items[current]!
  const { anime } = item

  return (
    <section
      className="group/hero relative h-[50vh] min-h-80 w-full overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Blurred background images (stretched cover, all stacked) */}
      {items.map((it, i) => (
        <div
          key={it.anime.id}
          className={cn(
            'absolute inset-0 transition-opacity duration-700 ease-in-out',
            i === current ? 'opacity-100' : 'opacity-0',
          )}
        >
          <img
            src={it.heroCover}
            alt=""
            className="h-full w-full scale-110 object-cover blur-sm brightness-85 saturate-120"
          />
        </div>
      ))}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-linear-to-r from-black/60 via-black/10 to-black/30" />
      <div className="absolute inset-0 bg-linear-to-t from-background via-transparent to-transparent" />

      {/* Content: left info + right cover card */}
      <div className="relative flex h-full items-center justify-between px-8 md:px-12 lg:px-16">
        {/* Left side: text content */}
        <div
          key={current}
          className="flex-1 max-w-xl space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
              <Star size={12} fill="currentColor" />
              {anime.score}
            </Badge>
            <Badge variant="outline" className="border-white/20 text-white/70">
              {anime.year}
            </Badge>
            <Badge variant="outline" className="border-white/20 text-white/70">
              全{anime.episodes}话
            </Badge>
          </div>

          {/* Title */}
          <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-6xl drop-shadow-lg">
            {anime.title}
          </h1>

          {/* Genre tags */}
          <div className="flex gap-2">
            {anime.genre.map((g) => (
              <Badge key={g} variant="outline" className="border-white/15 text-white/60 text-xs">
                {g}
              </Badge>
            ))}
          </div>

          {/* Description */}
          <p className="text-sm leading-relaxed text-white/70 md:text-base line-clamp-3">
            {anime.description}
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

        {/* Right side: portrait cover card */}
        <div
          key={`cover-${current}`}
          className="hidden md:flex items-center shrink-0 animate-in fade-in slide-in-from-right-8 duration-700"
        >
          <div className="relative group/card">
            {/* Glow effect behind card */}
            <div className="absolute -inset-4 rounded-2xl bg-white/5 blur-2xl" />
            {/* Card */}
            <div className="relative w-40 lg:w-48 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 transition-transform duration-300 group-hover/card:scale-[1.02]">
              <img
                src={item.heroCover}
                alt={anime.title}
                className="h-auto w-full object-cover aspect-2/3"
              />
              {/* Subtle bottom gradient on card */}
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/60 to-transparent" />
            </div>
          </div>
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
          {/* Dots / progress bars */}
          <div className="flex items-center gap-1.5">
            {items.map((it, i) => (
              <button
                key={it.anime.id}
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

          {/* Pause/play toggle */}
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/60 hover:text-white transition-colors"
          >
            {isPaused ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />}
          </button>
        </div>
      )}

      {/* Inline keyframes for progress animation */}
      <style>{`
        @keyframes hero-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </section>
  )
}