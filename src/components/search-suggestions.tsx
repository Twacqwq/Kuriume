import { useCatalogSource, useDisplayLanguage } from "@/hooks/use-display-language";
import { CATALOG_PROVIDERS, catalogSourceForKind } from "@/lib/store";
import { displayAnimeTitle } from "@/lib/display-language";
import { mediaKind, type AnimeInfo, type MediaKind, type PagedResult } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Clock3, Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

const RECENT_KEY = "kuriume:recent-searches";
const RECENT_LIMIT = 8;
const SUGGEST_DELAY_MS = 450;

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecent(items: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, RECENT_LIMIT))); } catch { /* per-device convenience only */ }
}

/** Remember a submitted query on this device (most recent first). */
export function rememberSearch(query: string) {
  const value = query.trim();
  if (!value) return;
  writeRecent([value, ...readRecent().filter((item) => item !== value)]);
}

/**
 * Below the search field: recent searches while it is empty, and the first
 * few catalog matches while typing. Enter still opens the full result page.
 */
export function SearchSuggestions({ query, kind = "anime", composing = false, onSearch, onNavigate }: { query: string; kind?: MediaKind; composing?: boolean; onSearch: (query: string) => void; onNavigate: () => void }) {
  const language = useDisplayLanguage();
  const source = catalogSourceForKind(kind, useCatalogSource());
  const zh = language === "zh";
  const [recent, setRecent] = useState(readRecent);
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    // Pinyin/kana input passes through many intermediate strings; only the
    // committed text is worth a catalog lookup.
    if (composing) return;
    const timer = setTimeout(() => setDebounced(query.trim()), SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, composing]);
  // One CJK character is already a meaningful title query; Latin needs two.
  const ready = debounced.length >= 2 || /[぀-ヿ㐀-鿿]/.test(debounced);
  const suggestions = useQuery({
    queryKey: ["search-suggest", debounced, language, source, kind],
    queryFn: () => invoke<PagedResult<AnimeInfo>>("search", { provider: CATALOG_PROVIDERS[source], language, query: { keyword: debounced, limit: 6, offset: 0, kind } }),
    enabled: ready,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!query.trim()) {
    if (recent.length === 0) return null;
    return (
      <section className="px-2 pb-2 pt-3" aria-labelledby="recent-search-title">
        <div className="flex items-center justify-between px-1">
          <h2 id="recent-search-title" className="text-xs font-medium text-muted-foreground">{zh ? "最近搜索" : "Recent searches"}</h2>
          <button type="button" onClick={() => { writeRecent([]); setRecent([]); }}
            className="min-h-10 rounded-lg px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable">
            {zh ? "清除" : "Clear"}
          </button>
        </div>
        <ul className="mt-1 flex flex-wrap gap-2 px-1">
          {recent.map((item) => (
            <li key={item} className="flex max-w-full items-center rounded-full bg-secondary/70">
              <button type="button" onClick={() => onSearch(item)}
                className="flex min-h-10 min-w-0 items-center gap-1.5 rounded-full pl-3 pr-1 text-sm outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-primary-readable">
                <Clock3 size={13} className="shrink-0 text-muted-foreground" /><span className="truncate">{item}</span>
              </button>
              <button type="button" aria-label={zh ? `删除“${item}”` : `Remove “${item}”`}
                onClick={() => { const next = recent.filter((value) => value !== item); writeRecent(next); setRecent(next); }}
                className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-primary-readable">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const items = suggestions.data?.data ?? [];
  return (
    <section aria-label={zh ? "搜索建议" : "Suggestions"} className="px-1 pb-1 pt-2">
      {(suggestions.isFetching || !ready || debounced !== query.trim()) && items.length === 0 ? (
        <p role="status" className="flex min-h-12 items-center gap-2 px-3 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin text-primary-readable motion-reduce:animate-none" />{zh ? "正在查找…" : "Searching…"}
        </p>
      ) : (
        <ul>
          {items.map((media) => (
            <li key={media.id}>
              <Link to={mediaKind(media) === "manga" ? "/manga/$id" : "/anime/$id"} params={{ id: media.id }} onClick={() => { rememberSearch(query); onNavigate(); }}
                className="press flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5 outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-primary-readable">
                <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-card">
                  {media.cover && <img src={media.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayAnimeTitle(media, language)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{(mediaKind(media) === "manga"
                    ? [media.year, ...(media.authors ?? []).slice(0, 1), media.volumes ? (zh ? `${media.volumes} 卷` : `${media.volumes} vols`) : null]
                    : [media.year, media.format, media.total_episodes ? (zh ? `${media.total_episodes} 话` : `${media.total_episodes} eps`) : null]).filter(Boolean).join(" · ")}</span>
                </span>
                <ArrowUpRight size={15} className="shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => onSearch(query)}
        className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-sm font-bold text-primary-readable outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-primary-readable">
        <Search size={15} />{zh ? `查看“${query.trim()}”的全部结果` : `All results for “${query.trim()}”`}
      </button>
    </section>
  );
}
