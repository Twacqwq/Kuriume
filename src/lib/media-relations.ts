import { mediaKind, type AnimeInfo, type MediaKind, type RelatedMedia } from "@/lib/types";

/** "14 卷 · 140 话" for a manga, when the catalog knows either. */
export function mangaLength(media: AnimeInfo, language: "en" | "zh"): string | null {
  const parts = [
    media.volumes ? (language === "zh" ? `${media.volumes} 卷` : `${media.volumes} volumes`) : null,
    media.chapters ? (language === "zh" ? `${media.chapters} 话` : `${media.chapters} chapters`) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Order: the other medium (original manga, anime adaptation), then the story's neighbours. */
const RELATION_ORDER = ["SOURCE", "ADAPTATION", "PREQUEL", "SEQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "OTHER"];
const RELATED_LIMIT = 12;

export function sortRelations(relations: RelatedMedia[], kind: MediaKind): RelatedMedia[] {
  const rank = (item: RelatedMedia) => (mediaKind(item.media) !== kind ? 0 : 1) * 100 + RELATION_ORDER.indexOf(item.relation);
  return [...relations].sort((a, b) => rank(a) - rank(b)).slice(0, RELATED_LIMIT);
}

export function relationLabel(item: RelatedMedia, language: "en" | "zh"): string {
  const other = mediaKind(item.media);
  const zh: Record<string, string> = {
    SOURCE: "原作",
    ADAPTATION: other === "anime" ? "动画化" : "漫画化",
    SEQUEL: "续集",
    PREQUEL: "前传",
    SIDE_STORY: "外传",
    SPIN_OFF: "衍生",
    ALTERNATIVE: "其他版本",
    OTHER: "相关",
  };
  const en: Record<string, string> = {
    SOURCE: "Source",
    ADAPTATION: other === "anime" ? "Anime" : "Manga",
    SEQUEL: "Sequel",
    PREQUEL: "Prequel",
    SIDE_STORY: "Side story",
    SPIN_OFF: "Spin-off",
    ALTERNATIVE: "Alternative",
    OTHER: "Related",
  };
  return (language === "zh" ? zh : en)[item.relation] ?? item.relation;
}

