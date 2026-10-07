import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient, QueryObserver, isCancelledError } from "@tanstack/react-query";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/stored-title-query.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
  },
});
const { storedTitleQueryKey } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const id = "anilist:178789";
const language = "zh";
const detailKey = ["anime-detail", id, language];
const media = { id, title_cn: "无职转生 第三季" };
const makeClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("regression: even a disabled shared title observer cancels the route loader on unmount", async () => {
  const client = makeClient();
  const response = deferred();
  const observer = new QueryObserver(client, {
    queryKey: detailKey,
    enabled: false,
    placeholderData: media,
  });
  const unmount = observer.subscribe(() => {});
  let loaderSignal;
  const loader = client.fetchQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => {
      loaderSignal = signal;
      return response.promise;
    },
  });
  const rejected = assert.rejects(loader, isCancelledError);
  unmount();
  await rejected;
  assert.equal(loaderSignal.aborted, true);
  response.resolve(media);
  client.clear();
});

test("an isolated placeholder title can unmount while the route loader completes", async () => {
  const client = makeClient();
  const response = deferred();
  const observer = new QueryObserver(client, {
    queryKey: storedTitleQueryKey(id, language),
    enabled: false,
    placeholderData: media,
  });
  const unmount = observer.subscribe(() => {});
  let loaderSignal;
  const loader = client.fetchQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => {
      loaderSignal = signal;
      return response.promise;
    },
  });
  unmount();
  assert.equal(loaderSignal.aborted, false);
  response.resolve(media);
  assert.deepEqual(await loader, media);
  assert.deepEqual(client.getQueryData(detailKey), media);
  client.clear();
});

test("cancelling an in-flight title leaves the independent detail request and cache intact", async () => {
  const client = makeClient();
  const titleResponse = deferred();
  const detailResponse = deferred();
  let titleSignal;
  let loaderSignal;
  const observer = new QueryObserver(client, {
    queryKey: storedTitleQueryKey(id, language),
    queryFn: ({ signal }) => {
      titleSignal = signal;
      return titleResponse.promise;
    },
  });
  const unmount = observer.subscribe(() => {});
  const loader = client.fetchQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => {
      loaderSignal = signal;
      return detailResponse.promise;
    },
  });
  unmount();
  assert.equal(titleSignal.aborted, true);
  assert.equal(loaderSignal.aborted, false);
  detailResponse.resolve(media);
  assert.deepEqual(await loader, media);
  assert.deepEqual(client.getQueryData(detailKey), media);
  titleResponse.resolve({ ...media, title_cn: "stale title response" });
  await Promise.resolve();
  assert.deepEqual(client.getQueryData(detailKey), media);
  client.clear();
});
