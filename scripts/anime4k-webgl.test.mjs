import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateSize, fragmentSource, parseHookShader } from "../src/lib/anime4k/glsl/mpv-hook.ts";
import { choosePath, nextPath } from "../src/lib/anime4k/paths.ts";

const shader = (name) => readFile(new URL(`../src/lib/anime4k/glsl/${name}`, import.meta.url), "utf8");

test("Anime4K's mpv shaders parse into WebGL passes", async () => {
  const restore = parseHookShader(await shader("Anime4K_Restore_CNN_M.glsl"));
  assert.equal(restore.length, 8);
  assert.deepEqual(restore[0].binds, ["MAIN"]);
  assert.equal(restore.at(-1).save, "MAIN", "the restore result replaces MAIN");
  assert.equal(restore.at(-1).binds.length, 8);
  const upscale = parseHookShader(await shader("Anime4K_Upscale_CNN_x2_M.glsl"));
  assert.equal(upscale.length, 9);
  assert.equal(upscale.at(-1).width, "conv2d_last_tf.w 2 *");
  const source = fragmentSource(upscale.at(-1));
  assert.match(source, /^#version 300 es/);
  assert.match(source, /uniform sampler2D conv2d_last_tf_raw;/);
  assert.match(source, /#define MAIN_tex\(p\) texture\(MAIN_raw, p\)/);
  assert.match(source, /void main\(\) \{ fragColor = hook\(\); \}/);
});

test("pass sizes follow the shaders' RPN expressions", () => {
  const sizes = { MAIN: { width: 1280, height: 720 }, conv2d_last_tf: { width: 1280, height: 720 } };
  assert.equal(evaluateSize("MAIN.w", sizes), 1280);
  assert.equal(evaluateSize("conv2d_last_tf.h 2 *", sizes), 1440);
  assert.throws(() => evaluateSize("missing.w", sizes), /Unknown texture/);
  assert.throws(() => evaluateSize("MAIN.w *", sizes), /Malformed/);
});

test("devices without WebGPU use the WebGL2 path; failures are remembered", () => {
  assert.equal(choosePath(null, "webgpu"), "video");
  assert.equal(choosePath("bitmap", "webgpu"), "bitmap");
  assert.equal(choosePath(null, "webgl2"), "webgl2");
  assert.equal(choosePath("video", "webgl2"), "webgl2");
  assert.equal(choosePath(null, null), null);
});

test("a failed path steps down; missing WebGPU goes straight to WebGL2", () => {
  assert.equal(nextPath("video", "OperationError: A valid external Instance reference no longer exists.", true), "bitmap");
  assert.equal(nextPath("video", "WebGPU is not available", true), "webgl2");
  assert.equal(nextPath("video", "WebGPU is not available", false), null);
  assert.equal(nextPath("bitmap", "GPU device lost", true), "webgl2");
  assert.equal(nextPath("webgl2", "WebGL context lost", true), null);
});
