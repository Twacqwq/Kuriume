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
    <div className="">
      <HeroBanner items={heroItems} />
    </div>
  );
}
