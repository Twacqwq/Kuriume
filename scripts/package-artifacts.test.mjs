import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assembleRelease, packageFilename, platforms, stagePackages } from "./package-artifacts.mjs";

const identity = { version: "0.2.0-beta.1", sourceSha: "a".repeat(40), buildNumber: 3567001 };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "kuriume-packages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "artifacts"));
  const input = join(root, "downloaded");
  for (const [platform, config] of Object.entries(platforms)) {
    const paths = [];
    for (const extension of config.extensions) {
      // Desktop bundles come with Tauri's own names; staging renames them.
      // The mobile build scripts already write the published name.
      const name = platform === "android-arm64" || platform === "ios-unsigned"
        ? packageFilename(identity.version, platform, extension)
        : `Kuriume_${identity.version}_${platform}${extension}`;
      const path = join(root, "artifacts", name);
      await writeFile(path, `test package for ${platform}${extension}`);
      // Match tauri-action v1's pre-archive output on macOS.
      paths.push(extension === ".app.tar.gz" ? path.slice(0, -7) : path);
    }
    const { output } = await stagePackages({ root, ...identity, platform, paths, signing: config.signing[0] });
    await cp(output, input, { recursive: true });
  }
  return { root, input, output: join(root, "release"), ...identity };
}

test("all platforms share exact identity, normalized names and checksums", async t => {
  const args = await fixture(t);
  await writeFile(join(args.input, "private-key.jks"), "never publish unrelated files");
  const manifests = await assembleRelease(args);
  assert.equal(manifests.length, 4);
  assert.equal((await readdir(args.output)).length, 8); // Six packages and two metadata files.
  const sums = await readFile(join(args.output, "SHA256SUMS"), "utf8");
  assert.equal(sums.trim().split("\n").length, 6);
  assert.match(sums, /^[a-f0-9]{64}  Kuriume-0\.2\.0-beta\.1-macos-arm64\.dmg$/m);
  assert.deepEqual((await readdir(args.output)).filter((name) => name.startsWith("Kuriume-")).sort(), [
    "Kuriume-0.2.0-beta.1-android-arm64.apk",
    "Kuriume-0.2.0-beta.1-ios-unsigned.ipa",
    "Kuriume-0.2.0-beta.1-macos-arm64.app.tar.gz",
    "Kuriume-0.2.0-beta.1-macos-arm64.dmg",
    "Kuriume-0.2.0-beta.1-windows-x64.exe",
    "Kuriume-0.2.0-beta.1-windows-x64.msi",
  ]);
  assert.equal(packageFilename("0.3.0", "android-arm64", ".apk"), "Kuriume-0.3.0-android-arm64.apk");
  const manifest = JSON.parse(await readFile(join(args.output, "build-manifest.json"), "utf8"));
  assert.equal(manifest.buildNumber, identity.buildNumber, "the build number stays in the manifest");
  assert(!sums.includes("jks"));
  await assert.rejects(assembleRelease(args), /overwrite/);
  await assert.rejects(assembleRelease({ ...args, sourceSha: "b".repeat(40) }), /mismatched sourceSha/);
  await assert.rejects(assembleRelease({ ...args, version: "0.2.0" }), /mismatched version/);
  await assert.rejects(assembleRelease({ ...args, buildNumber: identity.buildNumber + 1 }), /mismatched buildNumber/);
  await assert.rejects(assembleRelease({ ...args, buildNumber: undefined }), /shared build number/);
});

test("release refuses corrupted, missing, duplicate and path-traversal packages", async t => {
  const args = await fixture(t);
  const path = join(args.input, "android-arm64.json");
  const original = JSON.parse(await readFile(path, "utf8"));
  const packagePath = join(args.input, original.files[0].name);
  const packageData = await readFile(packagePath);
  await writeFile(packagePath, "corrupted bytes");
  await assert.rejects(assembleRelease(args), /checksum mismatch/);
  await writeFile(packagePath, packageData);
  for (const files of [[], [original.files[0], original.files[0]], [{ ...original.files[0], name: "../secret.apk" }]]) {
    await writeFile(path, JSON.stringify({ ...original, files }));
    await assert.rejects(assembleRelease(args), /incomplete package set|missing or duplicate/);
  }
  await writeFile(path, JSON.stringify({ ...original, signing: "unsigned" }));
  await assert.rejects(assembleRelease(args), /invalid signing status/);
  await writeFile(path, JSON.stringify(original));
  await rm(packagePath);
  await assert.rejects(assembleRelease(args), /ENOENT/);
  await assert.rejects(readdir(args.output), /ENOENT/); // Nothing published on any failure.
});

test("staging rejects ambiguous, empty and outside-checkout packages", async t => {
  const parent = await mkdtemp(join(tmpdir(), "kuriume-staging-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const stage = async (label, paths, signing = "unsigned") => {
    const root = join(parent, label);
    await mkdir(root);
    return stagePackages({ root, ...identity, platform: "windows-x64", paths, signing });
  };
  await assert.rejects(stage("missing", []), /exactly one/);
  await assert.rejects(stage("duplicate", ["one.exe", "two.exe"]), /exactly one/);
  await assert.rejects(stage("signing", [], "notarized"), /Invalid signing/);
  const external = join(parent, "outside.exe");
  await writeFile(external, "external");
  await assert.rejects(stage("outside", [external]), /inside the checkout/);
  // Creating symlinks on Windows requires privileges unrelated to packaging.
  if (process.platform !== "win32") {
    const root = join(parent, "links");
    await mkdir(root);
    const link = join(root, "linked.exe");
    await symlink(external, link);
    await assert.rejects(stagePackages({ root, ...identity, platform: "windows-x64", paths: [link], signing: "unsigned" }), /inside the checkout/);
  }
  const emptyRoot = join(parent, "empty");
  await mkdir(emptyRoot);
  const empty = join(emptyRoot, "empty.exe");
  await writeFile(empty, "");
  await assert.rejects(stagePackages({ root: emptyRoot, ...identity, platform: "windows-x64", paths: [empty], signing: "unsigned" }), /nonempty/);
});

// The publisher runs on Ubuntu; exercise its actual shell with a fake gh
// function. This test never authenticates or calls GitHub.
test("the release job fills a draft, guards tags/public releases and cleans only superseded draft installers", {
  skip: process.platform === "win32" || spawnSync("jq", ["--version"]).status !== 0,
}, async t => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const marker = "      - name: Upload the complete package set to the draft release\n        run: |\n";
  assert(workflow.includes(marker));
  const script = workflow.split(marker)[1].split("\n").map(line => line.slice(10)).join("\n");
  const gh = `
    gh() {
      printf '%s\\n' "$*" >> calls.log
      case "$1 $2" in
        'api '*) printf '%s\\n' "$REMOTE_SHA" ;;
        'release view')
          if [ "$DRAFT_STATE" = absent ]; then return 1; fi
          printf '{"isDraft":%s,"assets":[{"name":"Kuriume-old-ios-unsigned.ipa"},{"name":"SHA256SUMS"},{"name":"notes.txt"},{"name":"Kuriume-current.apk"}]}\\n' "$DRAFT_STATE" ;;
        'release create'|'release upload'|'release edit'|'release delete-asset') return 0 ;;
        *) return 99 ;;
      esac
    }
  `;
  for (const [name, state, sha, prerelease, success] of [
    ["new", "absent", identity.sourceSha, "false", true],
    ["draft", "true", identity.sourceSha, "true", true],
    ["published", "false", identity.sourceSha, "false", false],
    ["moved", "true", "b".repeat(40), "false", false],
  ]) {
    const root = await mkdtemp(join(tmpdir(), `kuriume-publish-${name}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "artifacts/release"), { recursive: true });
    await writeFile(join(root, "artifacts/release/Kuriume-current.apk"), "verified package");
    await writeFile(join(root, "artifacts/release/SHA256SUMS"), "checksums");
    await writeFile(join(root, "artifacts/release/build-manifest.json"), "{}");
    const result = spawnSync("bash", ["-c", gh + script], {
      cwd: root, encoding: "utf8", env: { ...process.env, GH_REPO: "example/repo", RELEASE_TAG: "v0.2.0",
        RELEASE_SHA: identity.sourceSha, REMOTE_SHA: sha, DRAFT_STATE: state, PRERELEASE: prerelease },
    });
    assert.equal(result.status === 0, success, result.stderr || result.error?.message);
    const calls = await readFile(join(root, "calls.log"), "utf8");
    if (!success) {
      assert(!/release (upload|edit|delete-asset|create)/.test(calls));
    } else {
      // Only installers go to the release; the records stay with the run.
      assert.match(calls, /^release upload v0.2.0 artifacts\/release\/Kuriume-current.apk --clobber$/m);
      // Publishing is a person's decision after reviewing the notes.
      assert(!/--draft=false/.test(calls), "the release must stay a draft");
      if (name === "new") assert.match(calls, /release create v0.2.0 --verify-tag --draft --notes-file release-notes.md/);
      if (name === "draft") {
        assert.match(calls, /delete-asset v0.2.0 Kuriume-old-ios-unsigned.ipa --yes/);
        assert.match(calls, /delete-asset v0.2.0 SHA256SUMS --yes/);
        assert(!/delete-asset.*(?:notes.txt|Kuriume-current.apk)/.test(calls));
        assert.match(calls, /release edit v0.2.0 --prerelease$/m);
      }
    }
  }
});
