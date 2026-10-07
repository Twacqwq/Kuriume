//! # kuriume-provider
//!
//! Anime data-source abstraction layer. Defines a unified `AnimeProvider` trait;
//! AniList is the V1 animation catalog. Playback sources are a separate concern.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use kuriume_provider::{AniList, AnimeProvider, SearchQuery};
//!
//! #[tokio::main]
//! async fn main() {
//!     let provider = AniList::new();
//!     let result = provider.search(SearchQuery {
//!         keyword: "Frieren".into(),
//!         offset: 0,
//!         limit: 10,
//!     }, None).await.unwrap();
//!     println!("{:?}", result.data);
//! }
//! ```

mod anilist;
mod anime1;
pub mod builtin_rules;
mod error;
mod hianime;
mod models;
mod playback;
mod playback_matching;
mod provider;
pub mod rule;
mod source_http;
mod xifan;

pub use anilist::AniList;
pub use anime1::Anime1;
pub use error::{ProviderError, Result};
pub use hianime::HiAnime;
pub use models::{
    AnimeInfo, CalendarEntry, CharacterInfo, EpisodesInfo, GetEpisodesQuery, GetListQuery,
    PagedResult, SearchQuery, SortBy, Weekday,
};
pub use playback::{
    PlaybackCandidate, PlaybackEpisode, PlaybackHeaders, PlaybackProvider,
    PlaybackProviderCapabilities, PlaybackProviderDescriptor, PlaybackResolveRequest, PlaybackRoad,
    PlaybackSearch, PlaybackSource, PlaybackSubtitle, ResolvePlan, RulePlaybackProvider,
};
pub use provider::AnimeProvider;
pub use rule::{
    OnlineEpisode, OnlineRoad, OnlineSearchResult, Rule, RuleEngine, RuleResolver, RuleSelectors,
};
pub use xifan::Xifan;
