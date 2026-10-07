import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const data = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const effects = [], calls = [];
globalThis.__touchTest = {
  effect: (callback) => effects.push(callback),
  control: async (...args) => { calls.push(args); return { volume: 0.5, brightness: 0.5 }; },
};
const imports = {
  react: data("export const useEffect = globalThis.__touchTest.effect; export const useState = () => [null, () => {}];"),
  "@/lib/mobile-player": data("export const mobileControl = globalThis.__touchTest.control;"),
  "@/lib/platform": data("export const isMobileApp = true;"),
  "@/lib/player-gestures": new URL("../src/lib/player-gestures.ts", import.meta.url).href,
};
const source = await readFile(new URL("../src/hooks/use-player-gestures.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { usePlayerGestures } = await import(data(outputText.replace(/from "([^"]+)"/g, (_, name) => `from "${imports[name]}"`)));
delete globalThis.__touchTest;

test("touch seeking commits once on release; cancel, controls, edges and multiple fingers do not seek", async () => {
  const surface = new EventTarget();
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 240 });
  surface.closest = () => null;
  const documentBefore = globalThis.document;
  globalThis.document = new EventTarget();
  globalThis.document.hidden = false;
  const listeners = new Map();
  const art = { template: { $player: surface }, currentTime: 300, duration: 1400, on: (name, fn) => listeners.set(name, fn), off: (name) => listeners.delete(name), pause() { this.paused = true; } };
  const touch = (name, points) => {
    const event = new Event(name, { cancelable: true });
    event.touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
    surface.dispatchEvent(event);
    return event;
  };
  usePlayerGestures(art, "en");
  const cleanup = effects.pop()();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    touch("touchstart", [[100, 100]]);
    assert.equal(touch("touchmove", [[106, 100]]).defaultPrevented, false);
    assert.equal(touch("touchmove", [[200, 100]]).defaultPrevented, true);
    assert.equal(art.currentTime, 300);
    touch("touchend", []);
    assert.equal(art.currentTime, 330);
    const click = new Event("click", { cancelable: true });
    surface.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);

    for (const scenario of ["cancel", "multi", "edge", "control"]) {
      surface.closest = () => scenario === "control" ? {} : null;
      touch("touchstart", [[scenario === "edge" ? 10 : 100, 100]]);
      touch("touchmove", [[200, 100]]);
      if (scenario === "multi") touch("touchmove", [[200, 100], [240, 100]]);
      if (scenario === "cancel") touch("touchcancel", []);
      touch("touchend", []);
      assert.equal(art.currentTime, 330, scenario);
    }
    surface.closest = () => null;
    touch("touchstart", [[300, 140]]);
    touch("touchmove", [[300, 80]]);
    touch("touchend", []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(calls.some(([action, value]) => action === "volume" && value > 0.5));
    touch("touchstart", [[100, 140]]);
    touch("touchmove", [[100, 80]]);
    touch("touchend", []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(calls.some(([action, value]) => action === "brightness" && value > 0.5));
    assert.equal(art.currentTime, 330, "vertical level gestures must not seek");
    globalThis.document.dispatchEvent(new Event("kuriume-background"));
    assert.equal(art.paused, true);
    assert.ok(calls.some(([action]) => action === "finish"));
  } finally {
    cleanup();
    globalThis.document = documentBefore;
  }
  assert.equal(listeners.size, 0);
});
