//! # kuriume-provider
//!
//! Anime data-source abstraction layer. Defines a unified `AnimeProvider` trait;
//! each data source (Bangumi, AniList, etc.) implements it with its own HTTP client.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use kuriume_provider::{AnimeProvider, BangumiProvider, SearchQuery};
//!
//! #[tokio::main]
//! async fn main() {
//!     let provider = BangumiProvider::new();
//!     let result = provider.search(SearchQuery {
//!         keyword: "Frieren".into(),
//!         offset: 0,
//!         limit: 10,
//!     }).await.unwrap();
//!     println!("{:?}", result.data);
//! }
//! ```

mod bangumi;
mod error;
mod mikan;
mod models;
mod provider;

pub use bangumi::Bangumi;
pub use error::{ProviderError, Result};
pub use mikan::{
    Mikan, MikanBangumiEntry, MikanTorrentEntry, SubtitleGroup, SubtitleGroupTorrents,
};
pub use models::{
    AnimeInfo, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult, SearchQuery, SortBy, Weekday,
};
pub use provider::AnimeProvider;
