//! # kuriume-provider
//!
//! 番剧数据源抽象层。定义统一的 `AnimeProvider` trait，
//! 各数据源（Bangumi、AniList 等）各自实现，内部持有 HTTP 客户端。
//!
//! ## 用法
//!
//! ```rust,no_run
//! use kuriume_provider::{AnimeProvider, BangumiProvider, SearchQuery};
//!
//! #[tokio::main]
//! async fn main() {
//!     let provider = BangumiProvider::new();
//!     let result = provider.search(SearchQuery {
//!         keyword: "葬送的芙莉莲".into(),
//!         offset: 0,
//!         limit: 10,
//!     }).await.unwrap();
//!     println!("{:?}", result.data);
//! }
//! ```

// 新式模块声明：文件名 = 模块名，子文件放在同名目录中（无需 mod.rs）
mod bangumi;
mod error;
mod models;
mod provider;

// 公开 re-export，让外部使用者直接 `use kuriume_provider::AnimeProvider`
pub use bangumi::BangumiProvider;
pub use error::{ProviderError, Result};
pub use models::{AnimeInfo, PagedResult, SearchQuery};
pub use provider::AnimeProvider;
