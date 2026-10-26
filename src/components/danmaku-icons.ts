/**
 * The danmaku marks, shared by the player bar (as markup strings) and the
 * page's danmaku row (as path data).
 */

/** 弹 as an outline (Noto Sans CJK SC Bold, SIL OFL 1.1), its ink centred in a
 * 100×100 box: a font's ascent and descent would set it off-centre in the
 * switch knob, by a different amount in every system font. */
export const DANMAKU_GLYPH_PATH = "M42.3 5.1C45.9 10.3 50.3 17.6 52.2 22.1L62.7 16.6C60.6 12.1 56.3 5.5 52.5 0.4ZM2.9 27.9C2.9 39.3 2.4 53.7 1.5 63H20.7C19.8 78 18.8 84.3 17.2 86.1C16.1 87 15.1 87.2 13.5 87.2C11.4 87.2 6.9 87.1 2.4 86.8C4.5 90.1 6 95.3 6.2 99.1C11.3 99.4 16.2 99.3 19.1 98.8C22.6 98.4 24.8 97.4 27.2 94.6C30.3 91 31.4 80.7 32.6 56.8C32.7 55.3 32.8 52 32.8 52H13L13.5 39.3H32.9V4.7H1.3V16H20.7V27.9ZM50.3 48.3H59.8V54.6H50.3ZM72.9 48.3H82.8V54.6H72.9ZM50.3 32.8H59.8V39H50.3ZM72.9 32.8H82.8V39H72.9ZM33 70.9V82H59.8V100H72.9V82H98.7V70.9H72.9V64.5H94.9V22.9H80.5C84 17.3 87.9 10.3 91.3 3.6L78.5 0C76 7.1 71.5 16.6 67.5 22.9H38.8V64.5H59.8V70.9Z";

/** Lucide's gear, drawn small in the corner of the settings icon. */
const GEAR_PATH = "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z";

/** Danmaku settings: comment lines streaming in, with a small gear (24×24 box). */
export const DANMAKU_SETTINGS_PARTS = {
  lines: ["M3 6h13", "M7 11h7", "M3 16h5"],
  gear: GEAR_PATH,
  gearTransform: "translate(11.2 11.2) scale(.53)",
} as const;

export const DANMAKU_GLYPH_SVG = `<svg class="kuriume-danmaku-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path fill="currentColor" d="${DANMAKU_GLYPH_PATH}"/></svg>`;

export const DANMAKU_SETTINGS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${DANMAKU_SETTINGS_PARTS.lines.map((d) => `<path d="${d}"/>`).join("")}<g transform="${DANMAKU_SETTINGS_PARTS.gearTransform}" stroke-width="3.2"><path d="${GEAR_PATH}"/><circle cx="12" cy="12" r="3"/></g></svg>`;
