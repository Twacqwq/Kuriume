import { Play, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Anime } from "@/lib/mock-data";

interface HeroBannerProps {
  anime: Anime & { banner: string };
}

export function HeroBanner({ anime }: HeroBannerProps) {
  return (
    <section className="relative h-[480px] w-full overflow-hidden rounded-2xl">
      {/* Background Image */}
      <img
        src={anime.banner}
        alt={anime.title}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

      {/* Content */}
      <div className="relative flex h-full flex-col justify-end p-10">
        {/* Badges */}
        <div className="mb-3 flex items-center gap-3">
          <span className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
            热播
          </span>
          <span className="flex items-center gap-1 text-sm text-yellow-400">
            <Star className="size-3.5 fill-yellow-400" />
            {anime.rating}
          </span>
          <span className="text-sm text-zinc-300">{anime.year}</span>
          <span className="text-sm text-zinc-300">{anime.episodes} 集</span>
        </div>

        {/* Title */}
        <h1 className="mb-3 text-4xl font-bold tracking-tight text-white">
          {anime.title}
        </h1>

        {/* Genres */}
        <div className="mb-3 flex gap-2">
          {anime.genres.map((genre) => (
            <span
              key={genre}
              className="rounded-full border border-white/20 px-3 py-0.5 text-xs text-zinc-300"
            >
              {genre}
            </span>
          ))}
        </div>

        {/* Description */}
        <p className="mb-6 max-w-xl text-sm leading-relaxed text-zinc-300">
          {anime.description}
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <Button className="gap-2 bg-red-600 px-6 text-white hover:bg-red-700">
            <Play className="size-4 fill-white" />
            立即观看
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20"
          >
            <Plus className="size-4" />
            加入片单
          </Button>
        </div>
      </div>
    </section>
  );
}
