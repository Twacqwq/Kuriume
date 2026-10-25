// Starts a release: `npm run release -- 0.3.0` (or 0.3.0-beta.1) on main.
// Writes the version to every version file on a new branch release/v0.3.0,
// commits "chore(release): v0.3.0" and creates the annotated tag v0.3.0.
// main only accepts pull requests, so the branch is merged through one (with
// a merge commit, which keeps the tagged commit in main's history). Pushing
// the tag builds all platforms into a draft GitHub release
// (.github/workflows/release.yml).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersion, releaseVersion } from "./check-version.mjs";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
const CHANNELS = ["alpha", "beta", "rc"];

/** 1 when `a` is newer than `b`, -1 when older, 0 when equal. */
export function compareReleaseVersions(a, b) {
  const [x, y] = [VERSION.exec(a), VERSION.exec(b)];
  assert(x && y, `Not a release version: ${x ? b : a}`);
  for (let index = 1; index <= 3; index++) {
    if (Number(x[index]) !== Number(y[index])) return Number(x[index]) > Number(y[index]) ? 1 : -1;
  }
  // A stable release outranks its own previews.
  if (!x[4] || !y[4]) return !x[4] && !y[4] ? 0 : x[4] ? -1 : 1;
  if (x[4] !== y[4]) return CHANNELS.indexOf(x[4]) > CHANNELS.indexOf(y[4]) ? 1 : -1;
  return Math.sign(Number(x[5]) - Number(y[5]));
}

/** Cargo package names whose version is the product version. */
function workspaceCrates(root) {
  const manifest = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
  const members = /members\s*=\s*\[([^\]]*)\]/.exec(manifest)?.[1].match(/"([^"]+)"/g) ?? [];
  const name = (text) => /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(text)?.[1];
  return [
    name(manifest),
    ...members.map((member) => name(readFileSync(resolve(root, "src-tauri", member.slice(1, -1), "Cargo.toml"), "utf8"))),
  ].filter(Boolean);
}

function replaceExactly(text, pattern, replacement, count, label) {
  let replaced = 0;
  const output = text.replace(pattern, (...match) => {
    replaced++;
    return typeof replacement === "function" ? replacement(...match) : replacement;
  });
  assert.equal(replaced, count, `Expected ${count} version field(s) in ${label}, found ${replaced}`);
  return output;
}

/**
 * Sets `next` in package.json, package-lock.json, the Cargo workspace and the
 * workspace entries of Cargo.lock, leaving every other byte (and every
 * dependency version) untouched. Returns the files it changed.
 */
export function bumpVersionFiles(root, next) {
  releaseVersion(next);
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const previous = JSON.parse(read("package.json")).version;
  assert(compareReleaseVersions(next, previous) > 0, `${next} must be newer than the current ${previous}`);
  const quoted = previous.replaceAll(".", "\\.");
  const edits = {
    "package.json": (text) => replaceExactly(text, new RegExp(`("version"\\s*:\\s*")${quoted}"`), (_, prefix) => `${prefix}${next}"`, 1, "package.json"),
    // The lockfile's own version and its root package entry.
    "package-lock.json": (text) => {
      const lock = JSON.parse(text);
      lock.version = next;
      lock.packages[""].version = next;
      // Keep the checkout's line endings (CRLF on Windows).
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      return (JSON.stringify(lock, null, 2) + "\n").replaceAll("\n", eol);
    },
    "src-tauri/Cargo.toml": (text) => replaceExactly(text,
      new RegExp(`(\\[workspace\\.package\\]\\r?\\nversion\\s*=\\s*")${quoted}"`), (_, prefix) => `${prefix}${next}"`, 1, "src-tauri/Cargo.toml"),
    "src-tauri/Cargo.lock": (text) => {
      for (const crate of workspaceCrates(root)) {
        text = replaceExactly(text, new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = ")${quoted}"`),
          (_, prefix) => `${prefix}${next}"`, 1, `Cargo.lock (${crate})`);
      }
      return text;
    },
  };
  // Every edit must succeed before any file is written.
  const outputs = Object.entries(edits).map(([path, edit]) => [path, edit(read(path))]);
  for (const [path, text] of outputs) writeFileSync(resolve(root, path), text);
  return { previous, files: Object.keys(edits) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    const next = process.argv[2]?.replace(/^v/, "");
    assert(next, "Usage: npm run release -- <version>   e.g. 0.3.0 or 0.3.0-beta.1");
    assert.equal(git("status", "--porcelain"), "", "Commit or stash your changes first");
    assert.equal(git("tag", "--list", `v${next}`), "", `Tag v${next} already exists`);
    const start = git("branch", "--show-current");
    if (start !== "main") console.warn(`Note: releasing from "${start || "a detached HEAD"}", not main.`);
    const branch = `release/v${next}`;
    assert.equal(git("branch", "--list", branch), "", `Branch ${branch} already exists`);
    const { previous, files } = bumpVersionFiles(root, next);
    try {
      checkVersion(root, `v${next}`);
    } catch (error) {
      // Leave the tree as it was.
      git("checkout", "--", ...files);
      throw error;
    }
    // A new branch from HEAD; the working tree stays as it is.
    git("switch", "-q", "-c", branch);
    git("add", "--", ...files);
    git("commit", "-q", "-m", `chore(release): v${next}`);
    git("tag", "-a", `v${next}`, "-m", `Kuriume v${next}`);
    console.log(`v${previous} → v${next}: committed on ${branch} and tagged v${next}.`);
    console.log(`
Next:
  1. git push origin ${branch} v${next}
     The tag builds the draft release.
  2. Open a pull request from ${branch} into main and merge it with
     "Create a merge commit" (not squash or rebase).
  3. git switch main && git pull && git branch -d ${branch}
  4. Edit the draft's notes on GitHub and publish it.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
