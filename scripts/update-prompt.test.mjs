import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/update-prompt.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const prompt = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const available = { status: "available", current: "0.2.0", latest: "0.3.0", notes: "", pageUrl: "", publishedAt: null, download: null };

test("a newer release is shown until the user skips that version", () => {
  assert.equal(prompt.shouldPromptUpdate(available, null), true);
  assert.equal(prompt.shouldPromptUpdate(available, "0.3.0"), false);
  assert.equal(prompt.shouldPromptUpdate({ ...available, latest: "0.4.0" }, "0.3.0"), true, "a newer release asks again");
  assert.equal(prompt.shouldPromptUpdate({ status: "latest", current: "0.2.0", latest: "0.2.0" }, null), false);
  assert.equal(prompt.shouldPromptUpdate(undefined, null), false);
});

test("reminder storage never throws", () => {
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(prompt.readKey(throwing, prompt.SKIPPED_VERSION_KEY), null);
  assert.doesNotThrow(() => prompt.writeKey(throwing, prompt.SKIPPED_VERSION_KEY, "0.3.0"));
  assert.equal(prompt.readKey(undefined, prompt.SKIPPED_VERSION_KEY), null);
});
