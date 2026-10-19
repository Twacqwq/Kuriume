import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { tapZone } from "../src/lib/player-gestures.ts";

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

test("tap zones split the player into thirds", () => {
  assert.equal(tapZone(10, 300), "left");
  assert.equal(tapZone(150, 300), "center");
  assert.equal(tapZone(290, 300), "right");
  assert.equal(tapZone(10, 0), "center");
});

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
  usePlayerGestures(art, "zh", options);
  const cleanup = effects.pop()();
  return { art, click, controlsShown: () => shown, done: () => { cleanup(); globalThis.document = documentBefore; } };
}

test("single tap toggles controls; double tap on a side skips and keeps the controls as they were", () => {
  const f = fixture();
  try {
    f.click(150);
    assert.equal(f.controlsShown(), true, "single tap reveals");
    f.click(150);
    // second tap within the double-tap window in the middle toggles playback
    assert.equal(f.art.toggles, 1);
    assert.equal(f.controlsShown(), false, "controls return to their state before the first tap");
    const before = f.art.currentTime;
    return new Promise((resolve) => setTimeout(() => {
      f.click(280);
      f.click(280);
      assert.equal(f.art.currentTime, before + 10);
      f.click(280);
      assert.equal(f.art.currentTime, before + 20, "further taps keep skipping");
      assert.equal(f.controlsShown(), false);
      setTimeout(() => {
        f.click(20);
        f.click(20);
        assert.equal(f.art.currentTime, before + 10);
        f.done();
        resolve();
      }, 800);
    }, 350));
  } catch (error) {
    f.done();
    throw error;
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
