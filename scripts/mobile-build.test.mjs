import assert from "node:assert/strict";
import test from "node:test";
import { mobileVersion } from "./mobile-version.mjs";

test("mobile versions share a build number, preserve prereleases, and fit both platforms", () => {
  assert.deepEqual(mobileVersion("0.2.0-beta.1", "3554321"), {
    version: "0.2.0-beta.1", buildNumber: 3554321, shortVersion: "0.2.0", iosBuildVersion: "355.43.21",
  });
  for (const number of [10000, 99999999]) {
    const result = mobileVersion("1.0.0", number);
    const [major, minor, patch] = result.iosBuildVersion.split(".").map(Number);
    assert.equal(major * 10000 + minor * 100 + patch, number);
    assert(number < 2100000000 && major <= 9999 && minor <= 99 && patch <= 99);
  }
  for (const number of ["", "x", 0, 9999, -1, 1.5, Infinity, 100000000]) {
    assert.throws(() => mobileVersion("1.0.0", number));
  }
  assert.throws(() => mobileVersion("v1.0.0", 3554321));
});
