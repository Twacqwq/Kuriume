import { Button } from "@/components/ui/button";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import {
  displayAnimeDescription,
  displayAnimeTitle,
} from "@/lib/display-language";
import type { AnimeInfo } from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

interface HeroBannerProps {
  items: readonly AnimeInfo[];
}

export function HeroBanner({ items }: HeroBannerProps) {
  const language = useDisplayLanguage();
  const [current, setCurrent] = useState(0);
  const activeIndex = items.length > 0 ? Math.min(current, items.length - 1) : 0;
  const media = items[activeIndex];
  const { data: localizedMedia } = useQuery({
    queryKey: ["anime-detail", media?.id, language],
    queryFn: () =>
      invoke<AnimeInfo>("get_detail", {
        provider: "AniList",
        id: media!.id,
        language,
      }),
    enabled: Boolean(media && language === "zh"),
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

  useEffect(() => {
    if (!nextArtwork) return;
    const image = new Image();
    image.decoding = "async";
    image.src = nextArtwork;
  }, [nextArtwork]);

  if (!media) {
    return (
      <section
        aria-label="本季推荐"
        className="h-[clamp(360px,48vh,520px)] overflow-hidden rounded-2xl bg-card"
      >
        <h1 className="sr-only">Kuriume</h1>
        <div className="h-full animate-pulse bg-muted/45 motion-reduce:animate-none" />
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

  return (
    <section
      aria-roledescription="carousel"
      aria-label="本季推荐"
      aria-labelledby={`hero-title-${media.anilist_id}`}
      className="relative isolate h-[clamp(360px,48vh,520px)] overflow-hidden rounded-2xl bg-card shadow-[0_24px_72px_-40px_rgba(0,0,0,0.9)]"
    >
      {artwork && (
        <img
          key={`${media.id}-backdrop`}
          src={artwork}
          alt=""
          loading={activeIndex === 0 ? "eager" : "lazy"}
          fetchPriority={activeIndex === 0 ? "high" : "auto"}
          decoding="async"
          className="hero-media-enter absolute inset-0 h-full w-full object-cover object-center motion-reduce:animate-none"
        />
      )}

      <div className="absolute inset-0 bg-linear-to-r from-[#0b090a] via-[#0b090a]/82 to-[#0b090a]/16" />
      <div className="absolute inset-0 bg-linear-to-t from-[#0b090a]/78 via-transparent to-black/12" />

      <div
        key={`${media.id}-content`}
        className="hero-copy-enter relative z-10 flex h-full max-w-3xl flex-col justify-end px-8 pb-10 pt-12 motion-reduce:animate-none lg:px-12 lg:pb-12"
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-2 text-xs font-medium text-white/72">
          {media.year && <span>{media.year}</span>}
          {media.format && <span>· {formatMediaFormat(media.format)}</span>}
          {media.score && <span>· {media.score.toFixed(1)}</span>}
          {media.total_episodes > 0 && <span>· {media.total_episodes} 话</span>}
        </div>

        <h1
          id={`hero-title-${media.anilist_id}`}
          className="max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.025em] text-white xl:text-5xl"
        >
          {title}
        </h1>

        {description && (
          <p className="mt-4 line-clamp-2 max-w-xl text-sm leading-6 text-white/72">
            {description}
          </p>
        )}

        <div className="mt-7">
          <Button asChild size="lg" className="shadow-md shadow-black/20">
            <Link to="/anime/$id" params={{ id: media.id }}>
              查看详情
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
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

      {hasNavigation && (
        <div className="absolute right-6 top-6 z-20 flex items-center gap-1 rounded-lg bg-black/44 p-1 text-white shadow-md shadow-black/20">
          <span className="min-w-14 px-2 text-center text-xs tabular-nums text-white/72">
            {String(activeIndex + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={() => move(-1)}
            aria-label="上一部作品"
            className="text-white/78 hover:bg-white/12 hover:text-white"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={() => move(1)}
            aria-label="下一部作品"
            className="text-white/78 hover:bg-white/12 hover:text-white"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {title}，第 {activeIndex + 1} 部，共 {items.length} 部
      </p>
    </section>
  );
}

function formatMediaFormat(format: string) {
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
