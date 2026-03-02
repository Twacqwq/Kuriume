import { cn } from "@/lib/utils";

export function Sidebar() {
  return (
    <aside
      className={cn(
        "sticky left-0 top-0 z-40 flex h-screen shrink-0 flex-col border-r border-white/5 bg-black/80 backdrop-blur-xl transition-all duration-300"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-white text-sm">
          K
        </div>
      </div>
    </aside>
  );
}