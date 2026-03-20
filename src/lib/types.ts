export interface AnimeInfo {
  id: string;
  title: string;
  title_cn: string;
  cover: string | null;
  score: number | null;
  year: number | null;
  total_episodes: number;
  air_date: string | null;
  genres: string[];
  description: string | null;
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
