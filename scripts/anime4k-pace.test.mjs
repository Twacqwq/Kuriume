import assert from "node:assert/strict";
import test from "node:test";
import { PACE_WINDOW, PaceMeter, WARMUP_FRAMES } from "../src/lib/anime4k/pace.ts";

test("Anime4K is judged slow only when most frames are dropped after warm-up", () => {
  let slow = 0;
  const meter = new PaceMeter(() => slow++);
  for (let i = 0; i < WARMUP_FRAMES; i++) meter.record(false);
  assert.equal(slow, 0, "start-up frames do not count");
  // Every other frame dropped: still keeping up with half the frames.
  for (let i = 0; i < PACE_WINDOW; i++) meter.record(i % 2 === 0);
  assert.equal(slow, 0);
  for (let i = 0; i < PACE_WINDOW; i++) meter.record(i % 4 === 0);
  assert.equal(slow, 1);
  meter.reset();
  for (let i = 0; i < WARMUP_FRAMES + PACE_WINDOW - 1; i++) meter.record(false);
  assert.equal(slow, 1, "a reset restarts the warm-up and the window");
});
