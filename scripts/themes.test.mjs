import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_THEME, THEMES } from "../src/lib/theme.ts";

const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
const splash = await readFile(new URL("../public/splash.css", import.meta.url), "utf8");
const block = (selector) => css.match(new RegExp(`${selector.replace(/[[\]"=]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
const tokens = (body) => new Set([...body.matchAll(/--([a-z-]+):/g)].map((match) => match[1]));
const value = (body, name) => body.match(new RegExp(`--${name}: ([^;]+);`))?.[1].trim();

// Hex colours only; the WCAG contrast of two of them.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("every built-in theme defines the full colour set, with readable text", () => {
  const base = block(":root");
  const required = [...tokens(base)].filter((name) => !["radius", "destructive", "destructive-readable"].includes(name));
  assert.equal(DEFAULT_THEME, THEMES[0].id);
  for (const theme of THEMES.slice(1)) {
    const body = block(`:root[data-theme="${theme.id}"]`);
    assert.ok(body, `${theme.id} has a block in main.css`);
    for (const name of required) assert.ok(tokens(body).has(name), `${theme.id} sets --${name}`);
    assert.equal(value(body, "primary"), theme.primary, `${theme.id} swatch matches its CSS`);
    assert.equal(value(body, "background"), theme.background);
    assert.match(splash, new RegExp(`data-theme="${theme.id}"`), `${theme.id} has a splash colour`);
  }
  for (const theme of THEMES) {
    const body = theme.id === DEFAULT_THEME ? base : block(`:root[data-theme="${theme.id}"]`);
    const get = (name) => value(body, name);
    assert.ok(contrast(get("foreground"), get("background")) >= 7, `${theme.id} body text`);
    assert.ok(contrast(get("muted-foreground"), get("card")) >= 4.5, `${theme.id} muted text on cards`);
    assert.ok(contrast(get("primary-readable"), get("card")) >= 4.5, `${theme.id} accent text on cards`);
    assert.ok(contrast(get("primary-foreground"), get("primary")) >= 4.5, `${theme.id} button text`);
    assert.ok(contrast(get("highlight-foreground"), get("highlight")) >= 4.5, `${theme.id} reminder badge`);
    assert.ok(contrast(get("primary-strong"), "#000000") >= 4.5, `${theme.id} player accent over video`);
  }
});
