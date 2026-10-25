import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mobileVersion } from "./mobile-version.mjs";

export const platforms = {
  "macos-arm64": { extensions: [".dmg", ".app.tar.gz"], signing: ["ad-hoc", "notarized"] },
  "windows-x64": { extensions: [".exe", ".msi"], signing: ["unsigned"] },
  "android-arm64": { extensions: [".apk"], signing: ["signed"] },
  "ios-unsigned": { extensions: [".ipa"], signing: ["unsigned"] },
};

/**
 * Bundles Tauri's updater installs in place, and the latest.json platform
 * keys that point at them. CI signs them with the updater key when
 * TAURI_SIGNING_PRIVATE_KEY is set (src-tauri/tauri.updater.conf.json),
 * leaving `<bundle>.sig` next to each one.
 */
export const updaterBundles = {
  "macos-arm64": { ".app.tar.gz": ["darwin-aarch64"] },
  // An NSIS install updates with NSIS and an MSI install with MSI; the plain
  // key is the fallback for older updaters.
  "windows-x64": { ".exe": ["windows-x86_64", "windows-x86_64-nsis"], ".msi": ["windows-x86_64-msi"] },
};
const SIGNATURE = /^[A-Za-z0-9+/]+={0,2}$/;

async function updaterSignature(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  assert(info.isFile(), `Not a regular file: ${path}`);
  const signature = (await readFile(path, "utf8")).trim();
  assert(SIGNATURE.test(signature) && signature.length > 64, `Not an updater signature: ${path}`);
  return signature;
}

function identity(version, sourceSha, buildNumber) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/, "A resolved source commit SHA is required");
  assert(buildNumber !== undefined && buildNumber !== null && buildNumber !== "", "A shared build number is required");
  return { version, sourceSha, buildNumber: mobileVersion(version, buildNumber).buildNumber };
}

/**
 * Published package name: product, version, platform and architecture, as
 * people see it on the release page (`Kuriume-0.2.0-android-arm64.apk`). The
 * build number stays inside the packages and the manifests.
 */
export function packageFilename(version, platform, extension) {
  return `Kuriume-${version}-${platform}${extension}`;
}

function filename(meta, platform, extension) {
  return packageFilename(meta.version, platform, extension);
}

async function checksum(path) {
  const info = await lstat(path);
  assert(info.isFile() && info.size > 0, `Not a nonempty regular file: ${path}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { size: info.size, sha256: hash.digest("hex") };
}

// Only explicitly expected package formats enter the staging directory. Never
// upload an entire build tree, which may contain signing keys or intermediates.
export async function stagePackages({ root, platform, version, sourceSha, buildNumber, signing, paths = [] }) {
  assert(Object.hasOwn(platforms, platform), `Unknown platform: ${platform}`);
  const config = platforms[platform];
  const meta = identity(version, sourceSha, buildNumber);
  assert(config.signing.includes(signing), `Invalid signing status for ${platform}`);
  assert(Array.isArray(paths) && paths.every(path => typeof path === "string"), "Artifact paths must be a JSON string array");
  // tauri-action v1 emits artifactPaths before archiving .app directories.
  if (platform === "macos-arm64") paths = paths.map(path => path.endsWith(".app") ? `${path}.tar.gz` : path);
  if (platform === "ios-unsigned" || platform === "android-arm64") {
    paths = [join(root, "artifacts", filename(meta, platform, config.extensions[0]))];
  }
  const output = join(root, "artifacts", "staged", platform);
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, "Refusing to mix packages with a previous staging run");
  const files = [];
  for (const extension of config.extensions) {
    const matches = [...new Set(paths.filter(path => path.endsWith(extension)))];
    assert.equal(matches.length, 1, `Expected exactly one ${platform} ${extension} package`);
    const source = resolve(root, matches[0]);
    const inside = relative(await realpath(root), await realpath(source));
    assert(!inside.startsWith("..") && !isAbsolute(inside), "Artifact must be inside the checkout");
    const digest = await checksum(source);
    const name = filename(meta, platform, extension);
    await copyFile(source, join(output, name));
    const signature = updaterBundles[platform]?.[extension] ? await updaterSignature(`${source}.sig`) : undefined;
    files.push({ name, ...digest, ...(signature && { signature }) });
  }
  const signed = files.filter(file => file.signature).length;
  assert(signed === 0 || signed === Object.keys(updaterBundles[platform] ?? {}).length,
    `${platform}: some updater bundles are signed and some are not`);
  const manifest = { schema: 1, ...meta, platform, signing, files };
  await writeFile(join(output, `${platform}.json`), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(output, `${platform}-SHA256SUMS`), files.map(file => `${file.sha256}  ${file.name}\n`).join(""));
  return { output, manifest };
}

/**
 * The updater manifest Tauri reads from
 * releases/latest/download/latest.json. Only a published release is
 * "latest", so drafts and prereleases never reach installed apps.
 */
export function updaterManifest({ version, repository, files }) {
  const base = `https://github.com/${repository}/releases/download/v${version}`;
  const platforms = {};
  for (const [platform, bundles] of Object.entries(updaterBundles)) {
    for (const [extension, keys] of Object.entries(bundles)) {
      const name = filename({ version }, platform, extension);
      const file = files.find(entry => entry.name === name);
      assert(file?.signature, `${name}: missing updater signature`);
      for (const key of keys) platforms[key] = { signature: file.signature, url: `${base}/${name}` };
    }
  }
  return { version, platforms };
}

export async function assembleRelease({ input, output, version, sourceSha, buildNumber, repository = "Twacqwq/Kuriume" }) {
  const expected = identity(version, sourceSha, buildNumber);
  const manifests = [];
  const packages = [];
  for (const [platform, config] of Object.entries(platforms)) {
    const manifest = JSON.parse(await readFile(join(input, `${platform}.json`), "utf8"));
    assert.equal(manifest.schema, 1, "Unsupported artifact manifest");
    for (const [key, value] of Object.entries(expected)) assert.equal(manifest[key], value, `${platform}: mismatched ${key}`);
    assert.equal(manifest.platform, platform);
    assert(config.signing.includes(manifest.signing), `${platform}: invalid signing status`);
    assert.equal(manifest.files.length, config.extensions.length, `${platform}: incomplete package set`);
    for (const extension of config.extensions) {
      const name = filename(expected, platform, extension);
      const entries = manifest.files.filter(file => file.name === name);
      assert.equal(entries.length, 1, `${platform}: missing or duplicate ${name}`);
      assert.deepEqual(await checksum(join(input, name)), { size: entries[0].size, sha256: entries[0].sha256 }, `${name}: checksum mismatch`);
      packages.push(entries[0]);
    }
    manifests.push(manifest);
  }
  // All updater bundles are signed (CI has the updater key) or none are.
  const updatable = Object.values(updaterBundles).reduce((count, bundles) => count + Object.keys(bundles).length, 0);
  const signed = packages.filter(file => file.signature).length;
  assert(signed === 0 || signed === updatable, "Updater signatures are incomplete");
  const latest = signed ? updaterManifest({ version, repository, files: packages }) : undefined;
  // Verify the entire set before copying anything to the publish directory.
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, "Refusing to overwrite existing release output");
  for (const file of packages) await copyFile(join(input, file.name), join(output, file.name));
  await writeFile(join(output, "SHA256SUMS"), packages.map(file => `${file.sha256}  ${file.name}\n`).join(""));
  await writeFile(join(output, "build-manifest.json"), JSON.stringify({ schema: 1, ...expected, platforms: manifests }, null, 2) + "\n");
  if (latest) await writeFile(join(output, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
  return manifests;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const args = { root, version, sourceSha: process.env.SOURCE_SHA, buildNumber: process.env.KURIUME_BUILD_NUMBER };
  if (process.argv[2] === "stage") {
    const { output, manifest } = await stagePackages({ ...args, platform: process.env.PACKAGE_PLATFORM,
      signing: process.env.PACKAGE_SIGNING, paths: JSON.parse(process.env.PACKAGE_PATHS || "[]") });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `path=${output}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### ${manifest.platform}\n\nCommit: \`${manifest.sourceSha}\` · Build: ${manifest.buildNumber} · Signing: **${manifest.signing}**\n\n` +
      manifest.files.map(file => `- \`${file.name}\` (${(file.size / 1048576).toFixed(1)} MiB)\n`).join("") +
      (manifest.platform === "ios-unsigned" ? "\nIPA requires user-managed re-signing; downloading is not installation.\n" : ""));
    console.log(`Staged ${manifest.platform}: ${output}`);
  } else if (process.argv[2] === "release") {
    const output = join(root, "artifacts", "release");
    await assembleRelease({ ...args, input: join(root, "artifacts", "downloaded"), output,
      repository: process.env.GITHUB_REPOSITORY || undefined });
    console.log("Verified all six packages, source commit, version, build number and SHA-256 checksums.");
    const updater = (await readdir(output)).includes("latest.json");
    console.log(updater ? "Wrote latest.json for in-app updates." : "No updater signatures (TAURI_SIGNING_PRIVATE_KEY unset): no latest.json.");
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      updater ? "In-app updates: `latest.json` included.\n" : "In-app updates: **off** (no updater signing key), no `latest.json`.\n");
  } else {
    throw new Error("Usage: node scripts/package-artifacts.mjs stage|release");
  }
}
