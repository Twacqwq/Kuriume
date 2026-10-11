import { Button } from "@/components/ui/button";
import { LibraryControl } from "@/components/library-control";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import {
  displayAnimeDescription,
  displayAnimeTitle,
  displayEpisodeTitle,
} from "@/lib/display-language";
import type {
  LibraryEntry,
  LibraryStatus,
  WatchHistoryEntry,
} from "@/lib/store";
import type {
  AnimeCharacters,
  AnimeEpisodes,
  AnimeInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Clock3,
  Play,
  Star,
} from "lucide-react";

interface MediaDetailProps {
  media: AnimeInfo;
  episodes: AnimeEpisodes[];
  characters: AnimeCharacters[];
  libraryEntry: LibraryEntry | null;
  libraryPending: boolean;
  libraryError: string | null;
  history: WatchHistoryEntry[];
  onBack: () => void;
  onSetLibraryStatus: (status: LibraryStatus) => void;
  onRemoveFromLibrary: () => void;
}

export function MediaDetail({
  media,
  episodes,
  characters,
  libraryEntry,
  libraryPending,
  libraryError,
  history,
  onBack,
  onSetLibraryStatus,
  onRemoveFromLibrary,
}: MediaDetailProps) {
  const language = useDisplayLanguage();
  const title = displayAnimeTitle(media, language);
  const description = displayAnimeDescription(media, language);
  const latest = history
    .filter(
      (entry) =>
        entry.provider === "anilist" &&
        entry.external_id === String(media.anilist_id),
    )
    .sort(
      (a, b) =>
        new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime(),
    )[0];
  const latestComplete =
    latest && latest.duration > 0 && latest.position / latest.duration >= 0.92;
  const playEpisode = latest
    ? Math.min(
        latest.episode + (latestComplete ? 1 : 0),
        Math.max(media.total_episodes, 1),
      )
    : 1;
  const playLabel = latest
    ? latestComplete
      ? (language === "zh" ? `播放第 ${playEpisode} 话` : `Play episode ${playEpisode}`)
      : (language === "zh" ? `继续第 ${playEpisode} 话` : `Resume episode ${playEpisode}`)
    : (language === "zh" ? "播放第 1 话" : "Play episode 1");
  const resumeTime =
    latest && !latestComplete && playEpisode === latest.episode
      ? latest.position
      : undefined;

  return (
    <div className="media-detail min-h-full pb-10 md:pb-16">
      <section className="relative overflow-hidden">
        <HeroArtwork media={media} />
        <div className="absolute left-4 top-4 z-20 md:left-8 md:top-10">
          <button
            type="button"
            onClick={onBack}
            className="grid size-12 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-primary-readable motion-reduce:transition-none"
            aria-label={language === "zh" ? "返回首页" : "Back to home"}
            title={language === "zh" ? "返回首页" : "Back to home"}
          >
            <ArrowLeft size={18} />
          </button>
        </div>

        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-[5.5rem_minmax(0,1fr)] items-end gap-x-4 gap-y-5 px-4 pb-6 pt-24 md:grid-cols-[8rem_minmax(0,1fr)] md:gap-x-7 md:px-6 md:pb-9 md:pt-28 lg:min-h-[460px] lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-x-9 lg:px-10">
          <div className="self-end overflow-hidden rounded-xl bg-card shadow-[0_16px_36px_-16px_rgba(0,0,0,0.7)] lg:row-span-2">
            {media.cover && (
              <img
                src={media.cover}
                alt=""
                decoding="async"
                className="aspect-2/3 w-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-white/75">
              {media.format && <MetaPill>{formatMediaFormat(media.format, language)}</MetaPill>}
              {media.year && <span>{media.year}</span>}
              {media.total_episodes > 0 && (
                <>
                  <span className="text-white/25">·</span>
                  <span>{language === "zh" ? `${media.total_episodes} 话` : `${media.total_episodes} episodes`}</span>
                </>
              )}
              {media.score && (
                <>
                  <span className="text-white/25">·</span>
                  <span className="inline-flex items-center gap-1 text-[#d9b56d]">
                    <Star size={12} fill="currentColor" />
                    {media.score.toFixed(1)}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-balance text-2xl font-bold leading-tight tracking-[-0.025em] text-white [overflow-wrap:anywhere] md:text-4xl xl:text-5xl">
              {title}
            </h1>
          </div>
          <div className="col-span-2 lg:col-span-1 lg:col-start-2">
            <div className="flex flex-wrap items-center gap-3 [&>button]:min-h-12 [&>button]:rounded-xl">
              <Button asChild size="lg" className="min-h-12 flex-1 gap-2 rounded-xl px-5 sm:flex-none">
                <Link
                  to="/anime/$id/episode/$ep"
                  params={{ id: media.id, ep: String(playEpisode) }}
                  search={{ t: resumeTime }}
                >
                  <Play size={17} fill="currentColor" />
                  {playLabel}
                </Link>
              </Button>
              <LibraryControl
                entry={libraryEntry}
                disabled={libraryPending}
                onSetStatus={onSetLibraryStatus}
                onRemove={onRemoveFromLibrary}
              />
            </div>
            {libraryError && <p role="alert" className="mt-3 text-sm text-destructive-readable">{libraryError}</p>}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-4 pt-5 md:space-y-12 md:px-6 md:pt-8 lg:px-10">
        {description && (
          <section className="max-w-3xl" aria-labelledby="anime-synopsis">
            <h2 id="anime-synopsis" className="mb-3 text-lg font-bold tracking-tight">{language === "zh" ? "简介" : "Synopsis"}</h2>
            {description.length > 220 ? (
              <details className="group">
                <summary className="cursor-pointer list-none rounded-lg text-sm leading-7 text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary-readable [&::-webkit-details-marker]:hidden">
                  <span className="line-clamp-3 group-open:hidden">{description}</span>
                  <span className="inline-flex min-h-11 items-center font-medium text-primary-readable group-open:hidden">{language === "zh" ? "展开简介" : "Read more"}</span>
                  <span className="hidden min-h-11 items-center font-medium text-primary-readable group-open:inline-flex">{language === "zh" ? "收起简介" : "Show less"}</span>
                </summary>
                <p className="text-sm leading-7 text-muted-foreground">{description}</p>
              </details>
            ) : <p className="text-sm leading-7 text-muted-foreground">{description}</p>}
          </section>
        )}
        <section>
          <SectionHeading
            title={language === "zh" ? "剧集" : "Episodes"}
            aside={media.total_episodes ? (language === "zh" ? `共 ${media.total_episodes} 话` : `${media.total_episodes} episodes`) : undefined}
          />
          {episodes.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {episodes.map((episode) => {
                const progress = history.find(
                  (entry) =>
                    entry.provider === "anilist" &&
                    entry.external_id === String(media.anilist_id) &&
                    entry.episode === episode.ep,
                );
                const percent =
                  progress && progress.duration > 0
                    ? Math.min(100, (progress.position / progress.duration) * 100)
                    : 0;
                return (
                  <Link
                    key={episode.id}
                    to="/anime/$id/episode/$ep"
                    params={{ id: media.id, ep: String(episode.ep) }}
                    search={{
                      t:
                        percent > 2 && percent < 92
                          ? progress?.position
                          : undefined,
                    }}
                    className="group relative overflow-hidden rounded-xl bg-card px-4 py-3.5 transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary-readable motion-reduce:transition-none"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-bold tabular-nums text-foreground/80">
                        {episode.ep}
                      </span>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium leading-5">
                          {displayEpisodeTitle(
                            episode,
                            episode.ep,
                            language,
                          )}
                        </p>
                        {episode.duration && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock3 size={11} />
                            {episode.duration}
                          </p>
                        )}
                      </div>
                    </div>
                    {percent > 0 && (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/6">
                        <span
                          className="block h-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-white/5 bg-card/50 p-6 text-sm text-muted-foreground">
              {language === "zh" ? "暂无剧集信息" : "No episode information yet"}
            </p>
          )}
        </section>

        {(media.genres.length > 0 || media.studios.length > 0) && (
          <section className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <SectionHeading title={language === "zh" ? "作品信息" : "Information"} />
              <dl className="mt-5 space-y-3 text-sm">
                {media.studios.length > 0 && (
                  <InfoRow label={language === "zh" ? "动画制作" : "Studio"} value={media.studios.join(", ")} />
                )}
                {media.status && (
                  <InfoRow label={language === "zh" ? "状态" : "Status"} value={formatMediaStatus(media.status, language)} />
                )}
                {media.air_date && (
                  <InfoRow label={language === "zh" ? "首播" : "Premiered"} value={media.air_date} />
                )}
              </dl>
            </div>
            <div>
              <SectionHeading title={language === "zh" ? "类型" : "Genres"} />
              <div className="mt-5 flex flex-wrap gap-2">
                {media.genres.map((genre) => (
                  <span
                    key={genre}
                          className="rounded-lg bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {characters.length > 0 && (
          <section>
            <SectionHeading title={language === "zh" ? "角色" : "Characters"} />
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
              {characters.slice(0, 12).map((character) => (
                <div
                  key={character.id}
                  className="flex min-w-0 items-center gap-3"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/5">
                    {character.avatar && (
                      <img
                        src={character.avatar}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium leading-5">
                      {character.name}
                    </p>
                    {character.role && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {character.role}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function HeroArtwork({ media }: { media: AnimeInfo }) {
  const artwork = media.banner || media.cover;
  return (
    <div className="absolute inset-0">
      {artwork && (
        <img
          src={artwork}
          alt=""
          className={cn(
            "h-full w-full object-cover",
            !media.banner && "scale-110 blur-xl",
          )}
        />
      )}
      <div className="absolute inset-0 bg-black/25" />
      <div className="absolute inset-0 hidden bg-linear-to-r from-background via-background/55 to-background/10 lg:block" />
      <div className="absolute inset-0 bg-linear-to-t from-background via-background/65 to-black/10 lg:via-background/25" />
    </div>
  );
}

function SectionHeading({
  title,
  aside,
}: {
  title: string;
  aside?: string;
}) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {aside && <p className="text-xs text-muted-foreground">{aside}</p>}
    </div>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/12 bg-black/20 px-2.5 py-1 backdrop-blur">
      {children}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground/72">{value}</dd>
    </div>
  );
}

function formatMediaStatus(status: string, language: "en" | "zh") {
  if (language === "en") return ({ RELEASING: "Airing", FINISHED: "Finished", NOT_YET_RELEASED: "Upcoming", CANCELLED: "Cancelled", HIATUS: "On hiatus" }[status] ?? status);
  return (
    {
      RELEASING: "连载中",
      FINISHED: "已完结",
      NOT_YET_RELEASED: "未播出",
      CANCELLED: "已取消",
      HIATUS: "暂停",
    }[status] ?? status
  );
}

function formatMediaFormat(format: string, language: "en" | "zh") {
  if (language === "en") return ({ TV: "TV", TV_SHORT: "Short", MOVIE: "Movie", ONA: "Web anime", SPECIAL: "Special", MUSIC: "Music" }[format] ?? format);
  return (
    {
      TV: "TV 动画",
      TV_SHORT: "短篇动画",
      MOVIE: "动画电影",
      OVA: "OVA",
      ONA: "网络动画",
      SPECIAL: "特别篇",
      MUSIC: "音乐动画",
    }[format] ?? format
  );
}
