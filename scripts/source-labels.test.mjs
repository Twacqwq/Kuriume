import assert from "node:assert/strict";
import test from "node:test";
import { roadLabel, streamLabel } from "../src/lib/source-labels.ts";

test("lines and streams are numbered, whatever the site calls them", () => {
  assert.equal(roadLabel("builtin:age", "暴风云", 0, true), "线路 1");
  assert.equal(roadLabel("rule:imported", "r7", 2, false), "Server 3");
  assert.equal(streamLabel(1, true), "节点 2");
  assert.equal(streamLabel(0, false), "Mirror 1");
});

test("HiAnime's lines stay named as audio versions", () => {
  assert.equal(roadLabel("builtin:hianime", "sub", 0, true), "原声 · Sub");
  assert.equal(roadLabel("builtin:hianime", "dub", 1, false), "Dubbed · Dub");
  assert.equal(roadLabel("builtin:hianime", "raw", 2, true), "线路 3");
});
