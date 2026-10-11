import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";

const readSource = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("settings exposes language and diagnostics without playback preferences", async () => {
  const settings = await readSource("routes/settings.tsx");
  assert.match(settings, /id="display-language"/);
  assert.match(settings, /to="\/settings\/logs"/);
  assert.doesNotMatch(settings, /default-volume|default-speed|auto-next|saveVolume|saveSpeed|saveAutoNext|"Playback"/);
  const player = await readSource("routes/anime/$id/episode/$ep.tsx");
  assert.match(player, /defaultVolume=\{settings\?\.default_volume\}/);
  assert.match(player, /defaultSpeed=\{settings\?\.default_speed\}/);
  assert.match(player, /settings\?\.auto_next !== false/);
});

test("route loaders have immediate, bounded pending feedback inside the app shell", async () => {
  const main = await readSource("main.tsx");
  assert.match(main, /defaultPendingComponent: PageLoading/);
  assert.match(main, /defaultPendingMs: 0/);
  assert.match(main, /defaultPendingMinMs: 150/);
  assert.match(main, /router\.preloadRoute\(\{ to: "\/calendar" \}\)/);
  assert.match(main, /router\.preloadRoute\(\{ to: "\/settings" \}\)/);
  assert.match(await readSource("routes/index.tsx"), /firstPage && <AnimeGrid/, "a failed first load must not start another grid request");
  for (const [file, component] of [["index", "Home"], ["calendar", "Calendar"]]) {
    const source = await readSource(`routes/${file}.tsx`);
    assert.match(source, new RegExp(`pendingComponent: ${component}PageLoading`));
    assert.match(source, new RegExp(`if \\(isPending\\) return <${component}PageLoading`));
  }
  const skeleton = await readSource("components/ui/skeleton.tsx");
  assert.match(skeleton, /aria-hidden="true"/);
  assert.match(skeleton, /motion-reduce:animate-none/);
  assert.match(await readSource("components/page-loading.tsx"), /role="status"/);
});

test("cached data remains visible while an expired query refreshes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ["calendar", "AniList", "zh"];
  const cached = [{ weekday: { id: 1 }, items: [] }];
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const options = { queryKey: key, queryFn: () => response, staleTime: 0 };
  client.setQueryData(key, cached, { updatedAt: 1 });
  assert.deepEqual(await client.ensureQueryData(options), cached);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  assert.equal(observer.getCurrentResult().isPending, false);
  assert.equal(observer.getCurrentResult().isFetching, true);
  assert.deepEqual(observer.getCurrentResult().data, cached);
  resolve(cached);
  unsubscribe();
  client.clear();
  assert.match(await readSource("routes/calendar.tsx"), /loader: ensureCatalogSettings/);
  assert.match(await readSource("routes/index.tsx"), /loader: ensureCatalogSettings/);
});

test("offline first loads are pending, not empty results", () => {
  onlineManager.setOnline(false);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const observer = new QueryObserver(client, { queryKey: ["offline-search"], queryFn: async () => [] });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(observer.getCurrentResult().fetchStatus, "paused");
    assert.equal(observer.getCurrentResult().isPending, true);
    assert.equal(observer.getCurrentResult().isLoading, false);
  } finally {
    unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
  }
});
