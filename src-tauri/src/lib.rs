mod commands;

use commands::ProviderState;
use kuriume_provider::BangumiProvider;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化数据源（后续可按配置切换不同 Provider）
    let provider = BangumiProvider::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ProviderState(Arc::new(provider)))
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::anime::search_anime,
            commands::anime::get_anime_detail,
            commands::anime::get_trending_anime,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
