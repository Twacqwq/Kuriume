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

test("each launch shows a listed wallpaper, never the same one twice in a row", async () => {
  const storage = new Map();
  let previous = null;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const { art, backdrop } = launch(storage);
    assert.match(art.src, /^\/splash\/\d+\.webp$/);
    assert.equal(backdrop.src, art.src);
    assert.notEqual(art.src, previous);
    previous = art.src;
    seen.add(art.src);
  }
  assert.ok(seen.size > 1);
  for (const path of seen) await stat(new URL(`../public${path}`, import.meta.url));
});

test("the wallpaper fades in only once it has loaded", () => {
  const { art, classes } = launch(new Map());
  assert.equal(classes.has("sp-ready"), false);
  art.onload();
  assert.equal(classes.has("sp-ready"), true);
});
