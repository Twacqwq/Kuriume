use serde::{Deserialize, Serialize};

/// Basic anime information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimeInfo {
    /// Internal ID from the data source.
    pub id: String,
    /// Anime title.
    pub title: String,
    /// Anime title with cn
    pub title_cn: String,
    /// Cover image URL.
    pub cover: Option<String>,
    /// Score (0–10).
    pub score: Option<f64>,
    /// Premiere year.
    pub year: Option<u16>,
    /// Total number of episodes.
    pub total_episodes: u32,
    /// Genre tags.
    pub genres: Vec<String>,
    /// Synopsis / description.
    pub description: Option<String>,
}

/// Search request parameters.
#[derive(Debug, Clone, Default)]
pub struct SearchQuery {
    /// Search keyword.
    pub keyword: String,
    /// Pagination offset.
    pub offset: u32,
    /// Number of items per page.
    pub limit: u32,
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
    #[serde(rename = "type")]
    pub typ: u32,
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
    pub id: u32,
    // Name
    pub name: Option<String>,
    // Role
    pub role: Option<String>,
    // Avatar
    pub avatar: Option<String>,
    // CV
    pub cv: Option<String>,
}
