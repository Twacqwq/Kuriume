/**
 * Turns AniList's dominant cover colour into a tint that sits quietly on the
 * dark canvas: hue kept, saturation and lightness pulled into a narrow band so
 * a neon cover cannot flood the page; grey covers return null.
 * Returns space-separated RGB channels for `rgb(var(--cover-tone) / a)`.
 */
export function coverTone(hex: string | null | undefined): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  hue = (hue * 60 + 360) % 360;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  // A grey or near-black cover has no hue worth carrying; keep the app tint.
  if (saturation < 0.08 || light < 0.06 || light > 0.96) return null;
  return hslChannels(hue, Math.min(Math.max(saturation, 0.2), 0.5), Math.min(Math.max(light, 0.34), 0.44));
}

function hslChannels(hue: number, saturation: number, light: number): string {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
      : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r, g, b].map((c) => Math.round((c + m) * 255)).join(" ");
}
