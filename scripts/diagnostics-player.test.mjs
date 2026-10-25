import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("player diagnostics do not flood progress or change playback callbacks, and clean up timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const effects = [], records = [], callbacks = [];
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = globalThis;
  globalThis.document = { createElement: () => ({}) };
  let art, refIndex = 0;
  class Player {
    static PLAYBACK_RATE = [1];
    constructor() {
      art = this;
      this.listeners = new Map();
      this.setting = { find: () => null };
      this.video = { paused: false, pause() { this.paused = true; }, addEventListener() {}, videoWidth: 1920, videoHeight: 1080, getVideoPlaybackQuality: () => ({ droppedVideoFrames: 2 }) };
      this.currentTime = 30; this.duration = 1500; this.isReady = false;
    }
    on(name, fn) { this.listeners.set(name, fn); }
    emit(name) { this.listeners.get(name)?.(); }
    destroy() { this.listeners.clear(); }
  }
  globalThis.__playerDiag = { Player, effects, records, ref: (value) => ({ current: refIndex++ === 0 ? {} : value }) };
  const data = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const imports = {
    react: data("export const useEffect=fn=>globalThis.__playerDiag.effects.push(fn);export const useRef=globalThis.__playerDiag.ref;export const useState=()=>[null,()=>{}];export const useSyncExternalStore=(_subscribe,snapshot)=>snapshot();"),
    "react/jsx-runtime": data("export const jsx=(...args)=>args;export const jsxs=jsx;"),
    artplayer: data("export default globalThis.__playerDiag.Player;"),
    "@/hooks/use-display-language": data('export const useDisplayLanguage=()=>"zh";'),
    "@/hooks/use-player-gestures": data("export const usePlayerGestures=()=>null;"),
    "@/lib/platform": data("export const isMobileApp=false;"),
    "@/lib/playback-selection": data("export const subtitleLanguage=()=>'';"),
    "@/components/art-player-icons": data("export const playerIcons={};"),
    "@/components/art-player-accessibility": data("export const bindPlayerAccessibility=()=>()=>{};"),
    "@/components/art-player-progress": data("export const bindTouchProgress=()=>()=>{};"),
    "@/components/player-chrome": data("export const PLAYBACK_RATES=[1];export const PlayerChrome=()=>null;"),
    "@/components/art-player-danmaku": data("export const bindDanmaku=()=>({setComments(){},setPrefs(){},setOffset(){},destroy(){}});"),
    "@/components/danmaku-settings": data("export const toggleDanmaku=()=>{};"),
    "@/components/art-player-anime4k": data("export const bindAnime4K=()=>({setEnabled(){},setMode(){},destroy(){}});export const readAnime4KPreference=()=>false;export const writeAnime4KPreference=()=>{};"),
    "@/lib/anime4k/mode": data("export const readAnime4KMode=()=>'quality';export const writeAnime4KMode=()=>{};export const subscribeAnime4KMode=()=>()=>{};"),
    "@/lib/anime4k/support": data("export const anime4kSupported=async()=>false;"),
    "@/lib/diagnostics": data("export const diagnose=(...args)=>globalThis.__playerDiag.records.push(args);export const diagnosticMessage=error=>String(error);"),
    "@/lib/theme": data("export const themePrimary=()=>\"#a4534a\";"),
    "@/lib/media-url": data("export const isProxiedMedia=()=>false;"),
  };
  const source = await readFile(new URL("../src/components/art-player-surface.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const { ArtPlayerSurface } = await import(data(js.replace(/import "[^"]+\.css";/g, "").replace(/from "([^"]+)"/g, (_, id) => `from "${imports[id]}"`)));
  let dispose;
  try {
    ArtPlayerSurface({ asset: { kind:"direct", url:"https://private.example/?token=secret", mimeType:"video/mp4", diagnosticId:42 }, fullscreen:{mode:"normal"}, defaultSpeed:1.5,
      onProgress: (...args) => callbacks.push(["progress", ...args]), onPlaying: () => callbacks.push(["playing"]), onError: (message) => callbacks.push(["error", message]), onEnded: () => callbacks.push(["ended"]) });
    dispose = effects[0]();
    art.isReady = true;
    art.emit("ready");
    assert.equal(art.playbackRate, 1.5);
    const before = records.length;
    for (let i=0;i<10_000;i++) art.emit("video:timeupdate");
    assert.equal(records.length, before, "progress ticks must never be logged");
    assert.equal(callbacks.length, 10_000);
    art.emit("video:playing"); art.emit("video:playing");
    assert.equal(records.filter(([event]) => event === "player_playing").length, 1);
    assert.equal(callbacks.filter(([event]) => event === "playing").length, 2);
    art.emit("video:waiting");
    now = 2500;
    t.mock.timers.tick(2500);
    art.emit("video:playing");
    assert.equal(records.filter(([event]) => event === "player_buffering").length, 2);
    art.emit("video:seeked");
    art.video.error = { code: 3, message: "Decoder returned an invalid sample" };
    art.emit("video:error");
    assert.equal(callbacks.at(-1)[1], "Decoder returned an invalid sample", "UI error behavior is unchanged");
    assert.equal(records.at(-1)[2].code, "decode");
    assert.equal(records.at(-1)[2].message, "Decoder returned an invalid sample");
    art.emit("video:play"); art.emit("video:pause");
    assert.deepEqual(records.slice(-2).map(([event]) => event), ["player_play", "player_pause"]);
    art.emit("video:ended");
    assert.equal(callbacks.at(-1)[0], "ended");
    assert(!JSON.stringify(records).includes("secret"));
    art.emit("video:waiting");
    dispose(); dispose = undefined;
    const finalCount = records.length;
    t.mock.timers.tick(65_000);
    assert.equal(records.length, finalCount);
    assert.equal(art.listeners.size, 0);
  } finally {
    dispose?.();
    globalThis.window = previousWindow; globalThis.document = previousDocument;
    delete globalThis.__playerDiag;
  }
});
