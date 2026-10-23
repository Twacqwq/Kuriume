import { Button } from "@/components/ui/button";
import { isCatalogEntry } from "@/lib/store";
import { coverTone } from "@/lib/cover-tone";
import { LibraryControl } from "@/components/library-control";
import { mangaLength, relationLabel, sortRelations } from "@/lib/media-relations";
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
import {
  mediaKind,
  type AnimeCharacters,
  type AnimeEpisodes,
  type AnimeInfo,
  type MediaKind,
  type RelatedMedia,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { SHARED_POSTER_NAME } from "@/lib/view-transition";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  Clock3,
  LayoutGrid,
  List,
  Play,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const EPISODE_VIEW_KEY = "kuriume:detail-episode-view";
function readEpisodeView(): "grid" | "list" {
  try { return localStorage.getItem(EPISODE_VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; }
}

interface MediaDetailProps {
  media: AnimeInfo;
  /** Drawn from a list entry while the full lookup runs: hold the synopsis. */
  pendingDetails?: boolean;
  episodes: AnimeEpisodes[];
  characters: AnimeCharacters[];
  /** Source manga, adaptations, sequels... */
  relations?: RelatedMedia[];
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
  pendingDetails = false,
  episodes,
  characters,
  relations = [],
  libraryEntry,
  libraryPending,
  libraryError,
  history,
  onBack,
  onSetLibraryStatus,
  onRemoveFromLibrary,
}: MediaDetailProps) {
  const language = useDisplayLanguage();
  const kind = mediaKind(media);
  const manga = kind === "manga";
  const zh = language === "zh";
  const title = displayAnimeTitle(media, language);
  const description = displayAnimeDescription(media, language);
  const latest = history
    .filter(
      (entry) => isCatalogEntry(entry, media.id),
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
  const [episodeView, setEpisodeView] = useState(readEpisodeView);
  const chooseEpisodeView = (view: "grid" | "list") => {
    setEpisodeView(view);
    try { localStorage.setItem(EPISODE_VIEW_KEY, view); } catch { /* per-device preference only */ }
  };
  // Phones: once the hero's play button scrolls away, keep it reachable at the bottom.
  const actions = useRef<HTMLDivElement>(null);
  const [actionsVisible, setActionsVisible] = useState(true);
  useEffect(() => {
    const element = actions.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setActionsVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const progressFor = (episode: number) => {
    const entry = history.find((item) => isCatalogEntry(item, media.id) && item.episode === episode);
    return entry && entry.duration > 0 ? Math.min(100, (entry.position / entry.duration) * 100) : 0;
  };

  return (
    <div className="media-detail detail-canvas min-h-full pb-10 md:pb-16" style={toneStyle(media.cover_color)}>
      <section className="relative overflow-hidden">
        <HeroArtwork media={media} />
        <div className="absolute left-4 top-4 z-20 md:left-8 md:top-10">
          <button
            type="button"
            onClick={onBack}
            className="grid size-12 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-primary-readable motion-reduce:transition-none"
            aria-label={language === "zh" ? "返回" : "Back"}
            title={language === "zh" ? "返回" : "Back"}
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
                style={{ viewTransitionName: SHARED_POSTER_NAME }}
                className="aspect-2/3 w-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-foreground/75">
              {media.format && <MetaPill>{formatMediaFormat(media.format, language)}</MetaPill>}
              {media.year && <span>{media.year}</span>}
              {!manga && media.total_episodes > 0 && (
                <>
                  <span className="text-foreground/25">·</span>
                  <span>{language === "zh" ? `${media.total_episodes} 话` : `${media.total_episodes} episodes`}</span>
                </>
              )}
              {manga && mangaLength(media, language) && (
                <>
                  <span className="text-foreground/25">·</span>
                  <span>{mangaLength(media, language)}</span>
                </>
              )}
              {media.score && (
                <>
                  <span className="text-foreground/25">·</span>
                  <span className="inline-flex items-center gap-1 text-highlight">
                    <Star size={12} fill="currentColor" />
                    {media.score.toFixed(1)}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-balance text-2xl font-bold leading-tight tracking-[-0.025em] text-foreground [overflow-wrap:anywhere] md:text-4xl xl:text-5xl">
              {title}
            </h1>
            {manga && media.authors && media.authors.length > 0 && (
              <p className="mt-2 truncate text-sm text-foreground/70">{media.authors.join(" / ")}</p>
            )}
          </div>
          <div ref={actions} className="col-span-2 lg:col-span-1 lg:col-start-2">
            <div className="flex flex-wrap items-center gap-3 [&>button]:min-h-12 [&>button]:rounded-xl">
              {manga ? (
                <ReadButton describedBy="manga-reading-source" />
              ) : (
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
              )}
              <LibraryControl
                kind={kind}
                entry={libraryEntry}
                disabled={libraryPending}
                onSetStatus={onSetLibraryStatus}
                onRemove={onRemoveFromLibrary}
              />
            </div>
            {manga && (
              <p id="manga-reading-source" className="mt-3 text-sm text-muted-foreground">
                {zh ? "阅读功能即将上线，敬请期待。" : "Reading is coming soon."}
              </p>
            )}
            {libraryError && <p role="alert" className="mt-3 text-sm text-destructive-readable">{libraryError}</p>}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-4 pt-5 md:space-y-12 md:px-6 md:pt-8 lg:px-10">
        {pendingDetails ? (
          <section className="max-w-3xl" aria-busy="true" aria-label={language === "zh" ? "简介载入中" : "Loading synopsis"}>
            <div className="mb-4 h-5 w-16 rounded-md bg-overlay/6" />
            <div className="space-y-3">
              <div className="h-3.5 rounded bg-overlay/5" />
              <div className="h-3.5 rounded bg-overlay/5" />
              <div className="h-3.5 w-2/3 rounded bg-overlay/5" />
            </div>
          </section>
        ) : description && (
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
        {!manga && <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">{language === "zh" ? "剧集" : "Episodes"}</h2>
            <div className="flex items-center gap-1">
              {media.total_episodes > 0 && <p className="mr-2 text-xs text-muted-foreground">{language === "zh" ? `共 ${media.total_episodes} 话` : `${media.total_episodes} episodes`}</p>}
              {episodes.length > 0 && (
                <div role="radiogroup" aria-label={language === "zh" ? "剧集显示方式" : "Episode layout"} className="flex rounded-xl bg-card p-0.5">
                  {([["grid", LayoutGrid, language === "zh" ? "网格" : "Grid"], ["list", List, language === "zh" ? "列表" : "List"]] as const).map(([view, Icon, label]) => (
                    <button key={view} type="button" role="radio" aria-checked={episodeView === view} aria-label={label} title={label}
                      onClick={() => chooseEpisodeView(view)}
                      className={cn("grid size-11 place-items-center rounded-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-readable motion-reduce:transition-none",
                        episodeView === view ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {episodes.length === 0 ? (
            <p className="mt-5 rounded-xl border border-overlay/5 bg-card/50 p-6 text-sm text-muted-foreground">
              {language === "zh" ? "暂无剧集信息" : "No episode information yet"}
            </p>
          ) : episodeView === "grid" ? (
            <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
              {episodes.map((episode) => {
                const percent = progressFor(episode.ep);
                const watched = percent >= 92;
                return (
                  <Link
                    key={episode.id}
                    to="/anime/$id/episode/$ep"
                    params={{ id: media.id, ep: String(episode.ep) }}
                    search={{ t: percent > 2 && percent < 92 ? history.find((item) => isCatalogEntry(item, media.id) && item.episode === episode.ep)?.position : undefined }}
                    aria-label={displayEpisodeTitle(episode, episode.ep, language)}
                    title={displayEpisodeTitle(episode, episode.ep, language)}
                    className={cn("press relative grid min-h-12 place-items-center overflow-hidden rounded-xl text-sm tabular-nums outline-none hover:bg-secondary active:bg-secondary focus-visible:outline-2 focus-visible:outline-primary-readable",
                      watched ? "bg-card/60 text-foreground/45" : "bg-card text-foreground/85", playEpisode === episode.ep && "font-bold text-primary-readable ring-1 ring-inset ring-primary/45")}
                  >
                    {episode.ep}
                    {percent > 2 && !watched && (
                      <span aria-hidden="true" className="absolute inset-x-2 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-overlay/10">
                        <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {episodes.map((episode) => {
                const percent = progressFor(episode.ep);
                return (
                  <Link
                    key={episode.id}
                    to="/anime/$id/episode/$ep"
                    params={{ id: media.id, ep: String(episode.ep) }}
                    search={{ t: percent > 2 && percent < 92 ? history.find((item) => isCatalogEntry(item, media.id) && item.episode === episode.ep)?.position : undefined }}
                    className="press group relative overflow-hidden rounded-xl bg-card px-4 py-3.5 transition-colors hover:bg-secondary active:bg-secondary focus-visible:outline-2 focus-visible:outline-primary-readable motion-reduce:transition-none"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-bold tabular-nums text-foreground/80">
                        {episode.ep}
                      </span>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium leading-5">
                          {displayEpisodeTitle(episode, episode.ep, language)}
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
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-overlay/8">
                        <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>}

        {relations.length > 0 && <RelatedWorks kind={kind} relations={relations} />}

        {(media.genres.length > 0 || media.studios.length > 0 || (manga && (media.authors?.length || media.status || media.air_date))) && (
          <section className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <SectionHeading title={language === "zh" ? "作品信息" : "Information"} />
              <dl className="mt-5 space-y-3 text-sm">
                {!manga && media.studios.length > 0 && (
                  <InfoRow label={language === "zh" ? "动画制作" : "Studio"} value={media.studios.join(", ")} />
                )}
                {manga && media.authors && media.authors.length > 0 && (
                  <InfoRow label={zh ? "作者" : "Authors"} value={media.authors.join(" / ")} />
                )}
                {media.status && (
                  <InfoRow label={language === "zh" ? "状态" : "Status"} value={formatMediaStatus(media.status, language, kind)} />
                )}
                {media.air_date && (
                  <InfoRow label={manga ? (zh ? "开始连载" : "Started") : (zh ? "首播" : "Premiered")} value={media.air_date} />
                )}
                {manga && mangaLength(media, language) && (
                  <InfoRow label={zh ? "篇幅" : "Length"} value={mangaLength(media, language)!} />
                )}
              </dl>
            </div>
            {media.genres.length > 0 && <div>
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
            </div>}
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
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-overlay/5">
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

      <div aria-hidden={actionsVisible} inert={actionsVisible}
        className={cn("detail-sticky-cta fixed inset-x-0 bottom-0 z-30 border-t border-overlay/6 bg-background/92 px-4 pt-3 backdrop-blur-md transition-transform duration-200 motion-reduce:transition-none md:hidden",
          actionsVisible ? "translate-y-full" : "translate-y-0")}>
        <div className="flex items-center gap-3">
          {manga ? <ReadButton describedBy="manga-reading-source" /> : (
            <Button asChild size="lg" className="min-h-12 flex-1 gap-2 rounded-xl px-5">
              <Link to="/anime/$id/episode/$ep" params={{ id: media.id, ep: String(playEpisode) }} search={{ t: resumeTime }}>
                <Play size={17} fill="currentColor" />
                {playLabel}
              </Link>
            </Button>
          )}
          <LibraryControl compact kind={kind} entry={libraryEntry} disabled={libraryPending} onSetStatus={onSetLibraryStatus} onRemove={onRemoveFromLibrary} />
        </div>
      </div>
    </div>
  );
}

/** Reading opens here once a reading source exists; until then it says so. */
function ReadButton({ describedBy }: { describedBy: string }) {
  const language = useDisplayLanguage();
  return (
    <Button size="lg" disabled aria-describedby={describedBy} className="min-h-12 flex-1 gap-2 rounded-xl px-5 sm:flex-none">
      <BookOpen size={17} />
      {language === "zh" ? "开始阅读" : "Read"}
    </Button>
  );
}

function RelatedWorks({ kind, relations }: { kind: MediaKind; relations: RelatedMedia[] }) {
  const language = useDisplayLanguage();
  const items = sortRelations(relations, kind);
  return (
    <section aria-labelledby="related-works">
      <h2 id="related-works" className="text-lg font-bold tracking-tight">{language === "zh" ? "相关作品" : "Related"}</h2>
      <div className="hide-scrollbar -mx-4 mt-4 grid auto-cols-[30%] grid-flow-col snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 min-[480px]:auto-cols-[22%] sm:auto-cols-[17%] md:mx-0 md:scroll-px-0 md:px-0 lg:auto-cols-[8.5rem]">
        {items.map((item) => {
          const related = item.media;
          const relatedKind = mediaKind(related);
          const card = (
            <>
              <div className="relative aspect-2/3 overflow-hidden rounded-xl bg-card">
                {related.cover && <img src={related.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/72 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {relationLabel(item, language)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-foreground/90 transition-colors group-hover:text-primary-readable motion-reduce:transition-none">
                {displayAnimeTitle(related, language)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[relatedKind === "manga" ? (language === "zh" ? "漫画" : "Manga") : (language === "zh" ? "动画" : "Anime"), related.year].filter(Boolean).join(" · ")}
              </p>
            </>
          );
          const className = "press group min-w-0 snap-start rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-primary-readable";
          return relatedKind === "manga" ? (
            <Link key={related.id} to="/manga/$id" params={{ id: related.id }} className={className}>{card}</Link>
          ) : (
            <Link key={related.id} to="/anime/$id" params={{ id: related.id }} className={className}>{card}</Link>
          );
        })}
      </div>
    </section>
  );
}

function toneStyle(color: string | null | undefined): React.CSSProperties | undefined {
  const tone = coverTone(color);
  return tone ? ({ "--cover-tone": tone } as React.CSSProperties) : undefined;
}

function HeroArtwork({ media }: { media: AnimeInfo }) {
  const artwork = media.banner || media.cover;
  return (
    // The artwork fades out into the cover-tinted canvas instead of into a flat
    // background colour, so the page below the hero carries the work's colour.
    <div className="detail-artwork absolute inset-0">
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
      <div className="absolute inset-0 bg-scrim/25" />
      <div className="absolute inset-0 hidden bg-linear-to-r from-background via-background/55 to-background/10 lg:block" />
      <div className="absolute inset-0 bg-linear-to-t from-scrim/45 via-scrim/20 to-scrim/10" />
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
    <span className="rounded-full border border-foreground/12 bg-scrim/20 px-2.5 py-1 backdrop-blur">
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

function formatMediaStatus(status: string, language: "en" | "zh", kind: MediaKind = "anime") {
  const manga = kind === "manga";
  if (language === "en") return ({ RELEASING: manga ? "Publishing" : "Airing", FINISHED: "Finished", NOT_YET_RELEASED: "Upcoming", CANCELLED: "Cancelled", HIATUS: "On hiatus" }[status] ?? status);
  return (
    {
      RELEASING: "连载中",
      FINISHED: "已完结",
      NOT_YET_RELEASED: manga ? "未开始" : "未播出",
      CANCELLED: "已取消",
      HIATUS: manga ? "休刊中" : "暂停",
    }[status] ?? status
  );
}

function formatMediaFormat(format: string, language: "en" | "zh") {
  if (language === "en") return ({ TV: "TV", TV_SHORT: "Short", MOVIE: "Movie", ONA: "Web anime", SPECIAL: "Special", MUSIC: "Music", MANGA: "Manga", ONE_SHOT: "One-shot", NOVEL: "Novel" }[format] ?? format);
  return (
    {
      MANGA: "漫画",
      ONE_SHOT: "短篇漫画",
      NOVEL: "小说",
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
