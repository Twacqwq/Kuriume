import { cn } from "@/lib/utils";

/**
 * Kuri (栗), the app's mascot: a round chestnut with a 金茶 leaf, drawn in a
 * soft, flat, thin-outline style. Loaders show it hopping (squash and
 * stretch) and blinking; larger sizes add twinkles and falling leaves.
 * Motion stops under prefers-reduced-motion (see `.kuri` in main.css).
 * The same drawing is inlined in index.html for the launch splash.
 */
export function KuriMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 -4 100 104" aria-hidden="true" className={cn("kuri-mark overflow-visible", className)}>
      <g className="kuri-shadow"><ellipse cx="50" cy="96" rx="25" ry="3.2" fill="#000" opacity=".32"/></g>
      <g className="kuri-body">
      <path d="M50 10 C61 18 84 32 86.5 57.5 C88.5 78 71.5 92 50 92 C28.5 92 11.5 78 13.5 57.5 C16 32 39 18 50 10Z" fill="#9c5639" stroke="#4b261c" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M14.4 65 C30 72 70 72 85.6 65 C82.5 82.5 68.5 92 50 92 C31.5 92 17.5 82.5 14.4 65Z" fill="#efd9b4" stroke="#4b261c" strokeWidth="2" strokeLinejoin="round"/>
      <g fill="#cfae84"><circle cx="27" cy="74" r=".9"/><circle cx="35" cy="80" r=".9"/><circle cx="44" cy="76" r=".9"/><circle cx="53" cy="82" r=".9"/><circle cx="62" cy="77" r=".9"/><circle cx="71" cy="80" r=".9"/><circle cx="40" cy="86" r=".9"/><circle cx="58" cy="87" r=".9"/><circle cx="76" cy="73.5" r=".9"/><circle cx="49" cy="86.5" r=".9"/></g>
      <path d="M27 36 C31 28 38 22 44 18.5" stroke="#fff" strokeOpacity=".42" strokeWidth="3.2" strokeLinecap="round" fill="none"/>
      <path d="M50 10 C50.5 6 53 3.5 56 3" stroke="#4b261c" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path className="kuri-leaf" d="M56 3 C62 -3 72 -1 74 4 C68 9 60 8 56 3Z" fill="#c8a36c" stroke="#4b261c" strokeWidth="1.6" strokeLinejoin="round"/>
      <path className="kuri-leaf-vein" d="M58 3.4 C63 2.6 68 2.8 72 4" stroke="#4b261c" strokeWidth="1" strokeLinecap="round" fill="none"/>
      <g className="kuri-eyes">
      <ellipse cx="37.5" cy="52" rx="3.6" ry="4.8" fill="#2c1511"/><ellipse cx="62.5" cy="52" rx="3.6" ry="4.8" fill="#2c1511"/>
      <circle cx="38.8" cy="50" r="1.5" fill="#fff"/><circle cx="63.8" cy="50" r="1.5" fill="#fff"/>
      <circle cx="36.4" cy="54.6" r=".7" fill="#fff" opacity=".8"/><circle cx="61.4" cy="54.6" r=".7" fill="#fff" opacity=".8"/>
      </g>
      <ellipse cx="28.5" cy="59.5" rx="5.2" ry="2.7" fill="#f4a195" opacity=".7"/><ellipse cx="71.5" cy="59.5" rx="5.2" ry="2.7" fill="#f4a195" opacity=".7"/>
      <path d="M46.8 58.2 Q50 63 53.2 58.2 Z" fill="#7a2c26" stroke="#2c1511" strokeWidth="1.3" strokeLinejoin="round"/>
      </g>
    </svg>
  );
}

function Twinkle({ className }: { className: string }) {
  return (
    <svg viewBox="-10 -10 20 20" aria-hidden="true" className={cn("kuri-twinkle", className)}>
      <path d="M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10Z" />
    </svg>
  );
}

function FallingLeaf({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 12" aria-hidden="true" className={cn("kuri-fall", className)}>
      <path d="M1 6 C6 -1 16 0 19 6 C14 12 5 12 1 6Z" />
    </svg>
  );
}

type KuriSize = "sm" | "md" | "lg";

export function KuriLoader({ size = "md", label, tone = "default", className }: {
  size?: KuriSize;
  /** Visible text; also the accessible status. */
  label?: string;
  /** "inverse" for text over video. */
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inline = size === "sm";
  return (
    <div role="status" aria-label={label ? undefined : "Loading"} className={cn(inline ? "flex items-center gap-2" : "flex flex-col items-center gap-3", className)}>
      <span className={cn("kuri relative inline-grid shrink-0 place-items-center", `kuri-${size}`)}>
        <KuriMark className="size-full" />
        {!inline && (
          <>
            <Twinkle className="left-[-22%] top-[6%] [--d:0s]" />
            <Twinkle className="right-[-20%] top-[-10%] [--d:.8s]" />
            <FallingLeaf className="left-[78%] top-[-4%] [--d:.2s]" />
            <FallingLeaf className="left-[8%] top-[-12%] [--d:1.5s]" />
          </>
        )}
      </span>
      {label && (
        <span className={cn(inline ? "text-xs" : "text-sm", tone === "inverse" ? "text-white/60" : "text-muted-foreground")}>{label}</span>
      )}
    </div>
  );
}
