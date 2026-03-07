export interface AnimeInfo {
  id: string;
  title: string;
  title_cn: string;
  cover: string | null;
  score: number | null;
  year: number | null;
  total_episodes: number;
  genres: string[];
  description: string | null;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
