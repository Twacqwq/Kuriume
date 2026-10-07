import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const script = await readFile(new URL("../src-tauri/src/media-sniffer.js", import.meta.url), "utf8");
function run({ child = false, video } = {}) {
  const messages = [];
  const handlers = {};
  const document = { title: "Episode", documentElement: {}, querySelectorAll: () => video ? [video] : [] };
  const window = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    fetch: () => Promise.resolve({ ok: true, url: "https://media.example/episode.m3u8" }),
  };
  window.top = child ? { postMessage: (message) => messages.push(message) } : window;
  class XHR { open() {} }
  const context = vm.createContext({ window, document, location: { href: "https://player.example/watch" }, URL,
    XMLHttpRequest: XHR, MutationObserver: class { observe() {} }, performance: { getEntriesByType: () => [] } });
  vm.runInContext(script, context);
  return { window, document, messages, handlers };
}

test("a child frame reports media to its original top frame, without navigation", async () => {
  const state = run({ child: true });
  await state.window.fetch();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].url, "https://media.example/episode.m3u8");
  assert.equal(state.document.title, "Episode");
});

test("top frame signals only HTTP(S) media candidates and deduplicates them", () => {
  const state = run();
  const send = (url) => state.handlers.message({ data: { type: "kuriume-media-candidate", url } });
  for (const url of ["javascript:alert(1)", "file:///media.mp4", "https://ads.example/landing", "https://media.example/seg.ts", "blob:https://player.example/a"]) send(url);
  assert.equal(state.document.title, "Episode");
  send("https://media.example/movie.m3u8");
  assert.equal(state.document.title, "__KURIUME_MEDIA__:https://media.example/movie.m3u8");
});

test("short pre-roll video is not mistaken for the episode", () => {
  const video = { duration: 15, currentSrc: "https://ads.example/promo.mp4", src: "https://ads.example/promo.mp4", addEventListener() {} };
  assert.equal(run({ video }).document.title, "Episode");
  const episode = { ...video, duration: 1440, currentSrc: "https://media.example/ep.mp4", __kuriumeWatched: false };
  assert.equal(run({ video: episode }).document.title, "__KURIUME_MEDIA__:https://media.example/ep.mp4");
});
