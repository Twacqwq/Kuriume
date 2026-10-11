import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/components/art-player-accessibility.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const moduleText = outputText.replace("@/lib/player-gestures", new URL("../src/lib/player-gestures.ts", import.meta.url).href);
const { bindPlayerAccessibility } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);

test("player controls are labeled, keyboard seeking is bounded, and buttons do not leak Space to playback hotkeys", () => {
  const element = (tagName = "DIV") => ({
    tagName, attributes: {}, dataset: {}, tabIndex: -1, clicks: 0,
    classList: { contains: () => false },
    setAttribute(name, value) { this.attributes[name] = value; },
    closest(selector) { return selector === "button, [role=button]" ? this : null; },
    querySelectorAll() { return []; },
    click() { this.clicks++; },
    focus() { this.focused = true; },
  });
  const handlers = new Map(), documentHandlers = new Map();
  const art = {
    template: { $player: element(), $progress: element(), $setting: element(), $state: element() },
    icons: { play: element("I"), pause: element("I"), volume: element("I"), volumeClose: element("I") },
    controls: { setting: element() },
    loading: { show: false }, setting: { show: false }, currentTime: 300, duration: 1400,
    on() {}, proxy(target, name, handler) { (target === globalThis.document ? documentHandlers : handlers).set(name, handler); },
  };
  art.template.$player.querySelector = (selector) => art.icons[selector.split(".art-icon-")[1]];
  const previousObserver = globalThis.MutationObserver;
  const previousDocument = globalThis.document;
  globalThis.document = element();
  let disconnected = false;
  globalThis.MutationObserver = class { observe() {} disconnect() { disconnected = true; } };
  const press = (target, key) => {
    const event = { target, key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    if (target !== globalThis.document) handlers.get("keydown")(event);
    if (!event.stopped) documentHandlers.get("keydown")?.(event);
    return event;
  };
  try {
    const cleanup = bindPlayerAccessibility(art, "en");
    assert.equal(art.icons.play.attributes["aria-label"], "Play");
    assert.equal(art.icons.play.tabIndex, 0);
    assert.equal(art.template.$progress.attributes.role, "slider");
    assert.equal(press(art.template.$progress, "ArrowRight").stopped, true);
    assert.equal(art.currentTime, 305);
    assert.equal(art.template.$progress.attributes["aria-valuenow"], "305");
    press(art.template.$progress, "End");
    press(art.template.$progress, "ArrowRight");
    assert.equal(art.currentTime, 1400);
    press(art.template.$progress, "Home");
    press(art.template.$progress, "ArrowLeft");
    assert.equal(art.currentTime, 0);
    art.duration = NaN;
    press(art.template.$progress, "ArrowRight");
    assert.equal(art.currentTime, 0);
    const custom = element("BUTTON");
    const nativeEvent = press(custom, " ");
    assert.equal(nativeEvent.stopped, true);
    assert.equal(nativeEvent.prevented, undefined, "native buttons retain their native click behavior");
    const playEvent = press(art.icons.play, " ");
    assert.equal(playEvent.prevented, true);
    assert.equal(art.icons.play.clicks, 1);
    art.setting.show = true;
    assert.equal(press(art.controls.setting, "Escape").prevented, true);
    assert.equal(art.setting.show, false);
    assert.equal(art.controls.setting.focused, true);
    art.setting.show = true;
    art.playing = true;
    const documentEscape = press(globalThis.document, "Escape");
    assert.equal(documentEscape.prevented, true, "Escape closes pointer-opened settings even when focus remains outside the player");
    assert.equal(art.setting.show, false);
    assert.equal(art.playing, true, "closing settings must not pause playback");
    assert.equal(press(globalThis.document, "Escape").prevented, undefined, "a closed menu leaves Escape to the fullscreen owner");
    cleanup();
    assert.equal(disconnected, true);
  } finally {
    globalThis.MutationObserver = previousObserver;
    globalThis.document = previousDocument;
  }
});
