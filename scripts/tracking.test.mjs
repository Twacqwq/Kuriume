import assert from "node:assert/strict";
import test from "node:test";
import { airedEpisodes, latestPerWork, minutesLeft, watchedThrough } from "../src/lib/tracking.ts";

const entry = (episode, position, duration = 1440, external_id = "1") => ({ provider: "anilist", external_id, episode, position, duration, watched_at: "" });

test("aired episodes prefer the catalog, then this week's schedule, then a finished count", () => {
  assert.equal(airedEpisodes({ aired_episodes: 5, schedule: null, status: "RELEASING", total_episodes: 12 }), 5);
  assert.equal(airedEpisodes({ aired_episodes: null, schedule: { episode: 6, airing_at: 100 }, status: "RELEASING", total_episodes: 12 }, 200), 6);
  assert.equal(airedEpisodes({ aired_episodes: null, schedule: { episode: 6, airing_at: 300 }, status: "RELEASING", total_episodes: 12 }, 200), 5);
  assert.equal(airedEpisodes({ aired_episodes: null, schedule: null, status: "FINISHED", total_episodes: 12 }), 12);
  assert.equal(airedEpisodes({ aired_episodes: null, schedule: null, status: "NOT_YET_RELEASED", total_episodes: 12 }), null);
});

test("starting an episode implies the earlier ones; finishing counts it", () => {
  assert.equal(watchedThrough([], "anilist:1"), 0);
  assert.equal(watchedThrough([entry(3, 100)], "anilist:1"), 2);
  assert.equal(watchedThrough([entry(3, 1400)], "anilist:1"), 3);
  assert.equal(watchedThrough([entry(3, 1400), entry(5, 10)], "anilist:1"), 4);
  assert.equal(watchedThrough([entry(7, 1400, 1440, "2")], "anilist:1"), 0, "other works are ignored");
});

test("minutes left rounds up and hides finished or unknown episodes", () => {
  assert.equal(minutesLeft({ position: 60, duration: 180 }), 2);
  assert.equal(minutesLeft({ position: 179, duration: 180 }), null);
  assert.equal(minutesLeft({ position: 10, duration: 0 }), null);
});

test("Bangumi history counts only for the Bangumi entry", () => {
  const bangumi = { ...entry(4, 1400, 1440, "21"), provider: "bangumi" };
  assert.equal(watchedThrough([bangumi], "bangumi:21"), 4);
  assert.equal(watchedThrough([bangumi], "anilist:21"), 0);
});

test("history shows one row per work: its latest episode, newest work first", () => {
  const rows = [
    { media_id: "a", episode: 3, watched_at: "2026-10-20T10:00:00Z" },
    { media_id: "b", episode: 1, watched_at: "2026-10-21T09:00:00Z" },
    { media_id: "a", episode: 4, watched_at: "2026-10-21T12:00:00Z" },
    { media_id: "a", episode: 2, watched_at: "2026-10-19T08:00:00Z" },
  ];
  assert.deepEqual(latestPerWork(rows).map((row) => `${row.media_id}${row.episode}`), ["a4", "b1"]);
  assert.deepEqual(latestPerWork([]), []);
});
