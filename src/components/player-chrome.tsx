import type Artplayer from "artplayer";
import { ArrowLeft, ChevronsLeft, ChevronsRight, CircleAlert, Gauge, Lock, LockOpen, MoveHorizontal, Play, RotateCcw, Sun, Volume2, Waypoints, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GestureFeedback } from "@/hooks/use-player-gestures";
import { gestureTime } from "@/lib/player-gestures";
import { isMobileApp } from "@/lib/platform";
import { cn } from "@/lib/utils";

export type PlayerSheet = "episodes" | "speed" | "options" | "shortcuts";

export interface PlayerEpisode {
  number: number;
  label: string;
  /** Watched share of the episode, 0–1. */
  progress?: number;
}

export interface PlayerNext {
  episode: number;
  label: string;
  onPlay: () => void;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const ASPECT_RATIOS = ["default", "16:9", "4:3"] as const;
const NEXT_COUNTDOWN_S = 5;
const RESUME_TOAST_MS = 5_000;
const SLOW_BUFFER_MS = 8_000;

export interface PlayerChromeProps {
  art: Artplayer | null;
  language: string;
  fullscreen: boolean;
  title?: string;
  mediaTitle?: string;
  onExitFullscreen: () => void;
  sheet: PlayerSheet | null;
  onSheet: (sheet: PlayerSheet | null) => void;
  locked: boolean;
  onLocked: (locked: boolean) => void;
  lockFlash: number;
  gesture: GestureFeedback | null;
  next?: PlayerNext | null;
  autoNext?: boolean;
  episodes?: PlayerEpisode[];
  currentEpisode?: number;
  onSelectEpisode?: (episode: number) => void;
  options?: ReactNode;
  onOpenOptions?: () => void;
  resumeFrom?: number;
  onRateChosen: (rate: number) => void;
}

/** Kuriume's own layer above ArtPlayer: top bar, sheets, prompts and touch feedback. */
export function PlayerChrome(props: PlayerChromeProps) {
  const { art, language, fullscreen, sheet, onSheet, locked, gesture } = props;
  const zh = language === "zh";
  const [controls, setControls] = useState(false);
  const [lockVisible, setLockVisible] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [resume, setResume] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [rate, setRate] = useState(1);
  const [aspect, setAspect] = useState<string>("default");
  const nextRef = useRef(props.next);
  nextRef.current = props.next;

  useEffect(() => {
    if (!art) return;
    setControls(art.controls.show);
    setRate(art.playbackRate || 1);
    const control = (shown: boolean) => setControls(shown);
    const rateChange = () => setRate(art.playbackRate || 1);
    const endedHandler = () => setEnded(true);
    const playing = () => { setEnded(false); setSlow(false); clearTimeout(slowTimer); };
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const waiting = () => {
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => { if (!art.video.paused) setSlow(true); }, SLOW_BUFFER_MS);
    };
    art.on("control", control);
    art.on("video:ratechange", rateChange);
    art.on("video:ended", endedHandler);
    art.on("video:playing", playing);
    art.on("video:seeking", playing);
    art.on("video:waiting", waiting);
    return () => {
      clearTimeout(slowTimer);
      art.off("control", control);
      art.off("video:ratechange", rateChange);
      art.off("video:ended", endedHandler);
      art.off("video:playing", playing);
      art.off("video:seeking", playing);
      art.off("video:waiting", waiting);
    };
  }, [art]);

  // Resume prompt: once per player, after the start position has been applied.
  const resumeRef = useRef(props.resumeFrom);
  useEffect(() => {
    const from = resumeRef.current;
    if (!art || !from || from <= 5) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = () => {
      setResume(from);
      timer = setTimeout(() => setResume(null), RESUME_TOAST_MS);
    };
    if (art.isReady) ready(); else art.once("ready", ready);
    return () => { clearTimeout(timer); art.off("ready", ready); setResume(null); };
  }, [art]);

  // Up-next card: a cancellable countdown when auto-play is on.
  useEffect(() => {
    if (!ended || !nextRef.current) { setCountdown(null); return; }
    if (!props.autoNext) { setCountdown(null); return; }
    setCountdown(NEXT_COUNTDOWN_S);
    const timer = setInterval(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => clearInterval(timer);
  }, [ended, props.autoNext]);
  useEffect(() => {
    if (countdown === 0) { setCountdown(null); nextRef.current?.onPlay(); }
  }, [countdown]);

  // Locked: a tap flashes the unlock button for a moment.
  useEffect(() => {
    if (!props.lockFlash) return;
    setLockVisible(true);
    const timer = setTimeout(() => setLockVisible(false), 2_500);
    return () => clearTimeout(timer);
  }, [props.lockFlash]);
  useEffect(() => { if (!fullscreen && locked) props.onLocked(false); }, [fullscreen, locked]);

  // Sheets close with Escape (and the Android back button, which sends Escape).
  useEffect(() => {
    if (!sheet) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onSheet(null);
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [sheet, onSheet]);

  const chooseRate = (value: number) => {
    if (!art) return;
    art.playbackRate = value;
    props.onRateChosen(value);
    setRate(value);
  };
  const chooseAspect = (value: string) => {
    if (!art) return;
    art.aspectRatio = value as Artplayer["aspectRatio"];
    setAspect(value);
  };
  const barsVisible = controls && !locked;
  const showTopBar = fullscreen && barsVisible;
  const canLock = fullscreen && isMobileApp;
  const openOptions = () => fullscreen && props.options ? onSheet("options") : props.onOpenOptions?.();
  // Phones in portrait get a bottom sheet; wide players a side panel.
  const landscapeSheet = fullscreen || !isMobileApp;

  return (
    <div data-player-chrome="" className="pointer-events-none absolute inset-0 z-[70] overflow-hidden text-white">
      {/* Top bar: fullscreen has no page header, so the title and back live here. */}
      <div className={cn("player-chrome-top absolute inset-x-0 top-0 flex items-center gap-2 bg-linear-to-b from-black/75 to-transparent px-2 pb-6 pt-1 transition-[opacity,visibility] duration-150 motion-reduce:transition-none", showTopBar ? "pointer-events-auto visible opacity-100" : "invisible opacity-0")}>
        <button type="button" tabIndex={showTopBar ? 0 : -1} onClick={props.onExitFullscreen} aria-label={zh ? "退出全屏" : "Exit fullscreen"}
          className="grid size-12 shrink-0 place-items-center rounded-full outline-none active:bg-white/15 focus-visible:ring-2 focus-visible:ring-primary-readable">
          <ArrowLeft size={20} />
        </button>
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold">
          {props.title}
          {props.mediaTitle && <span className="ml-2 text-xs font-medium text-white/65">{props.mediaTitle}</span>}
        </p>
        {props.options && (
          <button type="button" tabIndex={showTopBar ? 0 : -1} onClick={() => onSheet("options")}
            className="flex h-12 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold outline-none active:bg-white/15 focus-visible:ring-2 focus-visible:ring-primary-readable">
            <Waypoints size={17} />{zh ? "线路" : "Source"}
          </button>
        )}
      </div>

      {canLock && (barsVisible || locked) && (locked ? lockVisible : true) && (
        <button type="button" onClick={() => props.onLocked(!locked)} aria-pressed={locked}
          aria-label={locked ? (zh ? "解锁屏幕" : "Unlock screen") : (zh ? "锁定屏幕" : "Lock screen")}
          className="pointer-events-auto absolute left-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/45 outline-none active:bg-black/70 focus-visible:ring-2 focus-visible:ring-primary-readable">
          {locked ? <Lock size={19} className="text-primary-readable" /> : <LockOpen size={19} />}
        </button>
      )}

      <GestureLayer gesture={gesture} />

      {resume !== null && !ended && (
        <div role="status" className="player-chrome-toast pointer-events-auto absolute left-3 flex items-center gap-1 rounded-xl bg-black/75 py-1 pl-3 pr-1 text-sm">
          <span className="tabular-nums">{zh ? `已从 ${gestureTime(resume)} 继续播放` : `Resumed at ${gestureTime(resume)}`}</span>
          <button type="button" onClick={() => { if (art) art.currentTime = 0; setResume(null); }}
            className="flex h-10 items-center gap-1 rounded-lg px-2.5 font-bold text-primary-readable outline-none active:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary-readable">
            <RotateCcw size={14} />{zh ? "从头播放" : "Start over"}
          </button>
        </div>
      )}

      {slow && !ended && (props.options || props.onOpenOptions) && (
        <button type="button" onClick={() => { setSlow(false); openOptions(); }}
          className="pointer-events-auto absolute left-1/2 top-[calc(50%+3rem)] -translate-x-1/2 rounded-full bg-black/75 px-4 py-2.5 text-sm font-medium outline-none active:bg-black/90 focus-visible:ring-2 focus-visible:ring-primary-readable">
          {zh ? "加载较慢？换条线路" : "Slow? Try another source"}
        </button>
      )}

      {ended && props.next && (
        <div role="dialog" aria-label={zh ? "下一集" : "Up next"} className="player-chrome-next pointer-events-auto absolute right-3 w-[min(18rem,calc(100%-1.5rem))] rounded-2xl border border-white/10 bg-[#151516]/95 p-3 shadow-xl">
          <p className="text-xs text-white/60">{zh ? "下一集" : "Up next"}{countdown !== null && <span className="ml-1 tabular-nums">· {countdown}s</span>}</p>
          <p className="mt-0.5 truncate text-sm font-bold">{props.next.label}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => { setEnded(false); setCountdown(null); }}
              className="h-10 flex-1 rounded-xl bg-white/10 text-sm font-bold outline-none active:bg-white/20 focus-visible:ring-2 focus-visible:ring-primary-readable">{zh ? "取消" : "Cancel"}</button>
            <button type="button" onClick={() => props.next?.onPlay()}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-bold text-primary-foreground outline-none active:opacity-85 focus-visible:ring-2 focus-visible:ring-primary-readable">
              <Play size={14} fill="currentColor" />{zh ? "播放" : "Play"}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <Sheet title={sheetTitle(sheet, zh)} side={landscapeSheet ? "right" : "bottom"} viewport={!fullscreen && isMobileApp} onClose={() => onSheet(null)} closeLabel={zh ? "关闭" : "Close"}>
          {sheet === "speed" && (
            <div className="space-y-5">
              <ChoiceGrid label={zh ? "播放速度" : "Speed"} value={String(rate)} onChange={(value) => { chooseRate(Number(value)); onSheet(null); }}
                items={PLAYBACK_RATES.map((value) => ({ value: String(value), label: `${value}×` }))} />
              {isMobileApp && <ChoiceGrid label={zh ? "画面比例" : "Aspect ratio"} value={aspect} onChange={chooseAspect}
                items={ASPECT_RATIOS.map((value) => ({ value, label: value === "default" ? (zh ? "默认" : "Default") : value }))} />}
            </div>
          )}
          {sheet === "episodes" && (
            <EpisodeSheet episodes={props.episodes ?? []} current={props.currentEpisode}
              onSelect={(episode) => { onSheet(null); props.onSelectEpisode?.(episode); }} />
          )}
          {sheet === "options" && props.options}
          {sheet === "shortcuts" && <Shortcuts zh={zh} />}
        </Sheet>
      )}
    </div>
  );
}

function sheetTitle(sheet: PlayerSheet, zh: boolean) {
  return ({
    episodes: zh ? "选集" : "Episodes",
    speed: zh ? "倍速" : "Speed",
    options: zh ? "线路与播放源" : "Source & server",
    shortcuts: zh ? "快捷键" : "Keyboard shortcuts",
  })[sheet];
}

function Sheet({ title, side, viewport, onClose, closeLabel, children }: { title: string; side: "right" | "bottom"; viewport?: boolean; onClose: () => void; closeLabel: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  // The inline phone player is too short for a sheet: use the whole screen.
  return (
    <div className={cn("pointer-events-auto inset-0 text-foreground", viewport ? "fixed z-[60]" : "absolute z-10")}>
      <button type="button" aria-label={closeLabel} tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={cn("player-sheet absolute flex flex-col bg-[#151516]/96 outline-none backdrop-blur-sm",
          side === "right" ? "inset-y-0 right-0 w-[min(24rem,48%)] border-l border-white/8" : "inset-x-0 bottom-0 max-h-[78%] rounded-t-2xl border-t border-white/8")}>
        <div className="flex min-h-14 shrink-0 items-center justify-between pl-4 pr-1">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="grid size-12 place-items-center rounded-full text-muted-foreground outline-none active:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary-readable"><X size={18} /></button>
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

function ChoiceGrid({ label, items, value, onChange }: { label: string; items: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-medium text-muted-foreground">{label}</h3>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-2">
        {items.map((item) => (
          <button key={item.value} type="button" role="radio" aria-checked={item.value === value} onClick={() => onChange(item.value)}
            className={cn("min-h-12 rounded-xl text-sm font-bold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
              item.value === value ? "bg-primary text-primary-foreground" : "bg-white/8 text-foreground/85 active:bg-white/15")}>
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function EpisodeSheet({ episodes, current, onSelect }: { episodes: PlayerEpisode[]; current?: number; onSelect: (episode: number) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = grid.current?.querySelector<HTMLElement>('[aria-current="true"]');
    active?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div ref={grid} className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2 pb-2">
      {episodes.map((episode) => <EpisodeButton key={episode.number} episode={episode} current={episode.number === current} onSelect={onSelect} />)}
    </div>
  );
}

export function EpisodeButton({ episode, current, onSelect, className }: { episode: PlayerEpisode; current: boolean; onSelect: (episode: number) => void; className?: string }) {
  const watched = episode.progress !== undefined && episode.progress >= 0.92;
  return (
    <button type="button" onClick={() => onSelect(episode.number)} aria-current={current ? "true" : undefined}
      aria-label={episode.label} title={episode.label}
      className={cn("relative min-h-12 min-w-0 overflow-hidden rounded-xl px-1 text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
        current ? "bg-primary font-bold text-primary-foreground" : watched ? "bg-secondary/50 text-foreground/45 active:bg-accent" : "bg-secondary/80 text-foreground/85 hover:bg-accent active:bg-accent", className)}>
      {episode.number}
      {!current && episode.progress !== undefined && episode.progress > 0.02 && !watched && (
        <span aria-hidden="true" className="absolute inset-x-2 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/12">
          <span className="block h-full bg-primary-readable" style={{ width: `${Math.round(episode.progress * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

function Shortcuts({ zh }: { zh: boolean }) {
  const rows: [string, string][] = [
    ["Space", zh ? "播放 / 暂停" : "Play / pause"],
    ["← / →", zh ? "后退 / 前进 5 秒" : "Back / forward 5 s"],
    ["Shift + ← / →", zh ? "后退 / 前进 85 秒（跳过 OP）" : "Back / forward 85 s (skip OP)"],
    ["↑ / ↓", zh ? "音量" : "Volume"],
    ["F", zh ? "全屏" : "Fullscreen"],
    ["N", zh ? "下一集" : "Next episode"],
    ["A", zh ? "Anime4K 画质增强" : "Anime4K upscaling"],
    ["[ / ]", zh ? "减速 / 加速" : "Slower / faster"],
    ["?", zh ? "显示快捷键" : "Show shortcuts"],
  ];
  return (
    <dl className="divide-y divide-white/8 text-sm">
      {rows.map(([key, label]) => (
        <div key={key} className="flex items-center justify-between gap-4 py-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd><kbd className="rounded-md border border-white/12 bg-white/5 px-2 py-1 text-xs font-bold">{key}</kbd></dd>
        </div>
      ))}
    </dl>
  );
}

function GestureLayer({ gesture }: { gesture: GestureFeedback | null }) {
  if (!gesture) return null;
  if (gesture.kind === "skip") {
    return (
      <div role="status" aria-live="polite" className={cn("player-skip absolute inset-y-0 grid w-[38%] place-items-center", gesture.zone === "left" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]")}>
        <div className="flex flex-col items-center gap-1 text-sm font-bold tabular-nums">
          {gesture.zone === "left" ? <ChevronsLeft size={26} /> : <ChevronsRight size={26} />}
          {gesture.text}
        </div>
      </div>
    );
  }
  if (gesture.kind === "speed") {
    return (
      <div role="status" aria-live="polite" className="absolute inset-x-0 top-4 flex justify-center">
        <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-bold tabular-nums"><Gauge size={16} />{gesture.text}</div>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className="absolute inset-0 grid place-items-center">
      <div className="kuriume-gesture-feedback">
        {gesture.kind === "brightness" ? <Sun size={22} /> : gesture.kind === "volume" ? <Volume2 size={22} /> : gesture.kind === "seek" ? <MoveHorizontal size={22} /> : <CircleAlert size={22} />}
        {gesture.text}
      </div>
    </div>
  );
}

