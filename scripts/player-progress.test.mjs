import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/components/art-player-progress.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { bindTouchProgress, CONTROL_ARMING_MS } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

function fixture() {
  const player = new EventTarget();
  player.dataset = {};
  player.classList = { remove(name) { player.removed = name; } };
  const progress = { getBoundingClientRect: () => ({ left: 0, width: 200 }) };
  const listeners = new Map();
  const bars = [];
  let shown = true;
  const art = {
    template: { $player: player, $progress: progress },
    duration: 1000, currentTime: 100, played: 0.1, seeks: 0,
    controls: {},
    on: (name, fn) => listeners.set(name, fn),
    off: (name) => listeners.delete(name),
    emit: (name, type, ratio) => { if (name === "setBar") bars.push(ratio); },
  };
  Object.defineProperty(art.controls, "show", { get: () => shown, set: (value) => { shown = value; listeners.get("control")?.(value); } });
  let time = 100;
  Object.defineProperty(art, "currentTime", { get: () => time, set: (value) => { time = value; art.seeks++; } });
  const touch = (name, x, target = { closest: (selector) => selector === ".art-progress" ? {} : null }) => {
    const event = new Event(name, { cancelable: true });
    event.touches = x === undefined ? [] : [{ clientX: x }];
    Object.defineProperty(event, "target", { value: target });
    player.dispatchEvent(event);
    return event;
  };
  return { art, player, listeners, bars, touch, setShown: (value) => { art.controls.show = value; } };
}

test("scrubbing previews while dragging and commits a single seek on release", () => {
  const f = fixture();
  const cleanup = bindTouchProgress(f.art);
  f.touch("touchstart", 20);
  f.touch("touchmove", 100);
  f.touch("touchmove", 150);
  assert.equal(f.art.seeks, 0, "dragging must not seek");
  assert.deepEqual(f.bars, [0.1, 0.5, 0.75]);
  assert.ok("scrubbing" in f.player.dataset);
  f.listeners.get("video:timeupdate")();
  assert.equal(f.bars.at(-1), 0.75, "timeupdate keeps the preview");
  f.touch("touchend");
  assert.equal(f.art.seeks, 1);
  assert.equal(f.art.currentTime, 750);
  assert.ok(!("scrubbing" in f.player.dataset));
  cleanup();
  assert.equal(f.listeners.size, 0);
});

test("a touch on hidden or just-revealed controls only reveals them", async () => {
  const f = fixture();
  f.setShown(false);
  const cleanup = bindTouchProgress(f.art);
  f.touch("touchstart", 150);
  f.touch("touchmove", 160);
  f.touch("touchend");
  assert.equal(f.art.seeks, 0);
  assert.equal(f.art.controls.show, true);
  assert.ok("arming" in f.player.dataset, "the revealing tap arms the bar");
  f.touch("touchstart", 150);
  f.touch("touchend");
  assert.equal(f.art.seeks, 0, "armed controls ignore the same tap's follow-up");
  await new Promise((resolve) => setTimeout(resolve, CONTROL_ARMING_MS + 20));
  assert.ok(!("arming" in f.player.dataset));
  f.touch("touchstart", 50);
  f.touch("touchend");
  assert.equal(f.art.currentTime, 250, "a deliberate tap on visible controls seeks");
  f.touch("touchstart", 50, { closest: () => null });
  f.touch("touchend");
  assert.equal(f.art.seeks, 1, "touches outside the progress bar are ignored");
  cleanup();
});

test("cancel restores the real position without seeking", () => {
  const f = fixture();
  const cleanup = bindTouchProgress(f.art);
  f.touch("touchstart", 20);
  f.touch("touchmove", 180);
  f.touch("touchcancel");
  assert.equal(f.art.seeks, 0);
  assert.equal(f.bars.at(-1), 0.1);
  cleanup();
});
