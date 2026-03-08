use crate::commands::ProviderState;
use kuriume_provider::Bangumi;
use std::sync::Arc;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bangumi_provider = Bangumi::new();

    let mut state = ProviderState::new();
    state.register(Arc::new(bangumi_provider));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::get_list,
            crate::commands::get_detail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
