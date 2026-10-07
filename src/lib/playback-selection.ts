import type {
  PlaybackCandidate,
  PlaybackProviderDescriptor,
  PlaybackRoad,
  PlaybackSearch,
} from "@/lib/online-source";
import type { SourceBinding } from "@/lib/store";
import type { DirectMediaAsset, PlayableSource, PlaybackSubtitle } from "@/lib/playback";
import type { AnimeInfo } from "@/lib/types";

/** Keep valid preferences; otherwise use the registry's first provider. */
export function preferredProviderId(
  providers: readonly Pick<PlaybackProviderDescriptor, "id">[],
  preferred?: string | null,
): string | null {
  const available = new Set(providers.map((provider) => provider.id));
  if (preferred && available.has(preferred)) return preferred;
  return providers[0]?.id ?? null;
}

/** Keep localized titles even when the catalog already has a long alias list. */
export function catalogPlaybackTitles(media?: Pick<AnimeInfo, "title" | "title_en" | "title_cn" | "search_titles">) {
  return [...new Set([media?.title_en, media?.title_cn, ...(media?.search_titles ?? [])])]
    .filter((value): value is string => Boolean(value?.trim()) && value !== media?.title);
}

// Some HiAnime servers incorrectly mark every track as `en`. A recognized
// human-readable label takes precedence; array order is never a preference.
export function subtitleLanguage(track: Pick<PlaybackSubtitle, "label" | "language">): string {
  const label = track.label.toLowerCase();
  const code = (track.language ?? "").toLowerCase().replace(/_/g, "-");
  if (/chinese|中文|汉语|漢語|简体|簡體|繁体|繁體/.test(label)) {
    if (/traditional|繁体|繁體|taiwan/.test(label)) return "zh-Hant";
    if (/simplified|简体|簡體/.test(label)) return "zh-Hans";
    if (/^zh-(hant|tw|hk|mo)/.test(code)) return "zh-Hant";
    return /^zh-(hans|cn|sg)/.test(code) ? "zh-Hans" : "zh";
  }
  const names: [RegExp, string][] = [
    [/english|英语|英語/, "en"], [/japanese|日本語|日语/, "ja"],
    [/arabic|العربية/, "ar"], [/thai|ไทย/, "th"], [/french|français/, "fr"],
    [/german|deutsch/, "de"], [/italian|italiano/, "it"], [/portuguese|português/, "pt"],
    [/russian|русский/, "ru"], [/spanish|español/, "es"], [/korean|한국어/, "ko"],
    [/vietnamese|tiếng việt/, "vi"], [/indonesian/, "id"], [/malay\b/, "ms"],
  ];
  const known = names.find(([pattern]) => pattern.test(label))?.[1];
  if (known) return known;
  if (/^(zh|zho|chi|cmn)(-|$)/.test(code)) {
    return /hant|tw|hk|mo/.test(code) ? "zh-Hant" : "zh-Hans";
  }
  return code.split("-")[0];
}

export function subtitleKey(track: PlaybackSubtitle): string {
  return `${subtitleLanguage(track)}:${track.label}`;
}

/** Playback preferences are independent of the interface language. */
export function preferredSubtitle(tracks: DirectMediaAsset["subtitles"]): PlaybackSubtitle | undefined {
  return tracks?.find((track) => subtitleLanguage(track) === "zh-Hans")
    ?? tracks?.find((track) => subtitleLanguage(track) === "zh-Hant")
    ?? tracks?.find((track) => subtitleLanguage(track) === "zh");
}

/** Exhaust each transport once, without changing the work or translation. */
export function nextPlaybackSource(
  sources: readonly PlayableSource[],
  failedNames: readonly string[],
): number {
  return sources.findIndex((source) => !failedNames.includes(source.name));
}

export interface PlaybackMatchContext {
  anilistId?: number | null;
  year?: number | null;
  episodeCount?: number | null;
  episodeNumber?: number | null;
  preferencesReady?: boolean;
  preferredProviderId?: string | null;
  bindings?: readonly SourceBinding[];
}

export function playbackSearchRequest(
  query: string,
  alternativeTitles: readonly string[],
  context: PlaybackMatchContext,
  manual: boolean,
): PlaybackSearch {
  const validTitle = (title: string) => title.length > 0 && [...title].length <= 200;
  const titles = [...new Set([query, ...alternativeTitles].map((title) => title.trim()))]
    .filter(validTitle);
  // The IPC boundary accepts eight aliases of at most 200 Unicode scalars each.
  // AniList may supply dozens (including oversized translations). Optional
  // metadata must never stop an otherwise valid search before it reaches a source.
  const keyword = manual ? query.trim() : (titles[0] ?? query.trim());
  return {
    query: keyword,
    // A manual search is a correction: the catalog's mistaken identity must
    // not filter the very results the user is trying to select.
    anilistId: manual ? null : (context.anilistId ?? null),
    alternativeTitles: manual ? [] : titles.filter((title) => title !== keyword).slice(0, 8),
    year: manual ? null : (context.year ?? null),
    episodeCount: manual ? null : (context.episodeCount ?? null),
    episodeNumber: context.episodeNumber ?? null,
    limit: 20,
  };
}

export function restoredPlaybackCandidate(
  providerId: string,
  candidates: readonly PlaybackCandidate[],
  bindings: readonly SourceBinding[] = [],
): PlaybackCandidate | undefined {
  const binding = bindings.find((item) => item.source_id === providerId);
  if (!binding?.remote_media_url.trim()) return undefined;
  return (
    candidates.find(
      (candidate) => candidate.id === binding.remote_media_url,
    ) ?? {
      id: binding.remote_media_url,
      title: binding.remote_title,
      exactMatch: false,
      episodeCount: null,
      year: null,
    }
  );
}

export function initialPlaybackRoad(
  roads: readonly PlaybackRoad[],
  episodeNumber: number,
  savedIndex?: number,
  preferredRoadId?: string,
): number {
  // A retry should retain the user's current translation/line by its stable
  // ID, even if the provider reorders its response or a saved binding is old.
  const preferredIndex = preferredRoadId
    ? roads.findIndex((road) => road.id === preferredRoadId)
    : -1;
  if (preferredIndex >= 0) return preferredIndex;
  const saved = savedIndex !== undefined && Number.isInteger(savedIndex) ? roads[savedIndex] : undefined;
  if (
    saved?.episodes.some((episode) => episode.episodeNumber === episodeNumber)
  ) {
    return savedIndex!;
  }
  const original = roads.findIndex((road) => road.id === "sub" && road.episodes.some((episode) => episode.episodeNumber === episodeNumber));
  if (original >= 0) return original;
  return Math.max(
    0,
    roads.findIndex((road) =>
      road.episodes.some((episode) => episode.episodeNumber === episodeNumber),
    ),
  );
}
