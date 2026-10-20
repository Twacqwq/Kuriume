import assert from "node:assert/strict";
import test from "node:test";
import { SPLASH_MAX_MS, SPLASH_MIN_MS, dismissSplash } from "../src/lib/splash.ts";

function fakeDocument() {
  const classes = new Set();
  const splash = { removed: false, classList: { add: (name) => classes.add(name) }, remove() { this.removed = true; } };
  return { splash, classes, doc: { getElementById: (id) => (id === "splash" && !splash.removed ? splash : null), defaultView: { matchMedia: () => ({ matches: false }) } } };
}

test("the splash waits for data, but never less than the bloom nor more than the cap", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 0;
  const now = () => clock;
  const advance = async (ms) => { clock += ms; t.mock.timers.tick(ms); for (let i = 0; i < 5; i++) await Promise.resolve(); };

  const fast = fakeDocument();
  const done = dismissSplash(Promise.resolve(), fast.doc, now);
  await advance(SPLASH_MIN_MS - 10);
  assert.equal(fast.classes.has("sp-out"), false, "bloom finishes first");
  await advance(20);
  assert.equal(fast.classes.has("sp-out"), true);
  await advance(500); await done;
  assert.equal(fast.splash.removed, true);

  clock = 0;
  const slow = fakeDocument();
  dismissSplash(new Promise(() => {}), slow.doc, now);
  await advance(SPLASH_MAX_MS + 10);
  await advance(1);
  assert.equal(slow.classes.has("sp-out"), true, "slow data does not hold the app");
});
