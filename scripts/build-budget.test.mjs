import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadConfigFromFile } from "vite";

const { config } = await loadConfigFromFile({ command: "build", mode: "production" });
const plugin = config.plugins.find(item => item.name === "kuriume-bundle-budget");
const hlsModule = "/repo/node_modules/hls.js/dist/hls.mjs";
const chunk = (name, size, modules, dynamic = false, imports = []) => ({
  type: "chunk", fileName: name, code: "x".repeat(size),
  modules: Object.fromEntries(modules.map(id => [id, {}])), isDynamicEntry: dynamic, imports,
});
const check = (...chunks) => plugin.generateBundle.call({ error: message => { throw new Error(message); } }, {},
  Object.fromEntries(chunks.map(item => [item.fileName, item])));

test("full lazy HLS has a bounded exception, not a globally relaxed application budget", () => {
  assert.equal(config.build.chunkSizeWarningLimit, 650);
  assert.doesNotThrow(() => check(
    chunk("app.js", 500_000, ["/repo/src/main.tsx"]),
    chunk("hls.js", 650_000, [hlsModule], true),
  ));
  assert.throws(() => check(chunk("app.js", 500_001, ["/repo/src/main.tsx"])), /500 kB budget/);
  assert.throws(() => check(chunk("hls.js", 650_001, [hlsModule], true)), /650 kB budget/);
  assert.doesNotThrow(() => check(chunk("hls.js", 600_000, ["C:\\repo\\node_modules\\hls.js\\dist\\hls.mjs"], true)));
});

test("HLS must remain isolated and dynamically loaded", async () => {
  assert.throws(() => check(chunk("hls.js", 590_000, [hlsModule])), /dynamically imported/);
  assert.throws(() => check(chunk("mixed.js", 600_000, [hlsModule, "/repo/src/player.tsx"], true)), /dynamically imported/);
  assert.throws(() => check(
    chunk("app.js", 100, ["/repo/src/main.tsx"], false, ["hls.js"]),
    chunk("hls.js", 590_000, [hlsModule], true),
  ), /dynamically imported/);
  const player = await readFile(new URL("../src/components/art-player-surface.tsx", import.meta.url), "utf8");
  assert.match(player, /await import\("hls\.js"\)/);
  assert(!player.includes("hls.light") && !player.includes("hls.js/light"));
  assert.match(player, /video\.canPlayType\("application\/vnd\.apple\.mpegurl"\)/);
});
