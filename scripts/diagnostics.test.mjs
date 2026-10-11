import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/diagnostics.ts", import.meta.url), "utf8");
const data = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const bridge = data("export const invoke = (...args) => globalThis.__diagnosticInvoke(...args)");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const diagnostics = await import(data(js.replace('"@tauri-apps/api/core"', JSON.stringify(bridge))));
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("diagnostics stay bounded on a stalled bridge, strip private data and clear after pending writes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let completeWrite;
  globalThis.__diagnosticInvoke = (command, args) => {
    calls.push({ command, args });
    return command === "diagnostics_write" ? new Promise((resolve) => { completeWrite = resolve; }) : Promise.resolve();
  };
  for (let i = 0; i < 10_000; i++) diagnostics.diagnose("player_error", "error", { code: "timeout", attempt: i });
  t.mock.timers.tick(250);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.entries.length, 8);
  assert.equal(calls[0].args.entries[0].details.attempt, 9_968);
  for (let i = 0; i < 10_000; i++) diagnostics.diagnose("player_error", "error", { attempt: i });
  t.mock.timers.tick(10_000);
  assert.equal(calls.length, 1, "only one IPC batch can be in flight");
  completeWrite();
  await settle();
  t.mock.timers.tick(250);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.entries[0].details.attempt, 9_968, "queue contains only newest 32");
  const cleared = diagnostics.clearDiagnostics();
  assert.equal(calls.at(-1).command, "diagnostics_write");
  completeWrite();
  await cleared;
  assert.equal(calls.at(-1).command, "diagnostics_clear");
  t.mock.timers.tick(10_000);
  assert.equal(calls.length, 3, "cleared records cannot reappear");

  const secret = "https://private.example/episode?token=SECRET_COOKIE";
  diagnostics.diagnose("ui_error", "error", { code: secret, provider: secret, engine: secret, message: secret, url: secret, stack: secret, status: secret, line: Infinity });
  diagnostics.diagnose("player_error", "warn", { code: "http", status: 403, elapsedMs: 12.5, count: -1 });
  diagnostics.diagnose(secret, "error", {});
  t.mock.timers.tick(250);
  const entries = calls.at(-1).args.entries;
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].details, {});
  assert.deepEqual(entries[1].details, { code: "http", status: 403, elapsedMs: 12 });
  assert(!JSON.stringify(calls).includes(secret));
  completeWrite();
  await settle();

  // Failed logging must not retry or recursively create more logs.
  globalThis.__diagnosticInvoke = async (command) => { calls.push({ command }); throw new Error(secret); };
  diagnostics.diagnose("ui_error", "error");
  t.mock.timers.tick(250);
  await settle();
  const count = calls.length;
  t.mock.timers.tick(10_000);
  assert.equal(calls.length, count);
  delete globalThis.__diagnosticInvoke;
});

test("runtime errors record categories only and reports include only the current page", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const windowBefore = globalThis.window;
  globalThis.window = new EventTarget();
  const writes = [];
  globalThis.__diagnosticInvoke = async (_, args) => { writes.push(...args.entries); };
  const dispose = diagnostics.installErrorDiagnostics();
  try {
    const error = new Event("error");
    Object.assign(error, { error: new TypeError("Cookie secret"), message: "Cookie secret", filename: "https://secret", lineno: 8, colno: 12 });
    window.dispatchEvent(error);
    const rejection = new Event("unhandledrejection");
    rejection.reason = "https://secret?token=SECRET";
    window.dispatchEvent(rejection);
    t.mock.timers.tick(250);
    await settle();
    assert.equal(writes[1].details.code, "type_error");
    assert.equal(writes[2].details.code, "unhandled_rejection");
    assert(!JSON.stringify(writes).includes("secret"));
    const report = diagnostics.diagnosticReport({ version: "1.0", platform: "android", entries: [{ ...writes[1], id: 2, at: 0, lastAt: 1, repeats: 3 }], total: 1000, evicted: 100 });
    assert.match(report, /1 entries on this page/);
    assert.match(report, /android/);
    assert.match(report, /type_error/);
    assert(!report.includes("app_started"));
  } finally {
    dispose();
    globalThis.window = windowBefore;
    delete globalThis.__diagnosticInvoke;
  }
});
