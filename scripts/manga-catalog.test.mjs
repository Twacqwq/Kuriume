import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import ts from "typescript";

const data = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = async (file, replacements = {}) => {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } });
  for (const [specifier, url] of Object.entries(replacements)) outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(url));
  return data(outputText);
};
const invoke = data("export const invoke=(...args)=>globalThis.__mangaInvoke(...args);");
const typesUrl = await transpile("lib/types.ts");
const storeUrl = await transpile("lib/store.ts", { "@tauri-apps/api/core": invoke, "@/lib/types": typesUrl });
globalThis.__mangaClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const catalog = await import(await transpile("lib/catalog-queries.ts", {
  "@/lib/store": storeUrl,
  "@/lib/query-client": data("export const queryClient=globalThis.__mangaClient;"),
  "@tauri-apps/api/core": invoke,
}));
const relations = await import(await transpile("lib/media-relations.ts", { "@/lib/types": typesUrl }));
const store = await import(storeUrl);
test.after(() => { delete globalThis.__mangaClient; delete globalThis.__mangaInvoke; });

test("manga lists always come from Bangumi, popular or newest", async () => {
  const calls = [];
  globalThis.__mangaInvoke = async (command, args) => { calls.push([command, args]); return { data: [], total: 0, limit: 30, offset: 0 }; };
  await catalog.fetchMangaList(30, "new", "zh");
  await catalog.fetchMangaList(0, "popular", "en");
  assert.deepEqual(calls.map(([command]) => command), ["get_list", "get_list"]);
  assert.deepEqual(calls.map(([, args]) => args.provider), ["Bangumi", "Bangumi"]);
  assert.deepEqual(calls[0][1].query, { limit: 30, offset: 30, soft: "Date", kind: "manga" });
  assert.equal(calls[1][1].query.soft, "Rank");
  assert.notDeepEqual(catalog.mangaListKey("new", "zh"), catalog.mangaListKey("popular", "zh"));
});

test("the 数据源 setting chooses the anime catalog only", () => {
  assert.equal(store.catalogSourceForKind("manga", "anilist"), "bangumi");
  assert.equal(store.catalogSourceForKind("manga", "bangumi"), "bangumi");
  assert.equal(store.catalogSourceForKind("anime", "anilist"), "anilist");
});

test("followed manga are not re-linked when the anime catalog changes", async () => {
  const calls = [];
  globalThis.__mangaInvoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "get_settings") return { display_language: "zh", catalog_source: "anilist" };
    if (command === "library_list") return [
      { provider: "bangumi", external_id: "1", kind: "manga" },
      { provider: "bangumi", external_id: "2", kind: "anime" },
    ];
    if (command === "catalog_counterpart") return null;
    return null;
  };
  await catalog.linkFollowedToCatalog();
  assert.deepEqual(calls.filter(([command]) => command === "catalog_counterpart").map(([, args]) => args.id), ["bangumi:2"]);
});

test("relations come from the catalog that owns the ID", async () => {
  const calls = [];
  globalThis.__mangaInvoke = async (command, args) => { calls.push([command, args]); return []; };
  await globalThis.__mangaClient.fetchQuery(catalog.relationsQueryOptions("bangumi:400602"));
  assert.deepEqual(calls, [["get_relations", { provider: "Bangumi", id: "bangumi:400602" }]]);
});

test("a manga is saved with its kind, and old entries default to anime", async () => {
  const calls = [];
  globalThis.__mangaInvoke = async (command, args) => { calls.push([command, args]); return {}; };
  const base = { title: "Frieren", title_en: "Frieren", title_cn: "葬送的芙莉莲", cover: null, banner: null, total_episodes: 0 };
  await store.mediaApi.ensure({ ...base, id: "anilist:118586", kind: "manga" }, "zh");
  await store.mediaApi.ensure({ ...base, id: "anilist:154587" }, "zh");
  assert.equal(calls[0][1].input.kind, "manga");
  assert.equal(calls[0][1].input.external_id, "118586");
  assert.equal(calls[1][1].input.kind, "anime");
});

test("library statuses read as 追番 for anime, 追漫 for manga and neutrally for both", () => {
  assert.equal(store.libraryStatusLabel("following", "anime", "zh"), "追番中");
  assert.equal(store.libraryStatusLabel("following", "manga", "zh"), "追漫中");
  assert.equal(store.libraryStatusLabel("completed", "manga", "zh"), "已读完");
  assert.equal(store.libraryStatusLabel("following", "all", "zh"), "在追");
  assert.equal(store.libraryStatusLabel("following", "manga", "en"), "Reading");
});

test("related works put the other medium first and label it from its side", () => {
  const item = (relation, id, kind) => ({ relation, media: { id, kind } });
  const sorted = relations.sortRelations([
    item("SEQUEL", "anilist:2", "anime"),
    item("OTHER", "anilist:3", "manga"),
    item("SOURCE", "anilist:1", "manga"),
    item("PREQUEL", "anilist:4", "anime"),
  ], "anime");
  assert.deepEqual(sorted.map(({ media }) => media.id), ["anilist:1", "anilist:3", "anilist:4", "anilist:2"]);
  assert.equal(relations.relationLabel(item("SOURCE", "a", "manga"), "zh"), "原作");
  assert.equal(relations.relationLabel(item("ADAPTATION", "a", "anime"), "zh"), "动画化");
  assert.equal(relations.relationLabel(item("ADAPTATION", "a", "manga"), "en"), "Manga");
  const many = Array.from({ length: 20 }, (_, index) => item("OTHER", `anilist:${index}`, "anime"));
  assert.equal(relations.sortRelations(many, "anime").length, 12);
});

test("manga length shows the volumes and chapters the catalog knows", () => {
  assert.equal(relations.mangaLength({ volumes: 14, chapters: 140 }, "zh"), "14 卷 · 140 话");
  assert.equal(relations.mangaLength({ volumes: 14, chapters: null }, "en"), "14 volumes");
  assert.equal(relations.mangaLength({}, "zh"), null);
});
