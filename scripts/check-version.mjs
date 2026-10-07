import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// One product version. Pre-release counters are explicit so tags remain
// portable to future mobile build-number mappings; build metadata is rejected.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

export function releaseVersion(version, tag) {
  assert.equal(typeof version, "string", "Product version must be a string");
  assert.equal(VERSION.exec(version)?.[0], version, "Use X.Y.Z or X.Y.Z-beta.N (alpha/rc also supported)");
  if (tag !== undefined) assert.equal(tag, `v${version}`, "Tag must exactly match the product version");
  return { version, prerelease: version.includes("-") };
}

export function checkVersion(root, tag) {
  const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const version = json("package.json").version;
  const release = releaseVersion(version, tag);
  const lock = json("package-lock.json");
  assert.equal(lock.version, version, "package-lock.json version is stale");
  assert.equal(lock.packages[""].version, version, "package-lock.json root package is stale");
  assert.equal(json(".release-please-manifest.json")["."], version, "Release manifest version is stale");
  assert.equal(json("src-tauri/tauri.conf.json").version, "../package.json", "Tauri must read the product version");

  const metadata = JSON.parse(execFileSync("cargo", [
    "metadata", "--manifest-path", "src-tauri/Cargo.toml", "--format-version", "1", "--no-deps", "--locked",
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  const crates = metadata.packages.filter((pkg) => metadata.workspace_members.includes(pkg.id));
  assert.ok(crates.length > 0, "Cargo workspace is empty");
  const cargoLock = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8");
  const entries = [...cargoLock.matchAll(/\[\[package\]\]\s+name = "([^"]+)"\s+version = "([^"]+)"/g)];
  for (const crate of crates) {
    assert.equal(crate.version, version, `${crate.name} version is stale`);
    // Cargo emits these fields in each package table. We only inspect local
    // workspace entries; dependency versions must never be bumped with the app.
    const entry = entries.find(([, name]) => name === crate.name);
    assert.equal(entry?.[2], version, `${crate.name} version in Cargo.lock is stale`);
  }
  return release;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const release = checkVersion(fileURLToPath(new URL("..", import.meta.url)), process.argv[2]);
    console.log(JSON.stringify(release));
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${release.version}\nprerelease=${release.prerelease}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
