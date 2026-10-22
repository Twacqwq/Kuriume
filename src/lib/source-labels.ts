/**
 * How playback choices are named on screen. Sites label their lines with
 * whatever they like (CDN brands, "暴风云", "量子"...); Kuriume numbers them
 * instead, so every source, built-in or imported, reads the same way. Source
 * names themselves come from the site's domain (see `source_name` in Rust).
 */

/** HiAnime's two "lines" are audio versions, which is worth saying. */
const AUDIO_ROADS: Record<string, { zh: string; en: string }> = {
  sub: { zh: "原声 · Sub", en: "Original · Sub" },
  dub: { zh: "配音 · Dub", en: "Dubbed · Dub" },
};

/** A source's line (translation or server): 线路 1, 线路 2… */
export function roadLabel(providerId: string | null | undefined, roadId: string | undefined, index: number, zh: boolean): string {
  const audio = providerId === "builtin:hianime" && roadId ? AUDIO_ROADS[roadId] : undefined;
  if (audio) return zh ? audio.zh : audio.en;
  return zh ? `线路 ${index + 1}` : `Server ${index + 1}`;
}

/** One playable stream of an episode on a line: 节点 1, 节点 2… */
export function streamLabel(index: number, zh: boolean): string {
  return zh ? `节点 ${index + 1}` : `Mirror ${index + 1}`;
}
