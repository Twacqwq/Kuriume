import type { DisplayLanguage } from "@/lib/store";
import type { AnimeEpisodes, AnimeInfo } from "@/lib/types";

export function displayAnimeTitle(
  media: AnimeInfo,
  language: DisplayLanguage,
): string {
  if (language === "zh") {
    return media.title_cn?.trim() || media.title_native?.trim() || media.title_en || media.title;
  }
  return media.title_en || media.title;
}

export function displayAnimeDescription(
  media: AnimeInfo,
  language: DisplayLanguage,
): string | null {
  return language === "zh"
    ? media.description_cn?.trim() || media.description_ja?.trim() || media.description || null
    : media.description;
}

export function displayEpisodeTitle(
  episode: AnimeEpisodes | undefined,
  episodeNumber: number,
  language: DisplayLanguage,
): string {
  if (language === "zh") {
    return episode?.title_cn || `第 ${episodeNumber} 话`;
  }
  return episode?.title || `Episode ${episodeNumber}`;
}
