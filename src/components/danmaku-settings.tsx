import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DANMAKU_GLYPH_PATH, DANMAKU_SETTINGS_PARTS } from "@/components/danmaku-icons";
import { updateDanmakuPrefs, type DanmakuView } from "@/hooks/use-danmaku";
import { formatCount, type DanmakuAnime, type DanmakuPrefs } from "@/lib/danmaku";
import { cn } from "@/lib/utils";
import { Loader2, Minus, Plus, RefreshCw, Search } from "lucide-react";
import { useId, useState } from "react";

/** One line for the toggle, the panel chip and the sheet header. */
export function danmakuSummary(view: DanmakuView, zh: boolean): string {
  switch (view.status) {
    case "off": return zh ? "关" : "Off";
    case "matching":
    case "loading": return zh ? "加载中" : "Loading";
    case "none": return zh ? "无弹幕" : "None";
    case "error": return zh ? "加载失败" : "Failed";
    case "ready": return zh ? `开 · ${formatCount(view.comments?.length ?? 0, zh)} 条` : `On · ${formatCount(view.comments?.length ?? 0, zh)}`;
    default: return "";
  }
}

export function toggleDanmaku(view: DanmakuView) {
  updateDanmakuPrefs({ enabled: !view.prefs.enabled });
}

/**
 * The phone's inline player has no room for danmaku in its bar, so they get
 * a row of their own right under the video, as in the big video apps: the
 * switch (with what is loaded) on the left, settings on the right while on.
 * Fullscreen moves them back into the player bar.
 */
export function DanmakuBar({ view, zh, onOpenSettings }: { view: DanmakuView; zh: boolean; onOpenSettings: () => void }) {
  const on = view.prefs.enabled;
  const count = view.comments?.length ?? 0;
  const detail = !on ? (zh ? "已关闭" : "Off")
    : view.status === "ready" ? (zh ? `${formatCount(count, zh)} 条` : `${formatCount(count, zh)} comments`)
      : view.status === "none" ? (zh ? "这一集没有弹幕" : "None for this episode")
        // A failure says nothing here: the retry button beside settings is enough.
        : view.status === "error" ? ""
          : (zh ? "加载中…" : "Loading…");
  const loading = on && (view.status === "matching" || view.status === "loading");
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-overlay/6 pl-2 pr-1">
      <button type="button" role="switch" aria-checked={on} onClick={() => toggleDanmaku(view)}
        className="flex h-11 min-w-0 items-center gap-2.5 rounded-full px-2 outline-none active:bg-overlay/6 focus-visible:ring-2 focus-visible:ring-primary-readable">
        <span aria-hidden="true" className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none",
          on ? "bg-primary" : "ring-[1.5px] ring-inset ring-muted-foreground/70")}>
          <span className={cn("absolute left-[3px] top-[3px] grid size-4 place-items-center rounded-full transition-[transform,background-color,color] duration-200 motion-reduce:transition-none",
            on ? "translate-x-4 bg-white text-primary" : "bg-muted-foreground text-background", loading && "animate-pulse")}>
            <svg viewBox="0 0 100 100" className="size-2.5" focusable="false"><path fill="currentColor" d={DANMAKU_GLYPH_PATH} /></svg>
          </span>
        </span>
        <span className="truncate text-sm">
          <span className="font-bold">{zh ? "弹幕" : "Danmaku"}</span>
          {detail && <span className="ml-1.5 tabular-nums text-muted-foreground">{detail}</span>}
        </span>
      </button>
      <span className="flex-1" />
      {/* Actions stay on the right: retry (a small outlined pill in a full
          44 px target) beside settings. */}
      {on && view.status === "error" && (
        <button type="button" onClick={view.retry} aria-label={zh ? "重新加载弹幕" : "Reload danmaku"}
          className="group grid h-11 shrink-0 place-items-center px-1 outline-none">
          <span className="flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-foreground/85 ring-1 ring-inset ring-border transition-colors group-active:bg-overlay/6 group-focus-visible:ring-2 group-focus-visible:ring-primary-readable motion-reduce:transition-none">
            <RefreshCw size={14} aria-hidden="true" />{zh ? "重试" : "Retry"}
          </span>
        </button>
      )}
      {on && (
        <button type="button" onClick={onOpenSettings} aria-label={zh ? "弹幕设置" : "Danmaku settings"}
          className="grid size-11 shrink-0 place-items-center rounded-full text-foreground/80 outline-none active:bg-overlay/6 focus-visible:ring-2 focus-visible:ring-primary-readable">
          <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            {DANMAKU_SETTINGS_PARTS.lines.map((d) => <path key={d} d={d} />)}
            <g transform={DANMAKU_SETTINGS_PARTS.gearTransform} strokeWidth={3.2}><path d={DANMAKU_SETTINGS_PARTS.gear} /><circle cx="12" cy="12" r="3" /></g>
          </svg>
        </button>
      )}
    </div>
  );
}

/** 弹幕 settings: shared by the player sheet and the playback panel. */
export function DanmakuSettings({ view, zh }: { view: DanmakuView; zh: boolean }) {
  const { prefs } = view;
  const set = (change: Partial<DanmakuPrefs>) => updateDanmakuPrefs(change);
  const switchId = useId();
  return (
    <div className="space-y-6">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <label htmlFor={switchId} className="text-sm font-bold">{zh ? "显示弹幕" : "Show danmaku"}</label>
        <Switch id={switchId} checked={prefs.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      </div>

      <MatchInfo view={view} zh={zh} />

      <section aria-label={zh ? "外观" : "Appearance"} className={cn("space-y-6", !prefs.enabled && "opacity-50")}>
        <div>
          <div className="mb-2.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{zh ? "不透明度" : "Opacity"}</span>
            <span className="tabular-nums">{Math.round(prefs.opacity * 100)}%</span>
          </div>
          <Slider min={20} max={100} step={5} value={[Math.round(prefs.opacity * 100)]} thumbLabels={[zh ? "不透明度" : "Opacity"]}
            formatValue={(value) => `${value}%`} onValueChange={([value]) => set({ opacity: value / 100 })} />
        </div>
        <Choice label={zh ? "字号" : "Text size"} value={prefs.fontSize} onChange={(fontSize) => set({ fontSize })}
          items={[["small", zh ? "小" : "Small"], ["medium", zh ? "中" : "Medium"], ["large", zh ? "大" : "Large"]]} />
        <Choice label={zh ? "速度" : "Speed"} value={prefs.speed} onChange={(speed) => set({ speed })}
          items={[["slow", zh ? "慢" : "Slow"], ["normal", zh ? "标准" : "Normal"], ["fast", zh ? "快" : "Fast"]]} />
        <Choice label={zh ? "显示区域" : "Area"} value={String(prefs.area)} onChange={(area) => set({ area: Number(area) as DanmakuPrefs["area"] })}
          items={[["0.25", "1/4"], ["0.5", zh ? "半屏" : "Half"], ["0.75", "3/4"], ["1", zh ? "全屏" : "Full"]]} />
        <section>
          <h3 className="mb-2.5 text-xs font-medium text-muted-foreground">{zh ? "屏蔽" : "Hide"}</h3>
          <div className="grid grid-cols-4 gap-2">
            {([["hideScroll", zh ? "滚动" : "Scrolling"], ["hideTop", zh ? "顶部" : "Top"], ["hideBottom", zh ? "底部" : "Bottom"], ["hideColor", zh ? "彩色" : "Coloured"]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={prefs[key]} onClick={() => set({ [key]: !prefs[key] } as Partial<DanmakuPrefs>)}
                className={cn("min-h-12 rounded-xl text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
                  prefs[key] ? "bg-primary text-primary-foreground" : "bg-overlay/8 text-foreground/85 active:bg-overlay/15")}>
                {label}
              </button>
            ))}
          </div>
        </section>
        <Offset view={view} zh={zh} />
      </section>

      <p className="text-xs leading-5 text-muted-foreground">{zh ? "弹幕来自 弹弹play开放弹幕网络" : "Danmaku from the 弹弹play open danmaku network"}</p>
    </div>
  );
}

function Choice<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: (readonly [T, string])[]; onChange: (value: T) => void }) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-medium text-muted-foreground">{label}</h3>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-2">
        {items.map(([item, text]) => (
          <button key={item} type="button" role="radio" aria-checked={item === value} onClick={() => onChange(item)}
            className={cn("min-h-12 rounded-xl text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
              item === value ? "bg-primary text-primary-foreground" : "bg-overlay/8 text-foreground/85 active:bg-overlay/15")}>
            {text}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Shifts every comment when this site's cut differs from 弹弹play's timing. */
function Offset({ view, zh }: { view: DanmakuView; zh: boolean }) {
  const step = (delta: number) => view.setOffset(view.offset + delta);
  const label = view.offset === 0 ? (zh ? "同步" : "In sync") : `${view.offset > 0 ? "+" : ""}${view.offset.toFixed(1)}s`;
  const button = "grid size-12 place-items-center rounded-xl bg-overlay/8 outline-none active:bg-overlay/15 focus-visible:ring-2 focus-visible:ring-primary-readable";
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-medium text-muted-foreground">{zh ? "时间偏移（本作品）" : "Timing offset (this title)"}</h3>
      <div className="flex items-center gap-2">
        <button type="button" className={button} onClick={() => step(-0.5)} aria-label={zh ? "弹幕提前 0.5 秒" : "Show 0.5 s earlier"}><Minus size={16} /></button>
        <button type="button" onClick={() => view.setOffset(0)} className="min-h-12 flex-1 rounded-xl text-sm font-bold tabular-nums outline-none active:bg-overlay/10 focus-visible:ring-2 focus-visible:ring-primary-readable"
          aria-label={zh ? `偏移 ${label}，点按归零` : `Offset ${label}; reset`}>{label}</button>
        <button type="button" className={button} onClick={() => step(0.5)} aria-label={zh ? "弹幕延后 0.5 秒" : "Show 0.5 s later"}><Plus size={16} /></button>
      </div>
    </section>
  );
}

/** Which 弹弹play episode plays along, and choosing another one. */
function MatchInfo({ view, zh }: { view: DanmakuView; zh: boolean }) {
  const [searching, setSearching] = useState(false);
  const status = view.status;
  const text = status === "unavailable" ? (zh ? "这个版本未接入弹幕" : "This build has no danmaku")
    : status === "off" ? (zh ? "弹幕已关闭" : "Danmaku is off")
      : status === "matching" ? (zh ? "正在匹配弹幕…" : "Finding danmaku…")
        : status === "loading" ? (zh ? "正在加载弹幕…" : "Loading danmaku…")
          : status === "none" ? (zh ? "没有找到这一集的弹幕" : "No danmaku found for this episode")
            : status === "error" ? (zh ? "弹幕加载失败" : "Danmaku failed to load")
              : null;
  return (
    <section className="space-y-3 rounded-2xl bg-overlay/5 p-3">
      {view.match && (status === "ready" || status === "loading") ? (
        <div className="min-w-0 text-sm">
          <p className="truncate font-bold">{view.match.animeTitle}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {view.match.episodeTitle}{status === "ready" && ` · ${formatCount(view.comments?.length ?? 0, zh)} ${zh ? "条" : "comments"}`}
          </p>
        </div>
      ) : text && (
        <p role={status === "error" ? "alert" : "status"} className={cn("flex items-center gap-2 text-sm", status === "error" && "text-destructive-readable")}>
          {(status === "matching" || status === "loading") && <Loader2 size={14} className="animate-spin" />}{text}
        </p>
      )}
      {status === "error" && view.error && <p className="break-words text-xs text-muted-foreground">{view.error}</p>}
      {status !== "unavailable" && status !== "off" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSearching((value) => !value)}
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-overlay/8 px-3.5 text-sm font-bold outline-none active:bg-overlay/15 focus-visible:ring-2 focus-visible:ring-primary-readable">
            <Search size={14} />{zh ? "重新匹配" : "Choose another"}
          </button>
          {status === "error" && (
            <button type="button" onClick={view.retry}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-overlay/8 px-3.5 text-sm font-bold outline-none active:bg-overlay/15 focus-visible:ring-2 focus-visible:ring-primary-readable">
              <RefreshCw size={14} />{zh ? "重试" : "Retry"}
            </button>
          )}
        </div>
      )}
      {searching && <ManualMatch view={view} zh={zh} onChosen={() => setSearching(false)} />}
    </section>
  );
}

function ManualMatch({ view, zh, onChosen }: { view: DanmakuView; zh: boolean; onChosen: () => void }) {
  const [keyword, setKeyword] = useState(view.titles[0] ?? "");
  const [results, setResults] = useState<DanmakuAnime[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (!keyword.trim()) return;
    setPending(true);
    setError(null);
    view.search(keyword).then(setResults, (reason) => setError(String(reason))).finally(() => setPending(false));
  };
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); run(); }}>
        <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={zh ? "在弹弹play中搜索作品" : "Search 弹弹play"}
          aria-label={zh ? "在弹弹play中搜索作品" : "Search 弹弹play"} className="h-11 min-w-0 flex-1" />
        <button type="submit" disabled={pending} className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground outline-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary-readable"
          aria-label={zh ? "搜索" : "Search"}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive-readable">{error}</p>}
      {results?.length === 0 && <p className="text-xs text-muted-foreground">{zh ? "没有找到作品" : "Nothing found"}</p>}
      {results && results.length > 0 && (
        <ul className="max-h-60 space-y-1 overflow-y-auto overscroll-contain">
          {results.map((anime) => (
            <li key={anime.animeId}>
              <button type="button" onClick={() => { view.chooseAnime(anime); onChosen(); }}
                aria-current={view.match?.animeId === anime.animeId ? "true" : undefined}
                className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-sm outline-none active:bg-overlay/10 focus-visible:ring-2 focus-visible:ring-primary-readable aria-[current=true]:bg-primary/12">
                <span className="min-w-0 flex-1 truncate font-medium">{anime.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{[anime.typeDescription, zh ? `${anime.episodeCount} 集` : `${anime.episodeCount} ep`].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
