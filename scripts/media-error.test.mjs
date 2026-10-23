import assert from "node:assert/strict";
import test from "node:test";
import { isProxiedMedia } from "../src/lib/media-url.ts";
import { playbackErrorMessage } from "../src/lib/playback-error.ts";

test("only proxied media is loaded in CORS mode", () => {
  for (const url of ["kuriume-media://localhost/abc", "http://kuriume-media.localhost/abc", "http://127.0.0.1:45678/abc"]) {
    assert.equal(isProxiedMedia(url), true, url);
  }
  for (const url of ["https://cdn.example/video.mp4", "http://127.0.0.1.example.com/x", "https://kuriume-media.localhost.evil/x"]) {
    assert.equal(isProxiedMedia(url), false, url);
  }
});

test("an unsupported format gets a plain explanation", () => {
  assert.match(playbackErrorMessage("Media error 4"), /不支持这个视频格式/);
  assert.match(playbackErrorMessage("MEDIA_ELEMENT_ERROR: Format error"), /不支持这个视频格式/);
  assert.match(playbackErrorMessage("Media error 3"), /无法解码/);
  assert.match(playbackErrorMessage("No supported media found on this source"), /没有可用视频/);
});
