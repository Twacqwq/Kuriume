import assert from "node:assert/strict";
import test from "node:test";
import { cssColor, layoutDanmaku, visibleAt } from "../src/lib/danmaku-layout.ts";
import { bangumiSubject, defaultPrefs, fontPixels, formatCount, readPrefs, readWork, writePrefs, writeWork } from "../src/lib/danmaku.ts";

const options = (overrides = {}) => ({
  width: 800, height: 300, lineHeight: 30, area: 1, scrollSeconds: 8, fixedSeconds: 4, gap: 20,
  hidden: { scroll: false, top: false, bottom: false, color: false },
  measure: (text) => text.length * 20, ...overrides,
});
const comment = (time, text = "弹幕", mode = "scroll", color = 0xffffff) => ({ time, mode, color, text });

test("a lane takes the next scrolling comment once the previous one has fully entered", () => {
  // 800 px in 8 s: 100 px/s. "弹幕" is 40 px wide, plus a 20 px gap: 0.6 s.
  const { placed, speed } = layoutDanmaku([comment(0), comment(0.3), comment(0.7)], options());
  assert.equal(speed, 100);
  assert.deepEqual(placed.map((item) => item.lane), [0, 1, 0]);
  assert.equal(placed[0].duration, 8.4);
});

test("comments without a free lane are dropped, and hidden kinds never placed", () => {
  const crowd = Array.from({ length: 30 }, () => comment(1));
  assert.equal(layoutDanmaku(crowd, options()).placed.length, 10, "300 px / 30 px lanes");
  assert.equal(layoutDanmaku(crowd, options({ area: 0.5 })).placed.length, 5);
  const mixed = [comment(1, "a", "top"), comment(1, "b", "bottom"), comment(1, "c", "scroll", 0xff0000)];
  const hidden = layoutDanmaku(mixed, options({ hidden: { scroll: false, top: true, bottom: false, color: true } }));
  assert.deepEqual(hidden.placed.map((item) => item.comment.text), ["b"]);
});

test("any moment draws the same picture: positions come from the clock alone", () => {
  const layout = layoutDanmaku([comment(10), comment(11, "顶部", "top"), comment(11, "底部", "bottom")], options());
  const size = { width: 800, height: 300, lineHeight: 30 };
  assert.deepEqual(visibleAt(layout, 9.9, size), []);
  const at = visibleAt(layout, 12, size);
  assert.equal(at.length, 3);
  assert.equal(at[0].x, 600, "scrolled 2 s at 100 px/s");
  assert.deepEqual([at[1].x, at[1].y], [380, 0], "top comments centre at the top");
  assert.deepEqual([at[2].x, at[2].y], [380, 270], "bottom comments sit on the bottom edge");
  assert.equal(visibleAt(layout, 15.5, size).length, 1, "fixed comments last 4 s");
  assert.equal(visibleAt(layout, 18.5, size).length, 0, "the scroller has left after 8.4 s");
  assert.equal(cssColor(0xff0000), "#ff0000");
  assert.equal(cssColor(255), "#0000ff");
});

test("preferences and per-work state survive bad storage", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.deepEqual(readPrefs(storage), defaultPrefs());
  // Off by default; once on, light: half screen, small text, 50% opacity.
  assert.deepEqual([defaultPrefs().enabled, defaultPrefs().area, defaultPrefs().fontSize, defaultPrefs().opacity], [false, 0.5, "small", 0.5]);
  writePrefs(storage, { ...defaultPrefs(), enabled: true, opacity: 0.8 });
  assert.equal(readPrefs(storage).enabled, true);
  assert.equal(readPrefs(storage).opacity, 0.8);
  store.set("kuriume:danmaku:v3", JSON.stringify({ opacity: 7, fontSize: "huge", area: 0.3 }));
  assert.deepEqual(readPrefs(storage), defaultPrefs(), "invalid values fall back");
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readPrefs(throwing), defaultPrefs());
  assert.doesNotThrow(() => writeWork(throwing, "anilist:1", { offset: 1 }));
  writeWork(storage, "anilist:154587", { animeId: 17617, offset: -1.5 });
  assert.deepEqual(readWork(storage, "anilist:154587"), { animeId: 17617, offset: -1.5 });
  assert.deepEqual(readWork(storage, "anilist:1"), { animeId: undefined, offset: undefined });
  assert.equal(bangumiSubject("bangumi:400602"), 400602);
  assert.equal(bangumiSubject("anilist:154587"), null);
  assert.equal(formatCount(12_345, true), "1.2万");
  assert.equal(formatCount(1_234, true), "1,234");
  assert.equal(fontPixels("medium", 600), 22);
  assert.equal(fontPixels("medium", 200), 15, "small players shrink the text, within bounds");
});
