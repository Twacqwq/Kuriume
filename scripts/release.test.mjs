import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bumpVersionFiles, compareReleaseVersions } from "./release.mjs";
import { parseCommit, releaseNotes } from "./release-notes.mjs";

const repo = new URL("..", import.meta.url).pathname;
const VERSION_FILES = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock",
  "src-tauri/crates/kuriume-provider/Cargo.toml", "src-tauri/crates/kuriume-store/Cargo.toml", "src-tauri/crates/tauri-plugin-mobile/Cargo.toml"];

async function copyVersionFiles(t) {
  const root = await mkdtemp(join(tmpdir(), "kuriume-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of VERSION_FILES) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await cp(join(repo, file), join(root, file));
  }
  return root;
}

test("versions order stable releases above their previews", () => {
  assert.equal(compareReleaseVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareReleaseVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareReleaseVersions("0.3.0", "0.3.0-rc.1"), 1);
  assert.equal(compareReleaseVersions("0.3.0-rc.1", "0.3.0-beta.9"), 1);
  assert.equal(compareReleaseVersions("0.3.0-beta.10", "0.3.0-beta.2"), 1);
  assert.equal(compareReleaseVersions("0.3.0-alpha.1", "0.3.0-beta.1"), -1);
  assert.equal(compareReleaseVersions("0.3.0", "0.3.0"), 0);
});

test("a release bump changes only the product version fields", async (t) => {
  const root = await copyVersionFiles(t);
  const before = Object.fromEntries(await Promise.all(VERSION_FILES.map(async (file) => [file, await readFile(join(root, file), "utf8")])));
  const current = JSON.parse(before["package.json"]).version;
  const next = "9.8.7-beta.1";
  const { previous, files } = bumpVersionFiles(root, next);
  assert.equal(previous, current);
  assert.deepEqual(files, ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
  const json = async (file) => JSON.parse(await readFile(join(root, file), "utf8"));
  assert.equal((await json("package.json")).version, next);
  const lock = await json("package-lock.json");
  assert.equal(lock.version, next);
  assert.equal(lock.packages[""].version, next);
  assert.match(await readFile(join(root, "src-tauri/Cargo.toml"), "utf8"), new RegExp(`\\[workspace\\.package\\]\\nversion = "${next}"`));
  const cargoLock = await readFile(join(root, "src-tauri/Cargo.lock"), "utf8");
  for (const crate of ["kuriume", "kuriume-provider", "kuriume-store", "tauri-plugin-mobile"]) {
    assert.match(cargoLock, new RegExp(`name = "${crate}"\\nversion = "${next.replaceAll(".", "\\.")}"`));
  }
  // Nothing but version lines changed, and no dependency moved.
  for (const file of files) {
    const old = before[file].split("\n");
    const changed = (await readFile(join(root, file), "utf8")).split("\n").filter((line, index) => line !== old[index]);
    assert.ok(changed.length > 0 && changed.every((line) => line.includes(next)), `${file}: ${changed.join(" | ")}`);
  }
  assert.equal((cargoLock.match(new RegExp(next.replaceAll(".", "\\."), "g")) ?? []).length, 4);
});

test("a bump refuses old, equal or malformed versions and writes nothing then", async (t) => {
  const root = await copyVersionFiles(t);
  const current = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  for (const version of [current, "0.0.1", "1.2", "1.2.3+build", "1.2.3-preview.1"]) {
    assert.throws(() => bumpVersionFiles(root, version));
  }
  // A missing Cargo.lock entry aborts before any file is written.
  const lockPath = join(root, "src-tauri/Cargo.lock");
  await writeFile(lockPath, (await readFile(lockPath, "utf8")).replace('name = "kuriume-store"', 'name = "renamed-store"'));
  assert.throws(() => bumpVersionFiles(root, "99.0.0"), /kuriume-store/);
  assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, current);
});

test("release notes keep user-facing commits, grouped by kind", () => {
  assert.deepEqual(parseCommit("fix(android): media no longer stalls"), { type: "fix", scope: "android", breaking: false, description: "media no longer stalls" });
  assert.equal(parseCommit("feat!: new storage").breaking, true);
  assert.equal(parseCommit("refactor: x", "BREAKING CHANGE: removed y").breaking, true);
  assert.equal(parseCommit("Merge pull request #16 from a/b"), null);
  const notes = releaseNotes([
    { subject: "chore(release): v0.3.0" },
    { subject: "feat: manga catalog" },
    { subject: "fix(android): media no longer stalls" },
    { subject: "docs: readme" },
    { subject: "feat: manga catalog" },
    { subject: "perf: faster lists" },
    { subject: "refactor!: new storage" },
    { subject: "revert: undo x" },
  ], { repo: "o/r", previousTag: "v0.2.0", tag: "v0.3.0" });
  assert.equal(notes, [
    "### ⚠ BREAKING CHANGES", "", "* new storage", "",
    "### Features", "", "* manga catalog", "",
    "### Bug Fixes", "", "* **android:** media no longer stalls", "",
    "### Performance Improvements", "", "* faster lists", "",
    "**Full Changelog**: https://github.com/o/r/compare/v0.2.0...v0.3.0", "",
  ].join("\n"));
  assert.match(releaseNotes([{ subject: "chore: tidy" }], { repo: "o/r", previousTag: "v0.2.0", tag: "v0.3.0" }), /^No user-facing changes\./);
  assert.match(releaseNotes([], { repo: "o/r", previousTag: null, tag: "v0.1.0" }), /^First release of Kuriume\.\n\n\*\*Full Changelog\*\*: https:\/\/github\.com\/o\/r\/commits\/v0\.1\.0/);
});

test("release notes read the commits between the previous tag and this one", { skip: spawnSync("git", ["--version"]).status !== 0 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kuriume-notes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q");
  const commit = (message) => git("commit", "-q", "--allow-empty", "-m", message);
  commit("feat: before the last release");
  git("tag", "-a", "v0.2.0", "-m", "v0.2.0");
  commit("feat: manga tab");
  commit("ci: tidy workflows");
  commit("fix: Windows test line endings");
  git("tag", "-a", "v0.3.0", "-m", "v0.3.0");
  const notes = execFileSync(process.execPath, [join(repo, "scripts/release-notes.mjs"), "v0.3.0"], {
    cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "o/r" },
  });
  assert.equal(notes, "### Features\n\n* manga tab\n\n### Bug Fixes\n\n* Windows test line endings\n\n**Full Changelog**: https://github.com/o/r/compare/v0.2.0...v0.3.0\n");
  const first = execFileSync(process.execPath, [join(repo, "scripts/release-notes.mjs"), "v0.2.0"], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "o/r" } });
  assert.match(first, /^First release of Kuriume\./);
});
