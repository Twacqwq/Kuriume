import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The danmaku clock against simulated video clocks: jittery (what Chromium
// reports per animation frame), coarse (a WebView updating a few times a
// second), seeking, stalling without an event, and playing at 2x.

const source = await readFile(new URL("../src/lib/danmaku-clock.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { DanmakuClock } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const FRAME_MS = 1000 / 60;
function random(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}
/** Draw times for `frames` animation frames; `media(i, t)` is what the video reports. */
function run(frames, media, { rate = 1, playing = () => true, events = {} } = {}) {
  const clock = new DanmakuClock();
  const drawn = [];
  for (let i = 0; i < frames; i++) {
    if (events[i]) clock.reset();
    drawn.push(clock.next(i * FRAME_MS, media(i, i / 60), rate, playing(i)));
  }
  return drawn;
}
const steps = (values, from = 1) => values.slice(from).map((value, i) => value - values[from + i - 1]);
const sd = (values) => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length); };

test("a jittery video clock becomes even steps that stay with the video", () => {
  const next = random(7);
  let last = 0;
  const reported = [];
  const drawn = run(1200, (i, t) => {
    // ±2.5 ms jitter, and about one frame in fifty where the time stands still.
    const value = next() < 0.02 ? last : t + (next() - 0.5) * 0.005;
    last = value;
    reported.push(value);
    return value;
  });
  const settled = 60;
  assert.ok(sd(steps(reported, settled)) > 0.0015, "the simulated video clock is uneven");
  assert.ok(sd(steps(drawn, settled)) < 0.0003, `drawn steps stay even (sd ${sd(steps(drawn, settled))})`);
  assert.ok(Math.min(...steps(drawn, settled)) > 0.012, "danmaku never stand still for a frame while playing");
  for (let i = settled; i < drawn.length; i++) assert.ok(Math.abs(drawn[i] - i / 60) < 0.02, `frame ${i} is ${drawn[i] - i / 60}s off`);
});

test("a video clock that updates four times a second still scrolls evenly, within one update", () => {
  const drawn = run(1200, (_i, t) => Math.floor(t * 4) / 4);
  const settled = 180;
  assert.ok(sd(steps(drawn, settled)) < 0.002, `even steps (sd ${sd(steps(drawn, settled))})`);
  for (let i = settled; i < drawn.length; i++) assert.ok(Math.abs(drawn[i] - (Math.floor((i / 60) * 4) / 4 + 0.125)) < 0.25);
});

test("seeking lands on the new time in the same frame, with or without the seek event", () => {
  for (const events of [{}, { 300: true, 600: true }]) {
    const media = (i, t) => (i < 300 ? t : i < 600 ? t + 30 : t - 10);
    const drawn = run(900, media, { events });
    assert.equal(drawn[300], media(300, 5));
    assert.equal(drawn[600], media(600, 10));
    assert.ok(Math.abs(drawn[899] - media(899, 899 / 60)) < 0.02);
  }
});

test("a stall the events missed stops the danmaku within a step, and resuming jumps back by no more", () => {
  const frozen = 200 / 60;
  // Stalled from frame 200 to 320, then playing on from where it stopped.
  const media = (i, t) => (i < 200 ? t : i < 320 ? frozen : frozen + (i - 320) / 60);
  const drawn = run(600, media);
  for (let i = 200; i < 320; i++) assert.ok(drawn[i] <= frozen + 0.061, `frame ${i} ran ahead to ${drawn[i] - frozen}s`);
  assert.ok(Math.min(...steps(drawn, 1)) > -0.061, "no backward jump beyond the lead");
  assert.ok(Math.abs(drawn[599] - media(599, 0)) < 0.02);
});

test("2x playback advances twice as fast, and a paused video is drawn at its exact time", () => {
  const drawn = run(600, (_i, t) => 2 * t, { rate: 2 });
  for (let i = 60; i < 600; i++) assert.ok(Math.abs(drawn[i] - 2 * (i / 60)) < 0.02);
  const paused = run(10, () => 12.345, { playing: () => false });
  assert.ok(paused.every((value) => value === 12.345));
});
