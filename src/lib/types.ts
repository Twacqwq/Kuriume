/** Catalog entries are anime or manga; IDs alone open either. */
export type MediaKind = "anime" | "manga";

export interface AnimeInfo {
  id: string;
  /** Absent from entries cached before manga existed: anime. */
  kind?: MediaKind;
  anilist_id: number;
  mal_id: number | null;
  title: string;
  title_en: string;
  title_cn: string | null;
  title_native: string | null;
  search_titles: string[];
  cover: string | null;
  /** AniList dominant cover colour (#rrggbb). */
  cover_color?: string | null;
  banner: string | null;
  score: number | null;
  year: number | null;
  total_episodes: number;
  air_date: string | null;
  genres: string[];
  description: string | null;
  description_cn: string | null;
  description_ja: string | null;
  status: string | null;
  format: string | null;
  studios: string[];
  /** Next scheduled broadcast while airing (Unix seconds). */
  next_airing?: AiringSlot | null;
  /** Episodes already broadcast, when known. */
  aired_episodes?: number | null;
  /** Calendar entries only: the broadcast this entry stands for. */
  schedule?: AiringSlot | null;
  /** Manga: published chapters / volumes, when known. */
  chapters?: number | null;
  volumes?: number | null;
  /** Manga: writers and artists. */
  authors?: string[];
}

export function mediaKind(media: Pick<AnimeInfo, "kind">): MediaKind {
  return media.kind === "manga" ? "manga" : "anime";
}

/** How a related work stands to the page's work (`SOURCE`: its original). */
export type RelationKind = "SOURCE" | "ADAPTATION" | "SEQUEL" | "PREQUEL" | "SIDE_STORY" | "SPIN_OFF" | "ALTERNATIVE" | "OTHER";

export interface RelatedMedia {
  relation: RelationKind;
  media: AnimeInfo;
}

export interface AiringSlot {
  episode: number;
  airing_at: number;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AnimeEpisodes {
  id: string;
  ep: number;
  airdate: string;
  title?: string;
  title_cn?: string;
  duration?: string;
  summary?: string;
  thumbnail?: string;
  progress?: number;
}

export interface AnimeCharacters {
  id: number;
  name: string;
  role: string;
  avatar: string;
  cvs: string[];
}

export interface CalendarEntry {
  weekday: { id: number; cn: string };
  items: AnimeInfo[];
}
