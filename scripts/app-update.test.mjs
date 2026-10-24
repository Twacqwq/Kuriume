import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdate, compareVersions, detectPlatform, fetchReleaseNotes, isUpgrade, pickDownload, plainReleaseNotes } from "../src/lib/app-update.ts";

test("versions follow semver order, prereleases below their release", () => {
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("v0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compareVersions("0.1.0", "v0.1.0"), 0);
  assert.equal(compareVersions("nightly", "0.1.0"), 0, "unparsable never claims an update");
});

const asset = (name) => ({ name, size: 1, browser_download_url: `https://github.com/Twacqwq/Kuriume/releases/download/v0.2.0/${name}` });
const release = {
  tag_name: "v0.2.0", html_url: "https://github.com/Twacqwq/Kuriume/releases/tag/v0.2.0", body: "## What's Changed\n* Faster search by @a in [#3](https://x)\n\n**Full Changelog**: …",
  published_at: "2026-10-20T00:00:00Z", draft: false, prerelease: false,
  assets: ["Kuriume-0.2.0-12-android-arm64.apk", "Kuriume-0.2.0-12-macos-arm64.dmg", "Kuriume-0.2.0-12-macos-arm64.app.tar.gz", "Kuriume-0.2.0-12-windows-x64.exe", "Kuriume-0.2.0-12-windows-x64.msi", "Kuriume-0.2.0-12-ios-unsigned.ipa"].map(asset),
};
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("each platform gets its own package; iOS gets the release page", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 7)"), "android");
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(pickDownload(release, "android")?.name, "Kuriume-0.2.0-12-android-arm64.apk");
  assert.equal(pickDownload(release, "macos")?.name, "Kuriume-0.2.0-12-macos-arm64.dmg");
  assert.equal(pickDownload(release, "windows")?.name, "Kuriume-0.2.0-12-windows-x64.exe");
  assert.equal(pickDownload(release, "ios"), null);
  // Releases name packages without the build number; both forms match.
  const current = { assets: ["Kuriume-0.3.0-android-arm64.apk", "Kuriume-0.3.0-windows-x64.exe", "Kuriume-0.3.0-windows-x64.msi"].map(asset) };
  assert.equal(pickDownload(current, "android")?.name, "Kuriume-0.3.0-android-arm64.apk");
  assert.equal(pickDownload(current, "windows")?.name, "Kuriume-0.3.0-windows-x64.exe");
  assert.equal(pickDownload({ assets: [{ ...asset("Kuriume-0.2.0-1-android-arm64.apk"), browser_download_url: "https://evil.example/x.apk" }] }, "android"), null);
});

test("update checks compare with the latest published release", async () => {
  const available = await checkForUpdate("0.1.0", "android", reply(200, release));
  assert.equal(available.status, "available");
  assert.equal(available.latest, "0.2.0");
  assert.match(available.download.url, /android-arm64\.apk$/);
  assert.deepEqual(await checkForUpdate("0.2.0", "android", reply(200, release)), { status: "latest", current: "0.2.0", latest: "0.2.0" });
  assert.equal((await checkForUpdate("0.1.0", "android", reply(200, { ...release, prerelease: true }))).status, "latest");
  assert.deepEqual(await checkForUpdate("0.1.0", "android", reply(404)), { status: "latest", current: "0.1.0", latest: null });
  await assert.rejects(checkForUpdate("0.1.0", "android", reply(403)), /rate limit/);
});

test("release notes become short plain lines", () => {
  assert.deepEqual(plainReleaseNotes(release.body), ["What's Changed", "• Faster search by @a in #3"]);
  const changelog = "## [0.2.0](https://github.com/Twacqwq/Kuriume/compare/v0.1.0...v0.2.0) (2026-10-25)\n\n### Features\n\n* manga catalog from Bangumi ([#12](https://x/12)) ([1bc9330](https://x/1bc9330))\n* **player:** double tap pauses ([abc1234](https://x/abc))\n\n### Bug Fixes\n\n* Android playback no longer stalls ([354c3d8](https://x/354c3d8))";
  assert.deepEqual(plainReleaseNotes(changelog, 12), [
    "Features", "• manga catalog from Bangumi", "• player: double tap pauses", "Bug Fixes", "• Android playback no longer stalls",
  ]);
});

test("what's new appears once after an upgrade, never on a first install", async () => {
  assert.equal(isUpgrade("0.2.0", "0.1.0"), true);
  assert.equal(isUpgrade("0.2.0", "0.2.0"), false);
  assert.equal(isUpgrade("0.2.0", null), false, "first install: nothing to compare");
  assert.equal(isUpgrade("0.1.0", "0.2.0"), false, "a downgrade is not news");
  const requested = [];
  const fetchTag = (status, body) => async (url) => { requested.push(url); return { status, ok: status === 200, json: async () => body }; };
  assert.deepEqual(await fetchReleaseNotes("0.2.0", fetchTag(200, { ...release, body: " notes " })), { version: "0.2.0", notes: "notes", pageUrl: release.html_url });
  assert.equal(requested[0], "https://api.github.com/repos/Twacqwq/Kuriume/releases/tags/v0.2.0");
  assert.equal(await fetchReleaseNotes("0.2.0", fetchTag(404)), null);
  assert.equal(await fetchReleaseNotes("0.2.0", fetchTag(200, { ...release, draft: true })), null);
  assert.equal((await fetchReleaseNotes("0.2.0", fetchTag(200, { ...release, html_url: "https://evil.example" }))).pageUrl, "https://github.com/Twacqwq/Kuriume/releases");
});
