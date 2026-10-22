import assert from "node:assert/strict";
import test from "node:test";
import { playerGesture, gestureTime } from "../src/lib/player-gestures.ts";

const start = { x: 100, y: 100, width: 400, height: 240, position: 300, duration: 1440, volume: 0.5, brightness: 0.5 };
test("player gestures distinguish axes, preserve direction and bound values", () => {
  assert.equal(playerGesture({ ...start, x: 12 }), null);
  assert.equal(playerGesture({ ...start, x: 389 }), null);
  const seek = playerGesture(start);
  assert.equal(seek(106, 100), null);
  assert.equal(seek(115, 115), null);
  assert.equal(seek(120, 104), null, "a double tap's jitter is not a swipe");
  assert.equal(seek(140, 130), null, "diagonal movement is not a seek");
  assert.deepEqual(seek(228, 100), { kind: "seek", value: 330 }, "measured from where the swipe was recognised");
  assert.deepEqual(seek(228, 0), { kind: "seek", value: 330 });
  assert.equal(playerGesture({ ...start, slop: 2 })(150, 100), null, "a higher slop needs more travel");
  assert.deepEqual(playerGesture(start)(100, -200), { kind: "brightness", value: 1 });
  assert.deepEqual(playerGesture(start)(100, 500), { kind: "brightness", value: 0.05 });
  assert.deepEqual(playerGesture({ ...start, x: 300 })(300, 500), { kind: "volume", value: 0 });
  assert.equal(playerGesture({ ...start, duration: Infinity })(200, 100), null);
  assert.equal(playerGesture({ ...start, position: 0 })(-400, 100).value, 0);
  assert.deepEqual(playerGesture(start)(100, 100 - 20 - 96), { kind: "brightness", value: 1 });
  assert.equal(playerGesture({ ...start, position: 1430 })(500, 100).value, 1439.9);
  assert.equal(gestureTime(125.5), "2:05");
});
