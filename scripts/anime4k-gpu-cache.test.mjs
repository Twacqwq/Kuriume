import assert from "node:assert/strict";
import test from "node:test";
import { cachingDevice, GpuCache } from "../src/lib/anime4k/gpu-cache.ts";

// A device that counts what it compiles; objects are plain tokens.
function fakeDevice() {
  const counts = { modules: 0, bindLayouts: 0, pipelineLayouts: 0, pipelines: 0, asyncPipelines: 0, textures: 0 };
  return {
    counts,
    createShaderModule: () => ({ module: ++counts.modules }),
    createBindGroupLayout: () => ({ bindLayout: ++counts.bindLayouts }),
    createPipelineLayout: () => ({ pipelineLayout: ++counts.pipelineLayouts }),
    createComputePipeline: () => ({ pipeline: ++counts.pipelines }),
    createComputePipelineAsync: async () => ({ pipeline: ++counts.asyncPipelines, async: true }),
    createTexture: () => ({ texture: ++counts.textures, destroy() {} }),
    queue: { name: "queue" },
  };
}

// What one vendored Conv2d layer does in its constructor.
function layer(device, code) {
  device.createTexture({ size: [8, 8, 1] });
  const module = device.createShaderModule({ label: `layer ${code}`, code });
  const bindGroupLayout = device.createBindGroupLayout({ label: "new label each time", entries: [{ binding: 0, visibility: 4, texture: {} }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  return { bindGroupLayout, pipeline: device.createComputePipeline({ layout, compute: { module, entryPoint: "computeMain" } }) };
}

test("a rebuilt chain reuses compiled pipelines and their layouts; only textures are new", () => {
  const device = fakeDevice();
  const cache = new GpuCache();
  const first = [];
  const firstChain = ["a", "b"].map((code) => layer(cachingDevice(device, first, cache), code));
  const second = [];
  const secondChain = ["a", "b", "c"].map((code) => layer(cachingDevice(device, second, cache), code));
  assert.equal(device.counts.pipelines, 3, "only the new layer compiles");
  assert.equal(device.counts.modules, 3);
  assert.equal(device.counts.bindLayouts, 1, "same entries, one layout");
  assert.equal(secondChain[0].pipeline, firstChain[0].pipeline);
  assert.equal(secondChain[0].bindGroupLayout, firstChain[0].bindGroupLayout, "bind groups use the pipeline's own layout object");
  assert.equal(first.length, 2);
  assert.equal(second.length, 3, "each chain still owns (and frees) its textures");
  assert.equal(cachingDevice(device, [], cache).queue.name, "queue");
});

test("warming compiles asynchronously into the cache for the next real build", async () => {
  const device = fakeDevice();
  const cache = new GpuCache();
  const warming = [];
  layer(cachingDevice(device, [], cache, warming), "x2");
  assert.equal(device.counts.pipelines, 0, "nothing compiles on the main thread");
  await Promise.all(warming);
  assert.equal(device.counts.asyncPipelines, 1);
  const real = layer(cachingDevice(device, [], cache), "x2");
  assert.equal(real.pipeline.async, true, "the real chain gets the warmed pipeline");
  assert.equal(device.counts.pipelines, 0);
});
