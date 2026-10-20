import { cn } from "@/lib/utils";

/**
 * The app's loading mark: a 梅 (plum) blossom, the second half of the name
 * 栗梅. Plum petals are round, unlike notched cherry petals. Petals light up
 * in turn while the flower turns; larger sizes add twinkles and a drifting
 * petal. Motion stops under prefers-reduced-motion (see `.bloom` in main.css).
 */
const PETALS = [0, 72, 144, 216, 288];
const STAMENS = [18, 54, 90, 126, 162, 198, 234, 270, 306, 342];

export function BloomMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true" className={cn("bloom-mark", className)}>
      <g className="bloom-flower">
        {PETALS.map((angle, index) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <circle className="bloom-petal" style={{ "--i": index } as React.CSSProperties} cx="0" cy="-23" r="17" />
          </g>
        ))}
        <circle className="bloom-heart" r="9" />
        {STAMENS.map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <line className="bloom-stamen" x1="0" y1="-6" x2="0" y2="-14" />
            <circle className="bloom-pollen" cx="0" cy="-15" r="1.8" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function Twinkle({ className }: { className: string }) {
  return (
    <svg viewBox="-10 -10 20 20" aria-hidden="true" className={cn("bloom-twinkle", className)}>
      <path d="M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10Z" />
    </svg>
  );
}

type BloomSize = "sm" | "md" | "lg";

export function BloomLoader({ size = "md", label, tone = "default", className }: {
  size?: BloomSize;
  /** Visible text; also the accessible status. */
  label?: string;
  /** "inverse" for text over video (white-ish). */
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inline = size === "sm";
  return (
    <div role="status" aria-label={label ? undefined : "Loading"} className={cn(inline ? "flex items-center gap-2" : "flex flex-col items-center gap-4", className)}>
      <span className={cn("bloom relative inline-grid shrink-0 place-items-center", `bloom-${size}`)}>
        <BloomMark className="size-full" />
        {!inline && (
          <>
            <Twinkle className="left-[-14%] top-[8%] [--d:0s]" />
            <Twinkle className="right-[-10%] top-[-6%] [--d:.7s]" />
            <Twinkle className="bottom-[2%] right-[-18%] [--d:1.3s]" />
            <span aria-hidden="true" className="bloom-drift" />
          </>
        )}
      </span>
      {label && (
        <span className={cn(inline ? "text-xs" : "text-sm", tone === "inverse" ? "text-white/60" : "text-muted-foreground")}>{label}</span>
      )}
    </div>
  );
}
