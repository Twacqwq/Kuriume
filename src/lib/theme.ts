/**
 * Built-in colour themes. The tokens live in main.css under
 * `:root[data-theme=…]`; 深栗 is the default `:root` set. The choice is kept
 * per device and applied by public/splash.js before the first paint, so the
 * app never flashes the default palette.
 */
export const THEMES = [
  { id: "chestnut", zh: "深栗", en: "Chestnut", background: "#141112", card: "#1e1a1a", primary: "#a4534a", highlight: "#c8a36c" },
  { id: "yozakura", zh: "夜桜", en: "Night sakura", background: "#121018", card: "#1c1924", primary: "#ad4f6b", highlight: "#d9b66e" },
  { id: "gunjo", zh: "群青", en: "Ultramarine", background: "#0f1218", card: "#181d25", primary: "#3d6bb0", highlight: "#e2a65e" },
  { id: "wakatake", zh: "若竹", en: "Young bamboo", background: "#10140f", card: "#191e18", primary: "#437a52", highlight: "#d9b45c" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "chestnut";
/** Also read by public/splash.js; keep the two in step. */
export const THEME_KEY = "kuriume:theme";

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return isThemeId(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const listeners = new Set<() => void>();

export function applyTheme(id: ThemeId, doc: Document = document) {
  const theme = THEMES.find((item) => item.id === id) ?? THEMES[0];
  doc.documentElement.dataset.theme = theme.id;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.background);
}

export function setTheme(id: ThemeId) {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* applies for this session only */ }
  applyTheme(id);
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current theme's primary colour, for code that needs a literal value. */
export function themePrimary(doc: Document = document): string {
  const value = getComputedStyle(doc.documentElement).getPropertyValue("--primary").trim();
  return value || THEMES[0].primary;
}
