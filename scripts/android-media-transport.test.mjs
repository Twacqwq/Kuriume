import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Windows checkouts use CRLF line endings.
const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

// wry 0.54 on Android serves every custom-scheme request behind one lock and
// aborts the app when a response takes over 10 s, so media must not use it.
test("Android plays media from the loopback server, not the WebView custom scheme", async () => {
  const proxy = await read("src-tauri/src/media_proxy.rs");
  assert.match(proxy, /#\[cfg\(any\(target_os = "macos", target_os = "ios", target_os = "android"\)\)\]\nmod loopback;/);
  assert.match(proxy, /#\[cfg\(any\(target_os = "ios", target_os = "android"\)\)\]\n\s*let local_base = format!\("http:\/\/\{\}\/\{token\}", self\.loopback_address\(\)\?\);/);
  const manifest = await read("src-tauri/Cargo.toml");
  assert.match(manifest, /\[target\.'cfg\(any\(target_os = "macos", target_os = "ios", target_os = "android"\)\)'\.dependencies\]\nhyper/);
  const network = await read("src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml");
  assert.match(network, /<domain-config cleartextTrafficPermitted="true">[\s\S]*<domain includeSubdomains="false">127\.0\.0\.1<\/domain>[\s\S]*<\/domain-config>/);
  const app = await read("src-tauri/src/lib.rs");
  assert.match(app, /any\(target_os = "macos", target_os = "ios", target_os = "android"\)\s*\)\)\]\s*app\.state::<MediaProxyState>\(\)\s*\.set_dev_origin/);
});

test("a custom-scheme media response on Android ends before the WebView's 10 s abort", async () => {
  const proxy = await read("src-tauri/src/media_proxy.rs");
  const deadline = /const CUSTOM_SCHEME_DEADLINE: std::time::Duration = std::time::Duration::from_secs\((\d+)\);/.exec(proxy);
  assert.ok(deadline, "deadline constant");
  assert.ok(Number(deadline[1]) < 10);
  assert.match(proxy, /tokio::time::timeout\(CUSTOM_SCHEME_DEADLINE, proxy\.response\(request\)\)/);
});
