import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const navigations = [];
const router = { useNavigate: () => (value) => navigations.push(value) };
// Exercise the actual component handler without installing a DOM test framework.
globalThis.__searchInputTestRouter = router;
const imports = {
  "@tanstack/react-router": moduleUrl("export const useNavigate = globalThis.__searchInputTestRouter.useNavigate"),
  "lucide-react": moduleUrl("export const Search = () => null; export const X = () => null"),
  "@/components/ui/dialog": moduleUrl("export const Dialog = () => null; export const DialogContent = () => null; export const DialogTitle = () => null;"),
  "@/hooks/use-display-language": moduleUrl("export const useDisplayLanguage = () => 'zh'"),
  "react": moduleUrl(`export const useState = () => ["葬送的芙莉莲", () => {}];
    export const useRef = () => ({current: null}); export const useEffect = () => {};`),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
};
const source = await readFile(new URL("../src/components/search-panel.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020, jsx: ts.JsxEmit.ReactJSX },
});
const compiled = outputText.replace(/from "([^"]+)"/g, (_, name) => `from "${imports[name]}"`);
const { SearchPanel } = await import(moduleUrl(compiled));
delete globalThis.__searchInputTestRouter;

function findElement(element, type) {
  if (element?.type === type) return element;
  return [element?.props?.children].flat().filter(Boolean).map((child) => findElement(child, type)).find(Boolean);
}

test("IME confirmation never submits or closes search; a subsequent Enter submits Chinese intact", () => {
  let closed = 0;
  let prevented = 0;
  const input = findElement(SearchPanel({ open: true, onClose: () => closed++ }), "input");
  const key = (key, isComposing, keyCode) => input.props.onKeyDown({
    key, nativeEvent: { isComposing, keyCode }, preventDefault: () => prevented++,
  });
  key("Enter", true, 13);
  key("Enter", false, 229); // Safari's composition-confirming Enter.
  key("Escape", true, 229);
  assert.equal(closed, 0);
  assert.equal(prevented, 0);
  assert.equal(navigations.length, 0);
  key("Enter", false, 13);
  assert.equal(closed, 1);
  assert.deepEqual(navigations, [{ to: "/search", search: { q: "葬送的芙莉莲" } }]);
});

test("mobile form submit ignores IME confirmation but accepts the next keyboard search", async () => {
  navigations.length = 0;
  let closed = 0;
  const panel = SearchPanel({ open: true, onClose: () => closed++ });
  const input = findElement(panel, "input");
  const form = findElement(panel, "form");
  const submit = () => form.props.onSubmit({ preventDefault() {} });
  input.props.onCompositionStart();
  submit();
  assert.equal(closed, 0);
  input.props.onCompositionEnd();
  input.props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 229 } });
  submit();
  assert.equal(closed, 0);
  assert.equal(navigations.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  submit(); // Mobile search actions need not produce a desktop-style keydown.
  assert.equal(closed, 1);
  assert.deepEqual(navigations, [{ to: "/search", search: { q: "葬送的芙莉莲" } }]);
});

test("search is a results-only route: empty legacy URLs return home without adding history", async () => {
  const routeImports = {
    "@tanstack/react-router": import.meta.resolve("@tanstack/react-router"),
    "@/components/anime-grid": moduleUrl("export const AnimeGrid = () => null"),
    "@/hooks/use-display-language": moduleUrl("export const useDisplayLanguage = () => 'zh'"),
    "@tauri-apps/api/core": moduleUrl("export const invoke = () => { throw new Error('Unexpected search request'); }"),
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  };
  const source = await readFile(new URL("../src/routes/search.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const compiled = outputText.replace(/from "([^"]+)"/g, (_, name) => `from "${routeImports[name]}"`);
  const { Route } = await import(moduleUrl(compiled));
  const { validateSearch, beforeLoad } = Route.options;
  for (const q of [undefined, "", "   ", "　", null, 123]) {
    const search = validateSearch({ q });
    assert.equal(search.q, undefined);
    assert.throws(() => beforeLoad({ search }), (error) => error.options?.to === "/" && error.options?.replace === true);
  }
  const search = validateSearch({ q: "  葬送的芙莉莲  " });
  assert.equal(search.q, "葬送的芙莉莲");
  assert.doesNotThrow(() => beforeLoad({ search }));
});
