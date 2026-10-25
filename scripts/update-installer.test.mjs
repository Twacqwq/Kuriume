import assert from "node:assert/strict";
import test from "node:test";
import {
  failureReason, formatProgress, getInstallState, installUpdate, resetInstall, subscribeInstall, supportsInAppUpdate,
} from "../src/lib/update-installer.ts";

const apk = { name: "Kuriume-0.3.0-android-arm64.apk", url: "https://github.com/Twacqwq/Kuriume/releases/download/v0.3.0/Kuriume-0.3.0-android-arm64.apk", size: 2097152, sha256: `sha256:${"a".repeat(64)}` };
const update = { status: "available", current: "0.2.0", latest: "0.3.0", notes: "", pageUrl: "", publishedAt: null, download: apk };
const channel = () => ({ onmessage: () => {} });

test("desktop and Android install in the app; iOS opens the release page", () => {
  assert.equal(supportsInAppUpdate("macos"), true);
  assert.equal(supportsInAppUpdate("windows"), true);
  assert.equal(supportsInAppUpdate("android"), true);
  assert.equal(supportsInAppUpdate("ios"), false);
  assert.equal(supportsInAppUpdate("other"), false);
});

test("an Android install reports progress, then hands over to the system installer", async () => {
  resetInstall();
  const seen = [];
  const unsubscribe = subscribeInstall(() => seen.push(getInstallState().phase));
  let request;
  await installUpdate(update, "android", async (command, args) => {
    request = { command, args };
    args.onProgress.onmessage({ stage: "downloading", downloaded: 1048576, total: 2097152 });
    assert.deepEqual(getInstallState(), { phase: "downloading", version: "0.3.0", downloaded: 1048576, total: 2097152 });
    args.onProgress.onmessage({ stage: "installing" });
    return "installer";
  }, channel);
  unsubscribe();
  assert.equal(request.command, "update_install");
  assert.deepEqual(request.args.package, { url: apk.url, sha256: apk.sha256 });
  assert.equal(request.args.version, "0.3.0");
  assert.deepEqual(seen, ["downloading", "downloading", "installing", "installer"]);
});

test("desktop installs from latest.json and asks for a restart", async () => {
  resetInstall();
  let request;
  await installUpdate(update, "macos", async (command, args) => { request = args; return "restart"; }, channel);
  assert.equal(request.package, null, "desktop never downloads the GitHub asset itself");
  assert.deepEqual(getInstallState(), { phase: "restart", version: "0.3.0" });
});

test("failures say what to do next, and one install runs at a time", async () => {
  assert.equal(failureReason("INSTALL_PERMISSION_REQUIRED"), "permission");
  assert.equal(failureReason("UPDATE_UNAVAILABLE: HTTP 404"), "unavailable");
  assert.equal(failureReason("connection reset"), "failed");
  resetInstall();
  await installUpdate(update, "android", async () => { throw "INSTALL_PERMISSION_REQUIRED"; }, channel);
  assert.equal(getInstallState().phase, "error");
  assert.equal(getInstallState().reason, "permission");

  resetInstall();
  let release;
  let calls = 0;
  const pending = installUpdate(update, "windows", () => { calls++; return new Promise((resolve) => { release = resolve; }); }, channel);
  await installUpdate(update, "windows", async () => { calls++; return "restart"; }, channel);
  resetInstall(); // ignored while downloading
  assert.equal(getInstallState().phase, "downloading");
  release("restart");
  await pending;
  assert.equal(calls, 1);
  assert.equal(getInstallState().phase, "restart");
});

test("progress reads in megabytes", () => {
  assert.equal(formatProgress(1572864, 36909875), "1.5 / 35.2 MB");
  assert.equal(formatProgress(1572864, null), "1.5 MB");
});
