import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/display-language.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } });
const { displayAnimeTitle, displayAnimeDescription } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("Chinese titles fall back to original script before English, without changing English mode", () => {
  const media = { title: "Sousou no Frieren", title_en: "Frieren", title_cn: "葬送的芙莉莲", title_native: "葬送のフリーレン" };
  assert.equal(displayAnimeTitle(media, "zh"), media.title_cn);
  assert.equal(displayAnimeTitle({ ...media, title_cn: null }, "zh"), media.title_native);
  assert.equal(displayAnimeTitle({ ...media, title_cn: " ", title_native: null }, "zh"), media.title_en);
  assert.equal(displayAnimeTitle(media, "en"), media.title_en);
  assert.equal(displayAnimeTitle({ title: "Legacy", title_en: "Legacy English" }, "zh"), "Legacy English");
});

test("synopses use Chinese, actual Japanese, then the original description; empty data stays empty", () => {
  const media = { description_cn: "中文简介", description_ja: "日本語のあらすじ", description: "English synopsis" };
  assert.equal(displayAnimeDescription(media, "zh"), media.description_cn);
  assert.equal(displayAnimeDescription({ ...media, description_cn: null }, "zh"), media.description_ja);
  assert.equal(displayAnimeDescription({ ...media, description_cn: " ", description_ja: null }, "zh"), media.description);
  assert.equal(displayAnimeDescription(media, "en"), media.description);
  assert.equal(displayAnimeDescription({ description_cn: null, description: null }, "zh"), null);
});
