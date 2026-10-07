import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/player-fullscreen.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { createPlayerFullscreen } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(initial = false, nativeTransitions = false) {
  let actual = initial;
  let resize;
  let transition;
  const calls = [];
  const states = [];
  let stopped = false;
  const native = {
    isFullscreen: async () => actual,
    setFullscreen: async (value) => { calls.push(value); actual = value; },
    onResized: async (handler) => { resize = handler; return () => { stopped = true; }; },
  };
  const player = createPlayerFullscreen(native, (state) => states.push(state), nativeTransitions
    ? async (handler) => { transition = handler; return () => { stopped = true; }; }
    : undefined);
  await flush();
  return {
    player, native, calls, states,
    state: () => states.at(-1),
    stopped: () => stopped,
    resize: async (value) => { actual = value; resize(); await flush(); },
    transition: async (fullscreen, pending) => {
      actual = fullscreen;
      transition({ fullscreen, pending });
      await flush();
    },
  };
}

test("App fullscreen never resizes the OS window and exits to normal", async () => {
  const f = await fixture();
  await f.player.toggle("app");
  assert.equal(f.state().mode, "app");
  await f.player.exit();
  assert.equal(f.state().mode, "normal");
  assert.deepEqual(f.calls, []);
  f.player.dispose();
});

test("native animation, not IPC completion, unlocks controls and restores the sidebar", async () => {
  const f = await fixture(false, true);
  await f.player.toggle("system");
  assert.deepEqual(f.state(), { mode: "system", pending: true, error: null });
  await f.transition(true, true);
  await f.player.toggle("system");
  assert.deepEqual(f.calls, [true]);
  await f.transition(true, false);
  assert.equal(f.state().pending, false);
  await f.player.exit();
  assert.deepEqual(f.state(), { mode: "system", pending: true, error: null });
  await f.transition(false, true);
  assert.equal(f.state().mode, "system");
  await f.transition(false, false);
  assert.deepEqual(f.state(), { mode: "normal", pending: false, error: null });
  f.player.dispose();
});

test("Escape during entry queues one exit and keeps the previous App fullscreen mode", async () => {
  const f = await fixture(false, true);
  await f.player.toggle("app");
  await f.player.toggle("system");
  await f.player.exit();
  await f.player.exit();
  assert.deepEqual(f.calls, [true]);
  await f.transition(true, false);
  assert.deepEqual(f.calls, [true, false]);
  assert.equal(f.state().mode, "system");
  await f.transition(false, false);
  assert.equal(f.state().mode, "app");
  await f.player.exit();
  assert.equal(f.state().mode, "normal");
  f.player.dispose();
});

test("native green-button transitions preserve the return mode without taking ownership", async () => {
  const f = await fixture(false, true);
  await f.player.toggle("app");
  await f.transition(true, true);
  assert.equal(f.state().pending, true);
  await f.transition(true, false);
  await f.transition(false, true);
  assert.equal(f.state().mode, "system");
  await f.transition(false, false);
  assert.equal(f.state().mode, "app");
  f.player.dispose();
  assert.deepEqual(f.calls, []);
  assert.equal(f.stopped(), true);
});

test("unchanged resize events do not rerender the player", async () => {
  const f = await fixture();
  const count = f.states.length;
  await f.resize(false);
  await f.resize(false);
  assert.equal(f.states.length, count);
  f.player.dispose();
});

test("a missing native completion recovers controls with an error, not a successful transition", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(false, true);
  await f.player.toggle("system");
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(f.state().pending, false);
  assert.ok(f.state().error);
  f.player.dispose();
});

test("system fullscreen returns to its previous mode, including layered Escape", async () => {
  const f = await fixture();
  await f.player.toggle("app");
  await f.player.toggle("system");
  assert.equal(f.state().mode, "system");
  await f.player.exit();
  assert.equal(f.state().mode, "app");
  await f.player.exit();
  assert.equal(f.state().mode, "normal");
  await f.player.toggle("system");
  await f.player.toggle("system");
  assert.equal(f.state().mode, "normal");
  assert.deepEqual(f.calls, [true, false, true, false]);
  f.player.dispose();
});

test("native fullscreen enter/exit synchronizes controls without owning the window", async () => {
  const f = await fixture();
  await f.player.toggle("app");
  await f.resize(true);
  assert.equal(f.state().mode, "system");
  await f.resize(false);
  assert.equal(f.state().mode, "app");
  assert.deepEqual(f.calls, []);
  f.player.dispose();
  assert.equal(f.stopped(), true);
});

test("playback errors restore the full layout even when system fullscreen started in App fullscreen", async () => {
  const f = await fixture();
  await f.player.toggle("app");
  await f.player.toggle("system");
  await f.player.close();
  assert.equal(f.state().mode, "normal");
  assert.deepEqual(f.calls, [true, false]);
  f.player.dispose();
});

test("leaving playback exits owned fullscreen but preserves an already-fullscreen app", async () => {
  const f = await fixture();
  await f.player.toggle("system");
  f.player.dispose();
  assert.deepEqual(f.calls, [true, false]);
  const inherited = await fixture(true);
  assert.equal(inherited.state().mode, "system");
  inherited.player.dispose();
  assert.deepEqual(inherited.calls, []);
});

test("a failed native request retains the previous layout and reports the error", async () => {
  const f = await fixture();
  f.native.setFullscreen = async () => { throw Error("denied"); };
  await f.player.toggle("app");
  await f.player.toggle("system");
  assert.equal(f.state().mode, "app");
  assert.equal(f.state().pending, false);
  assert.ok(f.state().error);
  f.player.dispose();
});

test("rapid clicks cannot overlap native requests; a late enter is undone after unmount", async () => {
  const f = await fixture();
  let finish;
  f.native.setFullscreen = async (value) => {
    f.calls.push(value);
    if (value) await new Promise((resolve) => { finish = resolve; });
  };
  const entering = f.player.toggle("system");
  await flush();
  await f.player.toggle("system");
  assert.deepEqual(f.calls, [true]);
  f.player.dispose();
  const count = f.states.length;
  finish();
  await entering;
  assert.deepEqual(f.calls, [true, false]);
  assert.equal(f.states.length, count);
});

test("Escape restores the layout even if macOS exits before the JS handler runs", async () => {
  const f = await fixture();
  await f.player.toggle("app");
  await f.player.toggle("system");
  f.native.isFullscreen = async () => false;
  await f.player.exit();
  await flush();
  assert.equal(f.state().mode, "app");
  assert.deepEqual(f.calls, [true]);
  f.player.dispose();
});
