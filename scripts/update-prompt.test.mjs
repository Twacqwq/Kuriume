import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/update-prompt.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const appUpdate = new URL("../src/lib/app-update.ts", import.meta.url).href;
const prompt = await import(`data:text/javascript;base64,${Buffer.from(outputText.replace('"@/lib/app-update"', JSON.stringify(appUpdate))).toString("base64")}`);

const memory = (entries = {}) => {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
};
const available = { status: "available", current: "0.2.0", latest: "0.3.0", notes: "", pageUrl: "", publishedAt: null, download: null };

test("the previous version comes from the last launch, or an older build's update cache", () => {
  assert.equal(prompt.previousVersion(memory({ [prompt.LAST_VERSION_KEY]: "0.2.0" })), "0.2.0");
  const legacy = memory({ "kuriume:update-check": JSON.stringify({ checkedAt: 1, result: { status: "latest", current: "0.1.0" } }) });
  assert.equal(prompt.previousVersion(legacy), "0.1.0", "0.1.0 never wrote the key but cached its version");
  assert.equal(prompt.previousVersion(memory()), null, "a first install has no previous version");
  assert.equal(prompt.previousVersion(memory({ "kuriume:update-check": "not json" })), null);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(prompt.previousVersion(throwing), null);
  assert.doesNotThrow(() => prompt.writeKey(throwing, "k", "v"));
});

test("one prompt per launch: what's new after an upgrade, else an unskipped release", () => {
  const choose = (overrides) => prompt.choosePrompt({ version: "0.2.0", previous: "0.2.0", update: undefined, skipped: null, notesPending: false, ...overrides });
  assert.equal(choose({ previous: "0.1.0" }), "whats-new");
  assert.equal(choose({ previous: "0.1.0", notesPending: true }), null, "waits for the notes");
  assert.equal(choose({ previous: "0.1.0", update: available }), "whats-new", "what's new comes first");
  assert.equal(choose({ update: available }), "update");
  assert.equal(choose({ update: available, skipped: "0.3.0" }), null, "skipped until something newer");
  assert.equal(choose({ update: { ...available, latest: "0.4.0" }, skipped: "0.3.0" }), "update");
  assert.equal(choose({ previous: null }), null, "first install is quiet");
  assert.equal(choose({ previous: "0.3.0" }), null, "a downgrade is quiet");
  assert.equal(choose({ version: undefined, update: available }), null);
  assert.equal(choose({ update: { status: "latest", current: "0.2.0", latest: "0.2.0" } }), null);
});
