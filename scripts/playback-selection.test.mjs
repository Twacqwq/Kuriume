import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The helpers have type-only imports, so they can run in Node without loading
// Tauri or introducing another test runner into the desktop application.
const source = await readFile(
  new URL("../src/lib/playback-selection.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
  },
});
const {
  playbackSearchRequest,
  restoredPlaybackCandidate,
  initialPlaybackRoad,
  nextPlaybackSource,
  catalogPlaybackTitles,
  preferredSubtitle,
  subtitleLanguage,
  subtitleKey,
  preferredProviderId,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("failed media advances through alternatives once, without an infinite retry loop", () => {
  const sources = ["Yt-mp4", "Mp4", "Ok"].map((name) => ({ name, asset: {} }));
  assert.equal(nextPlaybackSource(sources, []), 0);
  assert.equal(nextPlaybackSource(sources, ["Yt-mp4"]), 1);
  assert.equal(nextPlaybackSource(sources, ["Yt-mp4", "Mp4"]), 2);
  assert.equal(nextPlaybackSource(sources, ["Yt-mp4", "Mp4", "Ok"]), -1);
  assert.equal(nextPlaybackSource(sources, ["Ok"]), 0);
});

const binding = {
  media_id: "local-media",
  source_id: "builtin:hianime",
  remote_media_url: "hianime:manually-corrected-123",
  remote_title: "Corrected Part 2",
  road_index: 1,
  verified_at: "2026-09-05",
};

test("new playback and retired sources use registry order without overriding valid choices", () => {
  const providers = ["anime1", "xifan", "age", "hianime"].map((id) => ({ id: `builtin:${id}` }));
  for (const id of ["mx", "allanime"]) {
    const retired = { ...binding, source_id: `builtin:${id}`, remote_media_url: `${id}:old-title` };
    const selected = preferredProviderId(providers, retired.source_id);
    assert.equal(selected, "builtin:anime1");
    assert.equal(restoredPlaybackCandidate(selected, [], [retired]), undefined);
    assert.equal(preferredProviderId([], retired.source_id), null);
  }
  for (const provider of providers) {
    assert.equal(preferredProviderId(providers, provider.id), provider.id);
  }
  assert.equal(preferredProviderId(providers), "builtin:anime1");
  assert.equal(preferredProviderId(providers.slice(1)), "builtin:xifan");
  assert.equal(preferredProviderId(providers, "missing"), "builtin:anime1");
});

test("localized catalog titles remain searchable when search_titles is populated", () => {
  const aliases = catalogPlaybackTitles({ title: "Sousou no Frieren", title_en: "Frieren: Beyond Journey's End", title_cn: "葬送的芙莉莲", search_titles: ["Sousou no Frieren", "葬送のフリーレン", ...Array.from({length: 12}, (_, i) => `alias ${i}`)] });
  const request = playbackSearchRequest("Sousou no Frieren", aliases, {}, false);
  assert.ok(request.alternativeTitles.includes("葬送的芙莉莲"));
  assert.ok(request.alternativeTitles.includes("Frieren: Beyond Journey's End"));
  assert.equal(request.alternativeTitles.length, 8);
});

test("default subtitles prefer Chinese only, never array order or interface language", () => {
  const tracks = [{ language: "ar", label: "Arabic" }, { language: "en", label: "English" }, { language: "zh-CN", label: "Chinese" }];
  assert.equal(preferredSubtitle(tracks).label, "Chinese");
  assert.equal(preferredSubtitle(tracks.slice(0, 2)), undefined);
  assert.equal(preferredSubtitle([]), undefined);
  assert.equal(preferredSubtitle(undefined), undefined);
});

test("mislabeled HiAnime tracks use the explicit label instead of a universal en tag", () => {
  const tracks = ["Arabic", "English", "Thai", "French", "Traditional Chinese", "Chinese (Simplified)"].map((label) => ({ label, language: "en" }));
  assert.deepEqual(tracks.map(subtitleLanguage), ["ar", "en", "th", "fr", "zh-Hant", "zh-Hans"]);
  assert.equal(preferredSubtitle(tracks).label, "Chinese (Simplified)");
  assert.equal(preferredSubtitle(tracks.slice(0, 5)).label, "Traditional Chinese");
  assert.equal(preferredSubtitle(tracks.slice(0, 4)), undefined);
  assert.equal(subtitleLanguage({ label: "English", language: "zh" }), "en");
  assert.equal(subtitleLanguage({ label: "字幕", language: "zh_TW" }), "zh-Hant");
  assert.equal(subtitleLanguage({ label: "简体中文", language: "en" }), "zh-Hans");
  assert.equal(subtitleLanguage({ label: "Chinese", language: "zh-TW" }), "zh-Hant");
  assert.equal(subtitleLanguage({ label: "Chinese", language: "en" }), "zh");
  assert.equal(subtitleKey({ label: "English", language: "en", url: "episode1" }), subtitleKey({ label: "English", language: "en", url: "episode2" }));
});
const road = (id, numbers) => ({
  id,
  label: id,
  episodes: numbers.map((number) => ({
    id: String(number),
    label: String(number),
    episodeNumber: number,
  })),
});

test("new playback prefers original audio even when Dub is listed first; explicit choices win", () => {
  const roads = [road("dub", [1, 2]), road("sub", [1, 2])];
  assert.equal(initialPlaybackRoad(roads, 1), 1);
  assert.equal(initialPlaybackRoad(roads, 1, 0), 0);
  assert.equal(initialPlaybackRoad(roads, 1, undefined, "dub"), 0);
  assert.equal(initialPlaybackRoad([road("sub", [1]), road("dub", [1, 2])], 2), 1);
});

test("manual correction is not filtered by the catalog's AniList ID, year, or aliases", () => {
  const context = {
    anilistId: 178789,
    year: 2026,
    episodeCount: 14,
    episodeNumber: 5,
  };
  assert.deepEqual(
    playbackSearchRequest("Corrected Part 2", ["Old Title"], context, true),
    {
      query: "Corrected Part 2",
      anilistId: null,
      alternativeTitles: [],
      year: null,
      episodeCount: null,
      episodeNumber: 5,
      limit: 20,
    },
  );
  assert.equal(
    playbackSearchRequest("Original", ["Alias"], context, false).anilistId,
    178789,
  );
});

test("catalog aliases obey the actual IPC character/count limits before reaching any provider", () => {
  const aliases = ["Sousou no Frieren", "葬送的芙莉莲", "x".repeat(201), "中".repeat(201),
    " ", ...Array.from({ length: 30 }, (_, index) => `Localized title ${index}`)];
  const request = playbackSearchRequest("Sousou no Frieren", aliases, { anilistId: 154587 }, false);
  assert.equal(request.query, "Sousou no Frieren");
  assert.equal(request.alternativeTitles.length, 8);
  assert.equal(request.alternativeTitles[0], "葬送的芙莉莲");
  assert.ok(request.alternativeTitles.every((title) => [...title].length <= 200));
  assert.ok(!request.alternativeTitles.includes(request.query));
  assert.equal(playbackSearchRequest("中".repeat(201), ["Valid Romaji Title"], {}, false).query, "Valid Romaji Title");
  assert.equal(playbackSearchRequest("中".repeat(100), [], {}, false).query.length, 100);
});

test("a successfully played manual binding survives stricter automatic search results", () => {
  const automatic = {
    id: "hianime:other-season-456",
    title: "Other Season",
    exactMatch: true,
    episodeCount: 12,
    year: 2026,
  };
  const restored = restoredPlaybackCandidate(
    "builtin:hianime",
    [automatic],
    [binding],
  );
  assert.equal(restored.id, binding.remote_media_url);
  assert.equal(restored.title, binding.remote_title);
  assert.equal(restored.exactMatch, false);
  assert.equal(
    restoredPlaybackCandidate("builtin:age", [], [binding]),
    undefined,
  );
});

test("restoration keeps fresh candidate metadata and still works when search is unavailable", () => {
  const fresh = {
    id: binding.remote_media_url,
    title: "Current Title",
    exactMatch: true,
    episodeCount: 10,
    year: 2026,
  };
  assert.equal(
    restoredPlaybackCandidate("builtin:hianime", [fresh], [binding]),
    fresh,
  );
  assert.equal(
    restoredPlaybackCandidate("builtin:hianime", [], [binding]).id,
    binding.remote_media_url,
  );
  assert.equal(
    restoredPlaybackCandidate(
      "builtin:hianime",
      [],
      [{ ...binding, remote_media_url: " " }],
    ),
    undefined,
  );
});

test("initial restoration chooses a line that actually offers the current episode", () => {
  const roads = [road("sub", [1, 2, 3]), road("dub", [1])];
  assert.equal(initialPlaybackRoad(roads, 1, 1), 1);
  assert.equal(initialPlaybackRoad(roads, 3, 1), 0);
  assert.equal(initialPlaybackRoad(roads, 3, -1), 0);
  assert.equal(initialPlaybackRoad(roads, 3, Number.NaN), 0);
  assert.equal(initialPlaybackRoad([], 1, 5), 0);
});

test("retry preserves a user's translation by ID across reordered responses and stale saved bindings", () => {
  const reordered = [road("dub", [1]), road("sub", [1, 2])];
  assert.equal(initialPlaybackRoad(reordered, 1, 1, "dub"), 0);
  // The user may be checking a line whose latest episode is still absent.
  // Retrying must not silently switch their chosen language.
  assert.equal(initialPlaybackRoad(reordered, 2, 1, "dub"), 0);
  assert.equal(initialPlaybackRoad(reordered, 2, 0, "removed-line"), 1);
});
