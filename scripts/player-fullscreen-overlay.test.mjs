import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const data = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const harness = { effects: [], states: [], native: null };
globalThis.__fullscreenOverlayTest = harness;
const imports = {
  react: data(`
    const harness = globalThis.__fullscreenOverlayTest;
    export const useEffect = (effect) => harness.effects.push(effect);
    export const useCallback = (callback) => callback;
    export const useRef = (current) => ({ current });
    export const useState = (initial) => [initial, (state) => harness.states.push(state)];
  `),
  "@tauri-apps/api/core": data("export const invoke = () => { throw Error('Unexpected simple fullscreen call off macOS'); };"),
  "@tauri-apps/api/window": data(`const harness = globalThis.__fullscreenOverlayTest; export const getCurrentWindow = () => harness.native;`),
  "@/lib/player-fullscreen": data(await compile("../src/lib/player-fullscreen.ts")),
  "@/lib/platform": data("export const isMobileApp = false;"),
  "@/lib/mobile-player": data("export const mobileControl = () => { throw Error('Unexpected mobile bridge call'); };"),
};
const source = (await compile("../src/hooks/use-player-fullscreen.ts"))
  .replace(/from "([^"]+)"/g, (_, name) => `from "${imports[name]}"`)
  .replaceAll("import.meta.env.TAURI_ENV_PLATFORM", '"linux"');
const { usePlayerFullscreen } = await import(data(source));
delete globalThis.__fullscreenOverlayTest;
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document, frame: globalThis.requestAnimationFrame };
  const target = new EventTarget();
  const listeners = [];
  const removed = [];
  const calls = [];
  let actual = false;
  let stopped = false;
  let overlay = null;
  let cleaned = false;
  globalThis.window = {
    addEventListener(name, handler, capture) {
      listeners.push({ name, handler, capture });
      target.addEventListener(name, handler, capture);
    },
    removeEventListener(name, handler, capture) {
      removed.push({ name, handler, capture });
      target.removeEventListener(name, handler, capture);
    },
  };
  globalThis.document = {
    querySelector: (selector) => overlay && selector.split(/,\s*/).includes(overlay) ? {} : null,
  };
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  harness.effects.length = 0;
  harness.states.length = 0;
  harness.native = {
    isFullscreen: async () => actual,
    setFullscreen: async (value) => { calls.push(value); actual = value; },
    onResized: async () => () => { stopped = true; },
  };
  const player = usePlayerFullscreen();
  const unmount = harness.effects.pop()();
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    unmount();
  };
  t.after(() => {
    cleanup();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.frame;
  });
  await flush();
  return {
    player, calls, listeners, removed, cleanup,
    stopped: () => stopped,
    state: () => harness.states.at(-1),
    setOverlay: (selector) => { overlay = selector; },
    async press(key = "Escape", prevented = false) {
      const event = new Event("keydown", { cancelable: true });
      event.key = key;
      if (prevented) event.preventDefault();
      target.dispatchEvent(event);
      await flush();
    },
  };
}

test("Escape exits app/system fullscreen, but ignores other keys and prevented events", async (t) => {
  const f = await fixture(t);
  assert.equal(f.listeners[0].capture, true, "fullscreen checks must precede player hotkeys");
  for (const mode of ["app", "system"]) {
    f.player.toggle(mode);
    await flush();
    assert.equal(f.state().mode, mode);
    await f.press("Enter");
    await f.press("Escape", true);
    assert.equal(f.state().mode, mode);
    await f.press();
    assert.equal(f.state().mode, "normal");
  }
  assert.deepEqual(f.calls, [true, false]);
});

test("dialogs, menus, listboxes and ArtPlayer settings retain fullscreen until dismissed", async (t) => {
  const f = await fixture(t);
  f.player.toggle("system");
  await flush();
  for (const selector of ['[role="dialog"]', '[role="menu"]', '[role="listbox"]', ".art-setting-show .art-settings"]) {
    f.setOverlay(selector);
    await f.press();
    assert.equal(f.state().mode, "system", `${selector} gets first refusal`);
    assert.deepEqual(f.calls, [true], `${selector} must not request a native fullscreen exit`);
  }
  f.setOverlay(null);
  await f.press();
  assert.equal(f.state().mode, "normal");
  assert.deepEqual(f.calls, [true, false]);
});

test("unmount removes the capture listener, disposes fullscreen and clears controller actions", async (t) => {
  const f = await fixture(t);
  f.player.toggle("system");
  await flush();
  f.cleanup();
  await flush();
  assert.deepEqual(f.removed, f.listeners);
  assert.equal(f.stopped(), true);
  assert.deepEqual(f.calls, [true, false], "owned fullscreen is released on unmount");
  const count = harness.states.length;
  f.player.toggle("system");
  f.player.close();
  await f.press();
  assert.deepEqual(f.calls, [true, false]);
  assert.equal(harness.states.length, count);
});
