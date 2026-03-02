use kuriume_provider::{AnimeProvider, ProviderError, SearchQuery};
use std::sync::Arc;
use tauri::State;

/// Tauri 管理的数据源状态
pub struct ProviderState(pub Arc<dyn AnimeProvider>);

#[tauri::command]
pub async fn search_anime(
    keyword: String,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<'_, ProviderState>,
) -> Result<serde_json::Value, String> {
    let query = SearchQuery {
        keyword,
        offset: offset.unwrap_or(0),
        limit: limit.unwrap_or(20),
    };

    let result = state
        .0
        .search(query)
        .await
        .map_err(format_error)?;

    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_anime_detail(
    id: String,
    state: State<'_, ProviderState>,
) -> Result<serde_json::Value, String> {
    let detail = state
        .0
        .get_detail(&id)
        .await
        .map_err(format_error)?;

    serde_json::to_value(detail).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_trending_anime(
    limit: Option<u32>,
    state: State<'_, ProviderState>,
) -> Result<serde_json::Value, String> {
    let trending = state
        .0
        .get_trending(limit.unwrap_or(10))
        .await
        .map_err(format_error)?;

    serde_json::to_value(trending).map_err(|e| e.to_string())
}

fn format_error(err: ProviderError) -> String {
    err.to_string()
}
