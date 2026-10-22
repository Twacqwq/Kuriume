import { Button } from "@/components/ui/button";
import { catalogProviderFor } from "@/lib/store";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  displayAnimeDescription,
  displayAnimeTitle,
} from "@/lib/display-language";
import type { AnimeInfo } from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface HeroBannerProps {
  items: readonly AnimeInfo[];
}

const HERO_DETAIL_DELAY_MS = 800;
/** Time each highlight stays before the carousel moves on by itself. */
export const HERO_AUTOPLAY_MS = 6000;

export function HeroBanner({ items }: HeroBannerProps) {
  const language = useDisplayLanguage();
  const [current, setCurrent] = useState(0);
  const activeIndex = items.length > 0 ? Math.min(current, items.length - 1) : 0;
  const media = items[activeIndex];
  // The synopsis only shows from md up. Fetch it once a slide has stayed on
  // screen for a moment, so swiping through the carousel costs no lookups.
  const showsSynopsis = useMediaQuery("(min-width: 768px)");
  const [settledId, setSettledId] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => setSettledId(media?.id), HERO_DETAIL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [media?.id]);
  const { data: localizedMedia } = useQuery({
    queryKey: ["anime-detail", media?.id, language],
    queryFn: () =>
      invoke<AnimeInfo>("get_detail", {
        provider: catalogProviderFor(media!.id),
        id: media!.id,
        language,
      }),
    enabled: Boolean(
      media && language === "zh" && settledId === media.id &&
        (showsSynopsis || !media.title_cn),
    ),
    staleTime: 1000 * 60 * 60,
  });
  const nextArtwork =
    items.length > 1
      ? items[(activeIndex + 1) % items.length]?.banner ||
        items[(activeIndex + 1) % items.length]?.cover
      : undefined;

  useEffect(() => {
    if (current >= items.length && items.length > 0) setCurrent(0);
  }, [current, items.length]);

  // Advances on its own, but holds while it is touched, hovered or focused,
  // and not at all with reduced motion. Each slide gets the full interval,
  // including right after a manual swipe.
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [held, setHeld] = useState(false);
  const autoplay = items.length > 1 && !reducedMotion && !held;
  useEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(() => setCurrent((index) => (index + 1) % items.length), HERO_AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [autoplay, activeIndex, items.length]);
  // Phones: a horizontal swipe changes the highlight; a tap opens it.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!nextArtwork) return;
    const image = new Image();
    image.decoding = "async";
    image.src = nextArtwork;
  }, [nextArtwork]);

  if (!media) {
    return (
      <section
        aria-label={language === "zh" ? "本季推荐" : "Season highlights"}
        className="min-h-96 overflow-hidden rounded-2xl bg-card md:h-[clamp(400px,48vh,520px)]"
      >
        <h1 className="sr-only">Kuriume</h1>
        <div className="min-h-96 h-full animate-pulse bg-muted/45 motion-reduce:animate-none" />
      </section>
    );
  }

  const displayMedia = localizedMedia ?? media;
  const title = displayAnimeTitle(displayMedia, language);
  const description = displayAnimeDescription(displayMedia, language);
  const artwork = media.banner || media.cover;
  const hasNavigation = items.length > 1;

  const move = (offset: number) => {
    setCurrent((index) => (index + offset + items.length) % items.length);
  };
  const onTouchStart = (event: React.TouchEvent) => {
    setHeld(true);
    const touch = event.touches[0];
    swipe.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    setHeld(false);
    const start = swipe.current;
    swipe.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || !hasNavigation) return;
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (event.cancelable) event.preventDefault();
      move(dx < 0 ? 1 : -1);
    }
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={language === "zh" ? "本季推荐" : "Season highlights"}
      aria-labelledby={`hero-title-${media.id.replace(":", "-")}`}
      className="relative isolate flex aspect-[16/10] flex-col overflow-hidden rounded-2xl bg-card min-[480px]:aspect-[16/8] md:aspect-auto md:min-h-[clamp(400px,48vh,520px)]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { swipe.current = null; setHeld(false); }}
      // Touch screens send a compatibility mouseenter after a tap and never
      // leave; only a real mouse holds the carousel by hovering.
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHeld(true); }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setHeld(false); }}
      onFocus={() => setHeld(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}
    >
      <Link to="/anime/$id" params={{ id: media.id }} aria-labelledby={`hero-title-${media.id.replace(":", "-")}`}
        className="absolute inset-0 z-20 rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-primary-readable md:hidden" />
      {artwork && (
        <img
          key={`${media.id}-backdrop`}
          src={artwork}
          alt=""
          loading={activeIndex === 0 ? "eager" : "lazy"}
          fetchPriority={activeIndex === 0 ? "high" : "auto"}
          decoding="async"
          className="hero-media-enter absolute inset-0 h-full w-full object-cover object-top motion-reduce:animate-none md:object-center"
        />
      )}

      <div className="absolute inset-0 hidden bg-linear-to-r from-background via-background/80 to-background/8 md:block" />
      <div className="absolute inset-0 bg-linear-to-t from-background via-background/65 to-transparent md:from-background/75 md:via-transparent" />

      <div
        key={`${media.id}-content`}
        className="hero-copy-enter relative z-10 flex flex-1 flex-col justify-end px-4 pb-4 motion-reduce:animate-none md:max-w-3xl md:px-8 md:pb-10 md:pt-16 lg:px-10"
      >
        <div className="flex items-end gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-white/75 md:mb-3">
              {media.year && <span>{media.year}</span>}
              {media.format && <span>· {formatMediaFormat(media.format, language)}</span>}
              {media.score && <span>· {media.score.toFixed(1)}</span>}
            </div>
            <h1
              id={`hero-title-${media.id.replace(":", "-")}`}
              className="line-clamp-2 max-w-2xl text-balance text-[1.375rem] font-bold leading-[1.2] tracking-[-0.025em] text-white md:line-clamp-3 md:text-4xl xl:text-5xl"
            >
              {title}
            </h1>
          </div>
        </div>

        {description && (
          <p className="mt-4 hidden max-w-xl text-sm leading-6 text-white/75 md:line-clamp-2">
            {description}
          </p>
        )}

        {hasNavigation && (
          <div className="mt-3 flex gap-1.5 md:hidden" aria-hidden="true">
            {items.map((item, index) => (
              <span key={item.id} className={`h-1 rounded-full transition-all duration-200 motion-reduce:transition-none ${index === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/40"}`} />
            ))}
          </div>
        )}

        <div className="mt-5 hidden items-center gap-3 md:mt-7 md:flex">
          <Button asChild size="lg" className="min-h-12 rounded-xl px-4 md:px-5">
            <Link to="/anime/$id" params={{ id: media.id }}>
              {language === "zh" ? "查看详情" : "View details"}
              <ArrowRight aria-hidden="true" className="hidden md:block" />
            </Link>
          </Button>
          {hasNavigation && (
            <div className="flex shrink-0 items-center gap-1 text-white md:ml-3">
              <Button type="button" variant="ghost" size="icon-lg" onClick={() => move(-1)} aria-label={language === "zh" ? "上一部作品" : "Previous anime"} className="size-12 rounded-xl text-white/80 hover:bg-white/12 hover:text-white">
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="hidden text-xs tabular-nums text-white/75 min-[360px]:block">{activeIndex + 1} / {items.length}</span>
              <Button type="button" variant="ghost" size="icon-lg" onClick={() => move(1)} aria-label={language === "zh" ? "下一部作品" : "Next anime"} className="size-12 rounded-xl text-white/80 hover:bg-white/12 hover:text-white">
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {media.cover && (
        <div className="absolute bottom-12 right-12 z-10 hidden min-[1440px]:block">
          <img
            key={`${media.id}-poster`}
            src={media.cover}
            alt=""
            loading={activeIndex === 0 ? "eager" : "lazy"}
            decoding="async"
            className="hero-poster-enter aspect-2/3 h-[min(34vh,330px)] rounded-2xl object-cover shadow-[0_24px_60px_-24px_rgba(0,0,0,0.82)] motion-reduce:animate-none"
          />
        </div>
      )}

      {/* Announce only changes the viewer made, not every automatic step. */}
      <p className="sr-only" aria-live={autoplay ? "off" : "polite"} aria-atomic="true">
        {language === "zh" ? `${title}，第 ${activeIndex + 1} 部，共 ${items.length} 部` : `${title}, ${activeIndex + 1} of ${items.length}`}
      </p>
    </section>
  );
}

function formatMediaFormat(format: string, language: "en" | "zh") {
  if (language === "en") return ({ TV_SHORT: "Short", MOVIE: "Movie", SPECIAL: "Special" }[format] ?? format);
  return (
    {
      TV: "TV",
      TV_SHORT: "短篇",
      MOVIE: "电影",
      OVA: "OVA",
      ONA: "ONA",
      SPECIAL: "特别篇",
    }[format] ?? format
  );
}
