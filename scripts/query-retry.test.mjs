import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetry } from "../src/lib/query-client.ts";

test("queries retry once, but never into an AniList rate-limit timeout", () => {
  assert.equal(shouldRetry(0, "Data-source error: HTTP request failed"), true);
  assert.equal(shouldRetry(1, "Data-source error: HTTP request failed"), false);
  assert.equal(shouldRetry(0, "AniList rate limit reached (HTTP 429); retry in 42 s"), false);
  assert.equal(shouldRetry(0, new Error("429 Too Many Requests")), false);
});
