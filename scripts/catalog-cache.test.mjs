import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import ts from "typescript";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
globalThis.__catalogClient = client;
const data = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = async (file, replacements) => {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } });
  for (const [specifier, url] of Object.entries(replacements)) outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(url));
  return data(outputText);
};
const typesUrl = await transpile("lib/types.ts", {});
const storeUrl = await transpile("lib/store.ts", { "@tauri-apps/api/core": data("export const invoke=(...args)=>globalThis.__catalogInvoke(...args);"), "@/lib/types": typesUrl });
const { settingsQueryOptions } = await import(storeUrl);
const catalog = await import(await transpile("lib/catalog-queries.ts", {
  "@/lib/store": storeUrl,
  "@/lib/query-client": data("export const queryClient=globalThis.__catalogClient;"),
  "@tauri-apps/api/core": data("export const invoke=(...args)=>globalThis.__catalogInvoke(...args);"),
}));
const settings = { display_language: "zh", default_volume: .8, default_speed: 1, auto_next: true };
const page = { data: [{ id: "anilist:154587", title_cn: "葬送的芙莉莲" }], offset: 0, limit: 30, total: 1 };
const calendar = [{ weekday: { id: 1 }, items: page.data }];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test.afterEach(() => { client.clear(); delete globalThis.__catalogInvoke; });
test.after(() => { delete globalThis.__catalogClient; });

test("startup waits for the saved language, then starts both catalog requests without a waterfall", async () => {
  const calls = [], saved = deferred(), home = deferred(), schedule = deferred();
  globalThis.__catalogInvoke = (cmd, args) => {
    calls.push([cmd, args]);
    return cmd === "get_settings" ? saved.promise : cmd === "get_list" ? home.promise : schedule.promise;
  };
  const warm = catalog.prefetchBrowseData();
  const loader = catalog.ensureCatalogSettings();
  assert.deepEqual(calls.map(([cmd]) => cmd), ["get_settings"]);
  saved.resolve({ ...settings, display_language: "en" });
  await loader; await settle();
  assert.deepEqual(calls.map(([cmd]) => cmd), ["get_settings", "get_list", "get_calendar"]);
  assert(calls.slice(1).every(([, args]) => args.language === "en"));
  const observer = new QueryObserver(client, catalog.spotlightQuery("en"));
  const unmount = observer.subscribe(() => {});
  unmount(); // Leaving the tab must not cancel the unabortable IPC request.
  assert.equal(calls.length, 3);
  home.resolve(page); await settle();
  assert.deepEqual(client.getQueryData(catalog.spotlightQuery("en").queryKey), page);
  assert.equal(client.getQueryData(catalog.calendarQueryOptions("en").queryKey), undefined, "home renders without waiting for the calendar");
  schedule.resolve(calendar); await warm;
});

test("warm navigation is synchronous and reuses home, calendar and settings after one minute", async (t) => {
  const calls = [];
  globalThis.__catalogInvoke = async (cmd) => { calls.push(cmd); return cmd === "get_settings" ? settings : cmd === "get_list" ? page : calendar; };
  await catalog.prefetchBrowseData();
  const now = Date.now(); t.mock.method(Date, "now", () => now + 61_000);
  for (let i = 0; i < 3; i++) {
    assert.equal(catalog.ensureCatalogSettings(), undefined, "no promise/pending route for a warm tab");
    for (const options of [catalog.spotlightQuery("zh"), catalog.calendarQueryOptions("zh"), settingsQueryOptions]) {
      const observer = new QueryObserver(client, options);
      const unmount = observer.subscribe(() => {});
      assert.equal(observer.getCurrentResult().isPending, false);
      assert.equal(observer.getCurrentResult().isFetching, false);
      unmount();
    }
    // Home grid's page zero shares the hero request even when its own cache ages.
    assert.deepEqual(await client.fetchQuery(catalog.spotlightQuery("zh")), page);
  }
  assert.deepEqual(calls, ["get_settings", "get_list", "get_calendar"]);
  assert.equal(settingsQueryOptions.gcTime, Infinity);
  assert(catalog.BROWSE_CACHE.gcTime > catalog.BROWSE_CACHE.staleTime);
});

test("expired catalog data stays visible while refreshing, including a network failure", async () => {
  const options = catalog.calendarQueryOptions("zh");
  client.setQueryData(options.queryKey, calendar, { updatedAt: Date.now() - catalog.BROWSE_CACHE.staleTime - 1 });
  globalThis.__catalogInvoke = async () => { throw Error("Network unavailable"); };
  const observer = new QueryObserver(client, options);
  const unmount = observer.subscribe(() => {});
  try {
    assert.equal(observer.getCurrentResult().isPending, false);
    assert.equal(observer.getCurrentResult().isFetching, true);
    await settle();
    assert.equal(observer.getCurrentResult().isError, true);
    assert.deepEqual(observer.getCurrentResult().data, calendar);
  } finally { unmount(); }
});

test("language reload invalidates both catalogs and old in-flight replies cannot replace the new language", async () => {
  const old = deferred(), calls = [];
  client.setQueryData(settingsQueryOptions.queryKey, settings);
  globalThis.__catalogInvoke = (cmd, args) => {
    calls.push([cmd, args?.language]);
    if (args?.language === "zh") return old.promise;
    return Promise.resolve(cmd === "get_list" ? { ...page, data: [{ id: "english" }] } : []);
  };
  const warm = catalog.prefetchBrowseData(); await settle();
  await catalog.refreshCatalogLanguage("en");
  old.resolve(page); await warm; await settle();
  assert.deepEqual(calls, [["get_list", "zh"], ["get_calendar", "zh"], ["get_list", "en"], ["get_calendar", "en"]]);
  assert.equal(client.getQueryData(catalog.spotlightQuery("zh").queryKey), undefined);
  assert.equal(client.getQueryData(catalog.spotlightQuery("en").queryKey).data[0].id, "english");
  assert.deepEqual(client.getQueryData(catalog.calendarQueryOptions("en").queryKey), []);
});

test("the data source picks the catalog and keeps separate caches", async () => {
  const calls = [];
  globalThis.__catalogInvoke = async (cmd, args) => { calls.push([cmd, args]); return cmd === "get_settings" ? { ...settings, catalog_source: "bangumi" } : cmd === "get_list" ? page : calendar; };
  await catalog.prefetchBrowseData();
  assert.deepEqual(calls.filter(([cmd]) => cmd !== "get_settings").map(([cmd, args]) => [cmd, args.provider]), [["get_list", "Bangumi"], ["get_calendar", "Bangumi"]]);
  assert.notDeepEqual(catalog.spotlightQuery("zh", "bangumi").queryKey, catalog.spotlightQuery("zh", "anilist").queryKey);
  assert.notDeepEqual(catalog.calendarQueryOptions("zh", "bangumi").queryKey, catalog.calendarQueryOptions("zh").queryKey);
  assert.deepEqual(client.getQueryData(catalog.spotlightQuery("zh", "bangumi").queryKey), page);
});
