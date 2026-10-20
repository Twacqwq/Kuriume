import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { targetSize, upscalePasses } from "../src/lib/anime4k/sizing.ts";
import { cueText } from "../src/lib/anime4k/paths.ts";

test("Anime4K upscales only as far as the screen needs", () => {
  const p1080 = { width: 1920, height: 1080 };
  assert.equal(upscalePasses(p1080, { width: 1920, height: 1080 }), 0, "restore only at native size");
  assert.equal(upscalePasses({ width: 1280, height: 720 }, { width: 2560, height: 1440 }), 1);
  assert.equal(upscalePasses({ width: 854, height: 480 }, { width: 3840, height: 2160 }), 2);
  assert.equal(upscalePasses(p1080, { width: 0, height: 0 }), 0);
});

test("the canvas matches the displayed video box in device pixels, capped at 4K", () => {
  assert.deepEqual(targetSize({ width: 390, height: 219 }, { width: 1280, height: 720 }, 3), { width: 1168, height: 657 });
  assert.deepEqual(targetSize({ width: 1440, height: 900 }, { width: 1920, height: 1080 }, 2), { width: 2880, height: 1620 });
  assert.deepEqual(targetSize({ width: 3000, height: 2000 }, { width: 1920, height: 1080 }, 2), { width: 3840, height: 2160 });
});

test("subtitle cues drawn over Anime4K drop WebVTT markup", () => {
  assert.equal(cueText("<i>你好</i> &amp; <c.yellow>world</c>"), "你好 & world");
});

test("the Anime4K renderer stays out of the main bundle", async () => {
  const surface = await readFile(new URL("../src/components/art-player-anime4k.ts", import.meta.url), "utf8");
  assert.match(surface, /await import\("@\/lib\/anime4k\/renderer"\)/);
  assert.doesNotMatch(surface, /^import (?!type)[^\n]*anime4k\/renderer/m);
  const renderer = await readFile(new URL("../src/lib/anime4k/renderer.ts", import.meta.url), "utf8");
  assert.match(renderer, /import\("\.\/vendor\/pipelines\/restore\/CNNVL"\)/, "HQ weights load only for HQ");
  assert.doesNotMatch(renderer, /^import [^\n]*CNN(x2)?VL/m);
});

test("every Anime4K start draws on a fresh canvas (a stopped WebGL2 renderer loses its context)", async () => {
  const controller = await readFile(new URL("../src/components/art-player-anime4k.ts", import.meta.url), "utf8");
  const start = controller.slice(controller.indexOf("const start = () => {"));
  assert.match(start.slice(0, start.indexOf("Anime4KWebGLRenderer")), /replaceCanvas\(\);/);
});
