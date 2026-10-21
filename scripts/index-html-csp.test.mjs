import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Tauri puts a nonce on every <style>/<script> in index.html and adds it to the
// CSP. A nonce makes the browser ignore 'unsafe-inline', which then blocks the
// <style> ArtPlayer injects at runtime and leaves the player unstyled in
// release builds (dev builds are not affected, so this is easy to miss).
test("index.html has no inline styles or scripts", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<style[\s>]/i, "move styles to a linked file in public/");
  assert.doesNotMatch(html, /\sstyle\s*=/i, "no style attributes either");
  for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/gi)) {
    assert.match(attributes, /\ssrc=/, "inline <script> blocks would get a nonce too");
  }
});
