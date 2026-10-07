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
      ? `播放第 ${playEpisode} 话`
      : `继续第 ${playEpisode} 话`
    : "播放第 1 话";
  const resumeTime =
    latest && !latestComplete && playEpisode === latest.episode
      ? latest.position
      : undefined;

  return (
    <div className="min-h-full pb-16">
      <section className="relative min-h-[500px] overflow-hidden">
        <HeroArtwork media={media} />
        <div className="absolute left-8 top-10 z-20">
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/8 bg-black/35 text-white/75 backdrop-blur-xl transition hover:bg-black/55 hover:text-white"
            aria-label="返回首页"
            title="返回首页"
          >
            <ArrowLeft size={18} />
          </button>
        </div>

        <div className="relative z-10 mx-auto flex min-h-[500px] max-w-7xl items-end gap-9 px-10 pb-12 pt-28">
          <div className="hidden w-52 shrink-0 overflow-hidden rounded-xl bg-card shadow-2xl shadow-black/45 ring-1 ring-white/9 lg:block">
            {media.cover && (
              <img
                src={media.cover}
                alt={title}
                className="aspect-2/3 w-full object-cover"
              />
            )}
          </div>
          <div className="max-w-3xl pb-1">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-white/60">
              {media.format && <MetaPill>{formatMediaFormat(media.format)}</MetaPill>}
              {media.year && <span>{media.year}</span>}
              {media.total_episodes > 0 && (
                <>
                  <span className="text-white/25">·</span>
                  <span>{media.total_episodes} 话</span>
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
            <h1 className="text-4xl font-semibold tracking-tight text-white xl:text-5xl">
              {title}
            </h1>
            {description && (
              <p className="mt-5 line-clamp-4 max-w-2xl text-sm leading-7 text-white/62">
                {description}
              </p>
            )}
            <div className="mt-7 flex items-center gap-3">
              <Button asChild size="lg" className="gap-2 rounded-full px-6">
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

      <div className="mx-auto max-w-7xl space-y-14 px-10 pt-10">
        <section>
          <SectionHeading
            title="剧集"
            aside={media.total_episodes ? `共 ${media.total_episodes} 话` : undefined}
          />
          {episodes.length > 0 ? (
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
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
                    className="group relative overflow-hidden rounded-xl border border-white/5 bg-card/70 p-4 transition hover:border-primary/30 hover:bg-card"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-xs font-semibold text-white/65 group-hover:bg-primary group-hover:text-primary-foreground">
                        {episode.ep}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {displayEpisodeTitle(
                            episode,
                            episode.ep,
                            language,
                          )}
                        </p>
                        {episode.duration && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
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
              暂无剧集信息
            </p>
          )}
        </section>

        {(media.genres.length > 0 || media.studios.length > 0) && (
          <section className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <SectionHeading title="作品信息" />
              <dl className="mt-5 space-y-3 text-sm">
                {media.studios.length > 0 && (
                  <InfoRow label="动画制作" value={media.studios.join("、")} />
                )}
                {media.status && (
                  <InfoRow label="状态" value={formatMediaStatus(media.status)} />
                )}
                {media.air_date && (
                  <InfoRow label="首播" value={media.air_date} />
                )}
              </dl>
            </div>
            <div>
              <SectionHeading title="类型" />
              <div className="mt-5 flex flex-wrap gap-2">
                {media.genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full border border-white/7 bg-white/4 px-3 py-1.5 text-xs text-white/58"
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
            <SectionHeading title="角色" />
            <div className="mt-5 grid grid-cols-3 gap-3 xl:grid-cols-6">
              {characters.slice(0, 12).map((character) => (
                <div
                  key={character.id}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-card/55 p-3"
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
                    <p className="truncate text-xs font-medium">
                      {character.name}
                    </p>
                    {character.role && (
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
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
      <div className="absolute inset-0 bg-black/38" />
      <div className="absolute inset-0 bg-linear-to-r from-background via-background/55 to-background/10" />
      <div className="absolute inset-0 bg-linear-to-t from-background via-transparent to-black/20" />
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
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
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

function formatMediaStatus(status: string) {
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

function formatMediaFormat(format: string) {
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
