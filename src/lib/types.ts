export interface AnimeInfo {
  id: string;
  anilist_id: number;
  mal_id: number | null;
  title: string;
  title_en: string;
  title_cn: string | null;
  title_native: string | null;
  search_titles: string[];
  cover: string | null;
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
