use serde::{Deserialize, Serialize};

/// What a catalog entry is. AniList and Bangumi number anime and manga in
/// one ID space, so an ID alone opens either; this says which page it needs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    #[default]
    Anime,
    /// Comics and other books (a light-novel original reached by a relation).
    Manga,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anime => "anime",
            Self::Manga => "manga",
        }
    }
}

/// Catalog entry: an anime, or a manga (`kind`). Episode and broadcast
/// fields stay empty for manga; chapter, volume and author fields for anime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimeInfo {
    /// Stable Kuriume catalog ID. V1 uses the `anilist:{id}` namespace.
    pub id: String,
    #[serde(default)]
    pub kind: MediaKind,
    /// AniList media ID.
    pub anilist_id: u64,
    /// MyAnimeList ID exposed by AniList when available.
    pub mal_id: Option<u64>,
    /// Stable catalog/search title, normally AniList romaji.
    pub title: String,
    /// Preferred English display title.
    pub title_en: String,
    /// Original catalog aliases for playback matching, independent of display language.
    #[serde(default)]
    pub search_titles: Vec<String>,
    /// Preferred Chinese display title when the catalog exposes one.
    pub title_cn: Option<String>,
    /// Original-script title from AniList (Japanese for Japanese works).
    pub title_native: Option<String>,
    /// Cover image URL.
    pub cover: Option<String>,
    /// Dominant cover colour as `#rrggbb`, used to tint detail surfaces.
    #[serde(default)]
    pub cover_color: Option<String>,
    /// Wide artwork for hero/detail surfaces.
    pub banner: Option<String>,
    /// Score (0–10).
    pub score: Option<f64>,
    /// Premiere year.
    pub year: Option<u16>,
    /// Total number of episodes.
    pub total_episodes: u32,
    /// Premiere date (e.g. "2024-01-07").
    pub air_date: Option<String>,
    /// Genre tags.
    pub genres: Vec<String>,
    /// Synopsis / description.
    pub description: Option<String>,
    /// Chinese synopsis when localized metadata is available.
    pub description_cn: Option<String>,
    /// Japanese synopsis only when the source actually provides Japanese text.
    pub description_ja: Option<String>,
    /// AniList media status.
    pub status: Option<String>,
    /// AniList media format.
    pub format: Option<String>,
    /// Animation studios.
    pub studios: Vec<String>,
    /// The next scheduled broadcast while the work is airing.
    #[serde(default)]
    pub next_airing: Option<AiringSlot>,
    /// Episodes already broadcast, when the catalog knows it: `next - 1` while
    /// airing, the full count once finished, unknown otherwise.
    #[serde(default)]
    pub aired_episodes: Option<u32>,
    /// Calendar entries only: the broadcast this entry stands for.
    #[serde(default)]
    pub schedule: Option<AiringSlot>,
    /// Manga: published chapters, when the catalog knows them.
    #[serde(default)]
    pub chapters: Option<u32>,
    /// Manga: published volumes, when the catalog knows them.
    #[serde(default)]
    pub volumes: Option<u32>,
    /// Manga: writers and artists (anime credit studios instead).
    #[serde(default)]
    pub authors: Vec<String>,
}

/// Another work linked to a catalog entry: its source manga, an anime
/// adaptation, a sequel...
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedMedia {
    /// `SOURCE`, `ADAPTATION`, `SEQUEL`, `PREQUEL`, `SIDE_STORY`, `SPIN_OFF`,
    /// `ALTERNATIVE` or `OTHER`, from the related work's point of view
    /// relative to this one (`SOURCE`: it is this work's original).
    pub relation: String,
    pub media: AnimeInfo,
}

/// One broadcast: an episode number and its Unix airing time in seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiringSlot {
    pub episode: u32,
    pub airing_at: i64,
}

/// Search request parameters.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SearchQuery {
    /// Search keyword.
    pub keyword: String,
    /// Pagination offset.
    pub offset: u32,
    /// Number of items per page.
    pub limit: u32,
    /// Anime (default) or manga.
    #[serde(default)]
    pub kind: MediaKind,
}

/// GetList request parameters.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct GetListQuery {
    // year
    pub year: Option<u32>,
    // month
    pub month: Option<u32>,
    // limit
    pub limit: u32,
    // offset
    pub offset: u32,
    // soft
    pub soft: Option<SortBy>,
    // type
    #[serde(rename = "type", default)]
    pub typ: u32,
    /// Anime (default) or manga.
    #[serde(default)]
    pub kind: MediaKind,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub enum SortBy {
    #[default]
    Rank,
    Date,
}

impl SortBy {
    pub fn as_str(&self) -> &str {
        match self {
            SortBy::Rank => "rank",
            SortBy::Date => "date",
        }
    }
}

/// Paginated result wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagedResult<T> {
    /// List of items.
    pub data: Vec<T>,
    /// Total count.
    pub total: u64,
    // Limit
    pub limit: u32,
    // Offset
    pub offset: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GetEpisodesQuery {
    // ID
    pub id: String,
    // Limit
    pub limit: u32,
    // Offset
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodesInfo {
    // ID
    pub id: String,
    // Episodes ID
    pub ep: u32,
    // Episodes airdate
    pub airdate: Option<String>,
    // Episodes title
    pub title: Option<String>,
    // Episodes title with cn
    pub title_cn: Option<String>,
    // Episodes duration
    pub duration: Option<String>,
    // Episodes summary
    pub summary: Option<String>,
    // Episodes thumbnail
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterInfo {
    // ID
    pub id: u64,
    // Name
    pub name: Option<String>,
    // Role
    pub role: Option<String>,
    // Avatar
    pub avatar: Option<String>,
    // CVs
    pub cvs: Option<Vec<String>>,
}

/// A single weekday entry in the calendar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEntry {
    pub weekday: Weekday,
    pub items: Vec<AnimeInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Weekday {
    pub id: u8,
    pub cn: String,
}
