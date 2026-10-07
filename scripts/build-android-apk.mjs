import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersion } from "./check-version.mjs";
import { mobileVersion } from "./mobile-version.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = mobileVersion(checkVersion(root).version, process.env.KURIUME_BUILD_NUMBER);
const keys = ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
let signing = process.env;
if (!keys.some((key) => process.env[key])) {
  try { signing = JSON.parse(readFileSync(join(root, ".local/android-signing/credentials.json"), "utf8")); }
  catch { throw new Error("Configure Android signing environment variables or run npm run android:keygen first. See CONTRIBUTING.md."); }
}
for (const key of keys) assert(signing[key], `Missing ${key}; refusing to produce an unsigned/debug APK`);
assert(process.env.ANDROID_HOME, "Set ANDROID_HOME to your Android SDK");
const env = { ...process.env, ...Object.fromEntries(keys.map((key) => [key, signing[key]])) };
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, env, stdio: "inherit", ...options });
const read = (command, args) => run(command, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
run("npm", ["run", "tauri", "--", "android", "build", "--apk", "--target", "aarch64", "--ci", "--config",
  JSON.stringify({ bundle: { android: { versionCode: version.buildNumber } } })]);
const apk = join(root, "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk");
const buildTools = join(process.env.ANDROID_HOME, "build-tools/36.0.0");
run(join(buildTools, "apksigner"), ["verify", "--verbose", "--print-certs", apk]);
run(join(buildTools, "zipalign"), ["-c", "-P", "16", "4", apk]);
const info = read(join(buildTools, "aapt2"), ["dump", "badging", apk]);
assert.match(info, /package: name='com\.twac\.kuriume'/);
assert(info.includes(`versionCode='${version.buildNumber}'`) && info.includes(`versionName='${version.version}'`), "APK version mismatch");
assert.match(info, /native-code: 'arm64-v8a'/);
assert(!info.includes("application-debuggable"), "Refusing to distribute a debuggable APK");
mkdirSync(join(root, "artifacts"), { recursive: true });
const output = join(root, "artifacts", `Kuriume-${version.version}-${version.buildNumber}-android-arm64.apk`);
copyFileSync(apk, output);
console.log(`Verified signed APK: ${output}`);
