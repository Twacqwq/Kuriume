import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UI fonts are bundled locally with licenses and real variable weights", async () => {
  const css = await readFile(new URL("../src/fonts.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /https?:\/\//);
  for (const [font, license, weights] of [
    ["manrope-vf.woff2", "Manrope-OFL.txt", "200 800"],
    ["noto-sans-sc-vf.woff2", "NotoSansSC-OFL.txt", "100 900"],
  ]) {
    const data = await readFile(new URL(`../public/fonts/${font}`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), "wOF2");
    assert.equal(data.readUInt32BE(8), data.length);
    assert.ok(css.includes(`/fonts/${font}`));
    assert.ok(css.includes(`font-weight: ${weights}`));
    const notice = await readFile(new URL(`../public/fonts/${license}`, import.meta.url), "utf8");
    assert.match(notice, /Copyright/);
    assert.match(notice, /SIL OPEN FONT LICENSE Version 1.1/);
  }
  assert.equal((css.match(/font-display: swap/g) ?? []).length, 2);
  const theme = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(theme, /@import "\.\/fonts\.css"/);
  assert.match(theme, /--font-sans: "Manrope", "Noto Sans SC"/);
  assert.match(theme, /@apply m-0 font-sans/);
});
