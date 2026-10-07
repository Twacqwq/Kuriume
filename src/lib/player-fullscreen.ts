import type { Window } from "@tauri-apps/api/window";

export type FullscreenMode = "normal" | "app" | "system";
export interface FullscreenState {
  mode: FullscreenMode;
  pending: boolean;
  error: string | null;
}
export interface NativeFullscreenTransition {
  fullscreen: boolean;
  pending: boolean;
}

/** One owner for player controls, Escape and native window events. */
export function createPlayerFullscreen(
  native: Pick<Window, "isFullscreen" | "setFullscreen" | "onResized">,
  changed: (state: FullscreenState) => void,
  onTransition?: (handler: (event: NativeFullscreenTransition) => void) => Promise<() => void>,
) {
  let state: FullscreenState = { mode: "normal", pending: false, error: null };
  let returnMode: "normal" | "app" = "normal";
  let owned = false;
  let disposed = false;
  let revision = 0;
  let unlisten: (() => void) | undefined;
  let target: FullscreenMode | null = null;
  let queuedExit: FullscreenMode | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let published: FullscreenState | undefined;
  const publish = () => {
    if (disposed || (published?.mode === state.mode && published.pending === state.pending && published.error === state.error)) return;
    published = { ...state };
    changed(published);
  };
  const settled = (fullscreen: boolean) => {
    clearTimeout(watchdog);
    state.mode = fullscreen ? "system" : target && target !== "system" ? target : returnMode;
    state.pending = false;
    target = null;
    if (!fullscreen) owned = false;
    publish();
    const next = queuedExit;
    queuedExit = null;
    if (next !== null) void setMode(next);
  };
  const watchTransition = (previous: FullscreenMode) => {
    clearTimeout(watchdog);
    // Failure recovery only: normal completion always comes from the OS.
    watchdog = setTimeout(async () => {
      const request = revision;
      const actual = await native.isFullscreen().catch(() => previous === "system");
      if (disposed || !state.pending || request !== revision) return;
      state.error = "系统全屏未完成，请重试。";
      settled(actual);
    }, 5000);
  };
  const transition = ({ fullscreen, pending }: NativeFullscreenTransition) => {
    if (disposed) return;
    revision++;
    if (fullscreen && state.mode !== "system") returnMode = state.mode;
    if (!pending) {
      settled(fullscreen);
      return;
    }
    // Both entry and exit keep the video immersive until the OS settles.
    watchTransition(state.mode);
    state.mode = "system";
    state.pending = true;
    publish();
  };

  const sync = async () => {
    if (disposed || state.pending) return;
    const request = ++revision;
    try {
      const actual = await native.isFullscreen();
      if (disposed || state.pending || request !== revision) return;
      if (actual && state.mode !== "system") {
        returnMode = state.mode;
        state.mode = "system";
      } else if (!actual && state.mode === "system") {
        state.mode = returnMode;
        owned = false;
      }
      publish();
    } catch {
      // An unavailable native bridge must not disable App fullscreen.
    }
  };
  const ready = (onTransition ? onTransition(transition) : native.onResized(() => { void sync(); })).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  });
  void ready.then(sync).catch(() => {});

  const setMode = async (mode: FullscreenMode) => {
    if (disposed || state.pending || mode === state.mode) return;
    revision++;
    state.error = null;
    if (mode !== "system" && state.mode !== "system") {
      state.mode = mode;
      publish();
      return;
    }
    state.pending = true;
    const previous = state.mode;
    target = mode;
    if (mode === "system") {
      returnMode = previous === "app" ? "app" : "normal";
      state.mode = "system";
    }
    publish();
    try {
      await ready;
      const actual = await native.isFullscreen();
      if (disposed) return;
      const entering = mode === "system";
      if (actual !== entering) {
        await native.setFullscreen(entering);
        if (entering) owned = true;
        if (disposed) return;
        if (onTransition) {
          // IPC acknowledgement is not completion of the macOS animation.
          if (state.pending) watchTransition(previous);
          return;
        }
      }
      settled(entering);
    } catch {
      clearTimeout(watchdog);
      target = null;
      queuedExit = null;
      state.mode = previous;
      state.pending = false;
      state.error = "无法切换系统全屏，请重试。";
    } finally {
      if (disposed && owned) {
        owned = false;
        void native.setFullscreen(false).catch(() => {});
      }
      publish();
    }
  };
  const exit = (mode: FullscreenMode) => {
    if (state.pending) {
      queuedExit = mode;
      return;
    }
    return setMode(mode);
  };

  return {
    toggle: (mode: "app" | "system") => setMode(
      state.mode === mode ? (mode === "system" ? returnMode : "normal") : mode,
    ),
    exit: () => exit(state.mode === "system" ? returnMode : "normal"),
    close: () => exit("normal"),
    dispose: () => {
      disposed = true;
      revision++;
      clearTimeout(watchdog);
      unlisten?.();
      // Do not exit a system fullscreen window that predated this player.
      if (owned) {
        owned = false;
        void native.setFullscreen(false).catch(() => {});
      }
    },
  };
}
