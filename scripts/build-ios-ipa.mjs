import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersion } from "./check-version.mjs";
import { mobileVersion } from "./mobile-version.mjs";

assert.equal(process.platform, "darwin", "IPA builds require macOS and Xcode");
const root = fileURLToPath(new URL("..", import.meta.url));
const project = join(root, "src-tauri/gen/apple");
const version = mobileVersion(checkVersion(root).version, process.env.KURIUME_BUILD_NUMBER);
const env = { ...process.env, TAURI_ENV_PLATFORM: "ios", TAURI_IOS_PROJECT_PATH: project,
  TAURI_IOS_APP_NAME: "kuriume", IPHONEOS_DEPLOYMENT_TARGET: "16.4" };
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, env, stdio: "inherit", ...options });
const read = (command, args) => run(command, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).trim();

run("npm", ["run", "build"]);
// Tauri 2.10's IPA exporter requires Apple signing. Build the same Rust/Swift
// library directly, then let Xcode assemble a real iphoneos App without signing.
run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--target", "aarch64-apple-ios",
  "--release", "--lib", "--features", "tauri/custom-protocol", "--locked"]);
mkdirSync(join(project, "Externals/arm64/release"), { recursive: true });
mkdirSync(join(project, "assets"), { recursive: true });
copyFileSync(join(root, "src-tauri/target/aarch64-apple-ios/release/libkuriume_lib.a"), join(project, "Externals/arm64/release/libapp.a"));
mkdirSync(join(root, ".ios-build"), { recursive: true });
const staging = mkdtempSync(join(root, ".ios-build/ipa-"));
const plist = join(staging, "Info.plist");
copyFileSync(join(project, "kuriume_iOS/Info.plist"), plist);
run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleShortVersionString ${version.shortVersion}`, plist]);
run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleVersion ${version.iosBuildVersion}`, plist]);
run("xcodebuild", ["-project", join(project, "kuriume.xcodeproj"), "-scheme", "kuriume_iOS",
  "-configuration", "release", "-sdk", "iphoneos", "-destination", "generic/platform=iOS",
  "-derivedDataPath", join(root, ".ios-build/derived"), "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO",
  "CODE_SIGN_IDENTITY=", "DEVELOPMENT_TEAM=", "KURIUME_PREBUILT_IOS=1", `INFOPLIST_FILE=${plist}`, "build"]);
const app = join(root, ".ios-build/derived/Build/Products/release-iphoneos/Kuriume.app");
const info = JSON.parse(read("plutil", ["-convert", "json", "-o", "-", join(app, "Info.plist")]));
assert.equal(info.CFBundleIdentifier, "com.twac.kuriume");
assert.equal(info.CFBundleVersion, version.iosBuildVersion);
assert.equal(info.CFBundleShortVersionString, version.shortVersion);
assert.deepEqual(info.UIDeviceFamily, [1, 2], "IPA must support both iPhone and iPad");
assert(info.CFBundleSupportedPlatforms.includes("iPhoneOS"), "Refusing to package a simulator App as an IPA");
const executable = join(app, info.CFBundleExecutable);
run("xcrun", ["lipo", executable, "-verify_arch", "arm64"]);
assert.match(read("xcrun", ["vtool", "-show-build", executable]), /platform IOS\s/, "Executable must target a physical iOS device");
const payload = join(staging, "Payload");
mkdirSync(payload);
cpSync(app, join(payload, "Kuriume.app"), { recursive: true });
const output = join(root, "artifacts", `Kuriume-${version.version}-${version.buildNumber}-ios-unsigned.ipa`);
mkdirSync(join(root, "artifacts"), { recursive: true });
run("ditto", ["-c", "-k", "--keepParent", "--norsrc", payload, output]);
run("unzip", ["-tq", output]);
console.log(`Unsigned device IPA (requires re-signing to install): ${output}`);
