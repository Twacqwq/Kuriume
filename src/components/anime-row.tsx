import { useRef } from "react";
import { ChevronLeft, ChevronRight, Play, Star } from "lucide-react";
import type { Anime } from "@/lib/mock-data";

interface AnimeRowProps {
  title: string;
  items: Anime[];
}

export function AnimeRow({ title, items }: AnimeRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <section className="group/row">
      <h2 className="mb-4 text-xl font-bold text-white">{title}</h2>

      <div className="relative">
        {/* Scroll Buttons */}
        <button
          onClick={() => scroll("left")}
          className="absolute -left-3 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 group-hover/row:opacity-100"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          onClick={() => scroll("right")}
          className="absolute -right-3 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 group-hover/row:opacity-100"
        >
          <ChevronRight className="size-5" />
        </button>

        {/* Cards */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth pb-2 scrollbar-hide"
        >
          {items.map((anime) => (
            <AnimeCard key={anime.id} anime={anime} />
          ))}
        </div>
      </div>
    </section>
  );
}

function AnimeCard({ anime }: { anime: Anime }) {
  return (
    <div className="group/card w-45 shrink-0 cursor-pointer">
      {/* Cover */}
      <div className="relative mb-2.5 aspect-3/4 overflow-hidden rounded-xl bg-zinc-800">
        <img
          src={anime.cover}
          alt={anime.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-105"
          loading="lazy"
        />

        {/* Hover Overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100">
          <div className="flex size-12 items-center justify-center rounded-full bg-red-600/90 text-white backdrop-blur">
            <Play className="size-5 fill-white" />
          </div>
        </div>

        {/* Rating Badge */}
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 backdrop-blur">
          <Star className="size-3 fill-yellow-400 text-yellow-400" />
          <span className="text-[11px] font-medium text-white">
            {anime.rating}
          </span>
        </div>

        {/* Episodes */}
        <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-zinc-300 backdrop-blur">
          {anime.episodes} 集
        </div>
      </div>

      {/* Info */}
      <h3 className="truncate text-sm font-medium text-white group-hover/card:text-red-400 transition-colors">
        {anime.title}
      </h3>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
        <span>{anime.year}</span>
        <span>·</span>
        <span>{anime.genres[0]}</span>
      </div>
    </div>
  );
}
