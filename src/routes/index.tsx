import { createFileRoute } from "@tanstack/react-router";
import { HeroBanner } from "@/components/hero-banner";
import { AnimeGrid } from "@/components/anime-grid";
import {
  heroItems,
  createMockFetchPage,
} from "@/lib/mock-data";
import { useMemo } from "react";


export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const fetchPage = useMemo(() => createMockFetchPage(20, 10), []);

  return (
    <div>
      <HeroBanner items={heroItems} />
      {/* Content area — overlaps banner fade zone */}
      <div className="relative z-10 -mt-12 pt-6 px-8 pb-12 md:px-12 lg:px-16">
        <AnimeGrid title="全部番剧" fetchPage={fetchPage} />
      </div>
    </div>
  );
}
