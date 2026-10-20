import assert from "node:assert/strict";
import test from "node:test";
import { coverTone } from "../src/lib/cover-tone.ts";

const channels = (tone) => tone.split(" ").map(Number);

test("cover tones keep the hue but stay within a quiet band", () => {
  assert.equal(coverTone(null), null);
  assert.equal(coverTone("blue"), null);
  const neon = channels(coverTone("#00ff00"));
  assert.ok(neon[1] > neon[0] && neon[1] > neon[2], "still green");
  assert.ok(Math.max(...neon) <= 170 && Math.max(...neon) - Math.min(...neon) <= 128, "toned down");
  assert.equal(coverTone("#808080"), null, "grey keeps the app tint");
  const near = channels(coverTone("#e4a15d"));
  assert.ok(near[0] > near[1] && near[1] > near[2], "orange stays orange");
});
