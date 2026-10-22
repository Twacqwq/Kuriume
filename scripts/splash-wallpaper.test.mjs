import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/splash.js", import.meta.url), "utf8");

function launch(storage) {
  const classes = new Set();
  const art = { src: "", onload: null }, backdrop = { src: "" };
  const splash = { classList: { add: (name) => classes.add(name) }, querySelector: (selector) => (selector === ".sp-art" ? art : backdrop) };
  vm.runInNewContext(source, {
    document: { getElementById: () => splash },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Math, Number, String,
  });
  return { art, backdrop, classes };
}

const listed = JSON.parse(source.match(/WALLPAPERS = (\[[^\]]*\])/)[1]);

test("each launch shows a listed wallpaper, never the same one twice in a row", async () => {
  const storage = new Map();
  let previous = null;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const { art, backdrop } = launch(storage);
    assert.ok(listed.includes(art.src));
    assert.equal(backdrop.src, art.src);
    if (listed.length > 1) assert.notEqual(art.src, previous);
    previous = art.src;
    seen.add(art.src);
  }
  assert.equal(seen.size, listed.length, "every wallpaper comes up");
  for (const path of seen) await stat(new URL(`../public${path}`, import.meta.url));
});

test("the wallpaper fades in only once it has loaded", () => {
  const { art, classes } = launch(new Map());
  assert.equal(classes.has("sp-ready"), false);
  art.onload();
  assert.equal(classes.has("sp-ready"), true);
});
