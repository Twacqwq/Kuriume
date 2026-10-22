import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const data = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const effects = [];
globalThis.__tapTest = {
  effect: (callback) => effects.push(callback),
  control: async () => ({ volume: 0.5, brightness: 0.5 }),
};
const imports = {
  react: data("export const useEffect = globalThis.__tapTest.effect; export const useState = () => [null, () => {}];"),
  "@/lib/mobile-player": data("export const mobileControl = globalThis.__tapTest.control;"),
  "@/lib/platform": data("export const isMobileApp = true;"),
  "@/lib/diagnostics": data("export const diagnose = () => {};"),
  "@/lib/player-gestures": new URL("../src/lib/player-gestures.ts", import.meta.url).href,
};
const source = await readFile(new URL("../src/hooks/use-player-gestures.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { usePlayerGestures } = await import(data(outputText.replace(/from "([^"]+)"/g, (_, name) => `from "${imports[name]}"`)));
delete globalThis.__tapTest;

function fixture(options) {
  const surface = new EventTarget();
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200 });
  const documentBefore = globalThis.document;
  globalThis.document = new EventTarget();
  let shown = false;
  const art = {
    template: { $player: surface }, currentTime: 100, duration: 600, toggles: 0,
    controls: { get show() { return shown; }, set show(value) { shown = value; }, toggle() { shown = !shown; } },
    toggle() { this.toggles++; }, on() {}, off() {}, pause() {},
  };
  const click = (x) => {
    const event = new Event("click", { cancelable: true });
    event.clientX = x;
    Object.defineProperty(event, "target", { value: { closest: () => null } });
    surface.dispatchEvent(event);
  };
  const touch = (type, x, y) => {
    const event = new Event(type, { cancelable: true });
    const points = type === "touchend" ? [] : [{ clientX: x, clientY: y }];
    Object.defineProperty(event, "touches", { value: points });
    Object.defineProperty(event, "target", { value: { closest: () => null } });
    surface.dispatchEvent(event);
  };
  usePlayerGestures(art, "zh", options);
  const cleanup = effects.pop()();
  return { art, click, touch, controlsShown: () => shown, done: () => { cleanup(); globalThis.document = documentBefore; } };
}

test("single tap toggles controls; a double tap anywhere plays/pauses and leaves the controls as they were", async () => {
  const f = fixture();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 350));
  try {
    f.click(150);
    assert.equal(f.controlsShown(), true, "single tap reveals");
    await pause();
    for (const x of [20, 150, 280]) {
      const toggles = f.art.toggles;
      f.click(x);
      f.click(x);
      assert.equal(f.art.toggles, toggles + 1, `double tap at ${x} plays/pauses`);
      assert.equal(f.art.currentTime, 100, "no side skipping");
      assert.equal(f.controlsShown(), true, "controls back to their state before the first tap");
      await pause();
    }
  } finally {
    f.done();
  }
});

test("a locked screen only reports the tap", () => {
  let flashed = 0;
  const f = fixture({ current: { locked: true, onLockedTap: () => flashed++ } });
  try {
    f.click(280);
    f.click(280);
    assert.equal(flashed, 2);
    assert.equal(f.art.currentTime, 100);
    assert.equal(f.controlsShown(), false);
  } finally {
    f.done();
  }
});

test("the WebView's click after a touch tap is ignored however late it comes", async () => {
  const f = fixture();
  try {
    f.touch("touchstart", 150, 100);
    f.touch("touchend");
    assert.equal(f.controlsShown(), true, "the touch tap reveals");
    await new Promise((resolve) => setTimeout(resolve, 900));
    f.click(150);
    assert.equal(f.controlsShown(), true, "a late synthetic click must not hide them again");
    await new Promise((resolve) => setTimeout(resolve, 350));
    f.click(150);
    assert.equal(f.controlsShown(), false, "a click without a touch still toggles");
  } finally {
    f.done();
  }
});
