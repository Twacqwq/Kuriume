import { createFileRoute } from "@tanstack/react-router";
import { HeroBanner } from "@/components/hero-banner";
import { AnimeRow } from "@/components/anime-row";
import {
  heroAnime,
  trendingAnime,
  newReleases,
  classicAnime,
} from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <div className="space-y-10 p-6 pb-12">
      <HeroBanner anime={heroAnime} />
      <AnimeRow title="🔥 正在热播" items={trendingAnime} />
      <AnimeRow title="✨ 新番上线" items={newReleases} />
      <AnimeRow title="👑 经典必看" items={classicAnime} />
    </div>
  );
}
