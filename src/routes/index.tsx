import { createFileRoute } from "@tanstack/react-router";
import { HeroBanner } from "@/components/HeroBanner";
import {
  heroItems,
} from "@/lib/mock-data";


export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <div>
      <HeroBanner items={heroItems} />
      {/* Future content area — overlaps banner fade zone */}
      <div className="relative z-10 -mt-12 px-8 md:px-12 lg:px-16">
        {/* Grid list will go here */}
      </div>
    </div>
  );
}
