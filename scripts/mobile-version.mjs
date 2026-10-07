import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseVersion } from "./check-version.mjs";

// One UTC-minute build number for both platforms, independent of workflow counters.
// Rebuilding within the same minute retains the same number; APK replacement is allowed.
export function mobileVersion(version, number = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60000)) {
  releaseVersion(version);
  const buildNumber = Number(number);
  assert(Number.isInteger(buildNumber) && buildNumber >= 10000 && buildNumber <= 99999999,
    "KURIUME_BUILD_NUMBER must be an integer between 10000 and 99999999");
  return {
    version,
    buildNumber,
    shortVersion: version.split("-")[0],
    // Apple permits up to 4/2/2 digits in CFBundleVersion.
    iosBuildVersion: `${Math.floor(buildNumber / 10000)}.${Math.floor(buildNumber / 100) % 100}.${buildNumber % 100}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const result = mobileVersion(version, process.env.KURIUME_BUILD_NUMBER);
  console.log(`version=${result.version}\nbuild_number=${result.buildNumber}\nios_build_version=${result.iosBuildVersion}`);
}
