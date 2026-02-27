import { cn } from "@/lib/utils";

export function Sidebar() {
  const collapsed = true;

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-white/5 bg-black/80 backdrop-blur-xl transition-all duration-300",
        collapsed ? "w-18" : "w-55"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-600 font-bold text-white text-sm">
          K
        </div>
        {!collapsed && (
          <span className="text-lg font-bold tracking-wider text-white">
            Kuriume
          </span>
        )}
      </div>
    </aside>
  );
}
