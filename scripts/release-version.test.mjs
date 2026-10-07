import assert from "node:assert/strict";
import test from "node:test";
import { releaseVersion } from "./check-version.mjs";

test("release tags identify one exact stable or preview version", () => {
  assert.deepEqual(releaseVersion("0.2.0", "v0.2.0"), { version: "0.2.0", prerelease: false });
  for (const channel of ["alpha", "beta", "rc"]) {
    const version = `0.2.0-${channel}.2`;
    assert.deepEqual(releaseVersion(version, `v${version}`), { version, prerelease: true });
  }
  for (const tag of ["main", "v1", "0.2.0", "v0.2.1", "v0.2.0-beta.1", "v0.2.0\n"]) {
    assert.throws(() => releaseVersion("0.2.0", tag));
  }
  for (const version of [undefined, null, 123, "01.2.0", "1.2", "1.2.3+build", "1.2.3-beta.01", "1.2.3-preview.1", "1.2.3\n"]) {
    assert.throws(() => releaseVersion(version));
  }
});
