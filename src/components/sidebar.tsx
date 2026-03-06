import { cn } from "@/lib/utils";
import { Compass, Heart, Clock, Settings, TrendingUp, Library } from "lucide-react";
import { useState } from "react";

const navItems = [
  { icon: Compass, label: "发现", active: true },
  { icon: TrendingUp, label: "排行" },
  { icon: Library, label: "追番" },
  { icon: Heart, label: "收藏" },
  { icon: Clock, label: "历史" },
];

export function Sidebar() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <aside
      className={cn(
        "sticky left-0 top-0 z-40 flex h-screen w-17 shrink-0 flex-col",
        "border-r border-white/8 bg-sidebar backdrop-blur-xl transition-all duration-300"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-center">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-bold text-white text-sm shadow-lg shadow-primary/25">
          K
        </div>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex flex-1 flex-col items-center gap-1 px-2">
        {navItems.map((item, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={item.label}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "group relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5 transition-all duration-200",
                isActive
                  ? "bg-white/8 text-primary"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground"
              )}
            >
              {/* Active indicator */}
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-0.75 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              )}
              <item.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] leading-none font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom settings */}
      <div className="flex flex-col items-center gap-1 px-2 pb-4">
        <button className="flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-muted-foreground transition-colors hover:bg-white/4 hover:text-foreground">
          <Settings size={20} strokeWidth={1.8} />
          <span className="text-[10px] leading-none font-medium">设置</span>
        </button>
      </div>
    </aside>
  );
}