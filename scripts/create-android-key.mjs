import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../.local/android-signing", import.meta.url));
const keystore = join(directory, "kuriume-release.p12");
const credentials = join(directory, "credentials.json");
assert(!existsSync(keystore) && !existsSync(credentials), "Signing files already exist. Reuse and back them up; do not regenerate the app identity.");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString("base64url");
const config = { ANDROID_KEYSTORE_PATH: keystore, ANDROID_KEYSTORE_PASSWORD: password,
  ANDROID_KEY_ALIAS: "kuriume", ANDROID_KEY_PASSWORD: password };
// Save recovery information before invoking keytool; never print private material.
writeFileSync(credentials, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/keytool") : "keytool";
execFileSync(keytool, ["-genkeypair", "-noprompt", "-keystore", keystore, "-storetype", "PKCS12",
  "-alias", config.ANDROID_KEY_ALIAS, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
  "-dname", "CN=Kuriume, O=Kuriume", "-storepass:env", "ANDROID_KEYSTORE_PASSWORD", "-keypass:env", "ANDROID_KEY_PASSWORD"],
{ env: { ...process.env, ...config }, stdio: "inherit" });
chmodSync(keystore, 0o600);
console.log(`Private signing files saved to ${directory}. Back up this directory privately; it is not committed.`);
