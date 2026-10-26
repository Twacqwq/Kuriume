import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Resuming a matched work: the cached episode list starts playback early, and
// the live list always has the last word. useOnlineSource runs here on a
// minimal hooks runtime (state, refs, memos, effects), with the provider
// bridge stubbed, so the real hook and selection helpers are under test.

const data = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const transpile = async (path, imports = {}) => {
  const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return data(js.replace(/from "([^"]+)"/g, (whole, id) => (imports[id] ? `from "${imports[id]}"` : whole)));
};

// A minimal React: one component, hooks by call order, effects after render.
const runtime = `
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
export function useState(initial) {
  const r = globalThis.__hooks;
  const i = r.index++;
  if (!(i in r.slots)) {
    r.slots[i] = { value: typeof initial === "function" ? initial() : initial };
    r.slots[i].set = (next) => { const slot = r.slots[i]; slot.value = typeof next === "function" ? next(slot.value) : next; r.schedule(); };
  }
  return [r.slots[i].value, r.slots[i].set];
}
export function useRef(initial) { const r = globalThis.__hooks; const i = r.index++; r.slots[i] ??= { current: initial }; return r.slots[i]; }
export function useMemo(make, deps) {
  const r = globalThis.__hooks;
  const i = r.index++; const slot = r.slots[i];
  if (slot && same(slot.deps, deps)) return slot.value;
  r.slots[i] = { value: make(), deps }; return r.slots[i].value;
}
export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
export function useEffect(fn, deps) {
  const r = globalThis.__hooks;
  const i = r.index++; const slot = r.slots[i];
  if (slot && deps && same(slot.deps, deps)) return;
  r.pending.push(() => { slot?.cleanup?.(); const cleanup = fn(); r.slots[i] = { deps, cleanup }; });
  r.slots[i] ??= { deps: undefined };
}
`;

function mount(hook, props) {
  const r = { slots: [], index: 0, pending: [], queued: false };
  globalThis.__hooks = r;
  const view = { current: null, props };
  r.render = () => {
    r.queued = false;
    for (let pass = 0; pass < 50; pass++) {
      r.index = 0;
      view.current = hook(...view.props());
      const effects = r.pending.splice(0);
      for (const effect of effects) effect();
      if (!r.queued) return;
      r.queued = false;
    }
    throw new Error("render loop");
  };
  r.schedule = () => { r.queued = true; queueMicrotask(() => { if (r.queued) r.render(); }); };
  r.render();
  return view;
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((done) => setTimeout(done, 0)); };

function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, String(value)); }, removeItem: (key) => items.delete(key) };
}

const road = (id, episodes) => ({ id, label: id, episodes: episodes.map(([number, episodeId]) => ({ id: episodeId, label: `${number}`, episodeNumber: number })) });
const binding = { source_id: "p1", remote_media_url: "work-1", remote_title: "Work", road_index: 0 };

// Modules load once (same source, same URL); each test gets a fresh bridge.
async function load() {
  globalThis.__bridge = { calls: [], episodes: () => Promise.reject(new Error("unset")) };
  const bridge = data(`
    const b = () => globalThis.__bridge;
    export const playbackSourceApi = {
      list: async () => [{ id: "p1", displayName: "P1", builtIn: true, capabilities: {} }],
      search: async () => { b().calls.push("search"); return []; },
      episodes: (provider, candidate) => { b().calls.push("episodes"); return b().episodes(provider, candidate); },
    };`);
  const selection = await transpile("lib/playback-selection.ts");
  const cache = await transpile("lib/playback-roads-cache.ts");
  const hook = await transpile("hooks/use-online-source.ts", {
    "@/lib/online-source": bridge,
    "@/lib/playback-selection": selection,
    "@/lib/playback-roads-cache": cache,
    react: data(runtime),
  });
  return { ...(await import(hook)), cache: await import(cache), bridge: globalThis.__bridge };
}

function context(overrides = {}) {
  return { catalogId: "bangumi:1", episodeNumber: 3, preferencesReady: true, preferredProviderId: "p1", bindings: [binding], ...overrides };
}
const request = (view) => view.current.getResolveRequest(3);

test("a cached episode list starts the remembered episode before the live list, which then confirms it", async () => {
  const { useOnlineSource, cache, bridge } = await load();
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage };
  const roads = [road("sub", [[1, "e1"], [2, "e2"], [3, "e3"]])];
  cache.writeCachedRoads(storage, "p1", "work-1", roads);
  let live;
  bridge.episodes = () => new Promise((done) => { live = done; });
  const view = mount(useOnlineSource, () => ["Work", [], context()]);
  await settle();
  assert.equal(view.current.ready, true);
  assert.equal(view.current.selectedAnime?.id, "work-1");
  assert.deepEqual(request(view), { candidateId: "work-1", roadId: "sub", episodeId: "e3" });
  assert.equal(view.current.refreshing, true);
  assert.equal(view.current.loadingEpisodes, false);
  const before = view.current.roads;
  live(JSON.parse(JSON.stringify(roads)));
  await settle();
  assert.equal(view.current.refreshing, false);
  assert.equal(view.current.cached, false);
  assert.equal(view.current.roads, before, "an unchanged live list leaves the roads (and the request) as they were");
});

test("a live list that changed the episode replaces the cached one on the same line", async () => {
  const { useOnlineSource, cache, bridge } = await load();
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage };
  cache.writeCachedRoads(storage, "p1", "work-1", [road("sub", [[3, "old-e3"]]), road("dub", [[3, "d3"]])]);
  bridge.episodes = async () => [road("dub", [[3, "d3"]]), road("sub", [[3, "new-e3"], [4, "e4"]])];
  const view = mount(useOnlineSource, () => ["Work", [], context()]);
  await settle();
  assert.deepEqual(request(view), { candidateId: "work-1", roadId: "sub", episodeId: "new-e3" });
  assert.equal(view.current.cached, false);
  assert.deepEqual(cache.readCachedRoads(storage, "p1", "work-1")?.[1].episodes.map((episode) => episode.id), ["new-e3", "e4"]);
});

test("without a usable cache (none, or missing this episode) the live list is awaited as before", async () => {
  for (const cached of [null, [road("sub", [[1, "e1"], [2, "e2"]])]]) {
    const { useOnlineSource, cache, bridge } = await load();
    const storage = memoryStorage();
    globalThis.window = { localStorage: storage };
    if (cached) cache.writeCachedRoads(storage, "p1", "work-1", cached);
    let live;
    bridge.episodes = () => new Promise((done) => { live = done; });
    const view = mount(useOnlineSource, () => ["Work", [], context()]);
    await settle();
    assert.equal(view.current.loadingEpisodes, true);
    assert.equal(request(view), null);
    live([road("sub", [[1, "e1"], [2, "e2"], [3, "e3"]])]);
    await settle();
    assert.deepEqual(request(view), { candidateId: "work-1", roadId: "sub", episodeId: "e3" });
    assert.equal(view.current.cached, false);
    assert.equal(cache.readCachedRoads(storage, "p1", "work-1")?.[0].episodes.length, 3, "the live list is cached for next time");
  }
});

test("a failed refresh keeps the cached list, and retry loads the live list like an uncached start", async () => {
  const { useOnlineSource, cache, bridge } = await load();
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage };
  cache.writeCachedRoads(storage, "p1", "work-1", [road("sub", [[3, "e3"]])]);
  bridge.episodes = async () => { throw new Error("offline"); };
  const view = mount(useOnlineSource, () => ["Work", [], context()]);
  await settle();
  assert.deepEqual(request(view), { candidateId: "work-1", roadId: "sub", episodeId: "e3" });
  assert.equal(view.current.refreshing, false);
  assert.equal(view.current.cached, true);
  assert.equal(view.current.error, null, "the cached list is what played last time; no error for a failed background check");
  bridge.episodes = async () => [road("sub", [[3, "e3-live"]])];
  view.current.retry();
  await settle();
  assert.deepEqual(request(view), { candidateId: "work-1", roadId: "sub", episodeId: "e3-live" });
  assert.equal(view.current.cached, false);
});

test("not ready until the saved choice is applied; a first match still searches", async () => {
  const { useOnlineSource, bridge } = await load();
  globalThis.window = { localStorage: memoryStorage() };
  let ready = false;
  bridge.episodes = async () => [road("sub", [[3, "e3"]])];
  const view = mount(useOnlineSource, () => ["Work", [], context({ preferencesReady: ready, bindings: [] })]);
  await settle();
  assert.equal(view.current.ready, false);
  ready = true;
  globalThis.__hooks.schedule();
  await settle();
  assert.equal(view.current.ready, true);
  assert.ok(bridge.calls.includes("search"), "a work never matched is searched as before");
});

test("the cache ignores malformed entries and keeps the most recent works", async () => {
  const { cache } = await load();
  const storage = memoryStorage();
  storage.setItem("kuriume:playback-roads:v1", "{not json");
  assert.equal(cache.readCachedRoads(storage, "p1", "x"), null);
  storage.setItem("kuriume:playback-roads:v1", JSON.stringify([{ key: JSON.stringify(["p1", "x"]), roads: [{ id: 1 }] }]));
  assert.equal(cache.readCachedRoads(storage, "p1", "x"), null);
  for (let index = 0; index < 30; index++) cache.writeCachedRoads(storage, "p1", `w${index}`, [road("sub", [[1, `e${index}`]])]);
  assert.equal(cache.readCachedRoads(storage, "p1", "w0"), null);
  assert.equal(cache.readCachedRoads(storage, "p1", "w29")?.[0].episodes[0].id, "e29");
  assert.equal(cache.sameRoads([road("a", [[1, "x"]])], [road("a", [[1, "x"]])]), true);
  assert.equal(cache.sameRoads([road("a", [[1, "x"]])], [road("a", [[1, "y"]])]), false);
});
