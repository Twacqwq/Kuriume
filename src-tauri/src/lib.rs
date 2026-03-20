use crate::commands::{MikanState, ProviderState};
use crate::player_commands::PlayerState;
use crate::store_commands::StoreState;
use crate::torrent_commands::TorrentState;
use kuriume_provider::Bangumi;
use std::sync::Arc;
use tauri::Manager;

mod commands;
mod native_view;
mod player_commands;
mod store_commands;
mod torrent_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bangumi_provider = Bangumi::new();

    let mut state = ProviderState::new();
    state.register(Arc::new(bangumi_provider));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .manage(PlayerState::new())
        .manage(MikanState::new())
        .manage(TorrentState::new())
        .manage(StoreState::new())
        .invoke_handler(tauri::generate_handler![
            crate::commands::get_list,
            crate::commands::search,
            crate::commands::get_detail,
            crate::commands::get_episodes,
            crate::commands::get_calendar,
            crate::commands::get_characters,
            crate::commands::mikan_search,
            crate::commands::mikan_resolve,
            crate::commands::mikan_get_subgroups,
            crate::commands::mikan_get_subgroup_torrents,
            crate::commands::mikan_get_all_torrents,
            crate::player_commands::player_init,
            crate::player_commands::player_play,
            crate::player_commands::player_set_paused,
            crate::player_commands::player_seek,
            crate::player_commands::player_stop,
            crate::player_commands::player_set_volume,
            crate::player_commands::player_get_volume,
            crate::player_commands::player_set_speed,
            crate::player_commands::player_get_state,
            crate::player_commands::player_set_audio_track,
            crate::player_commands::player_set_subtitle_track,
            crate::player_commands::player_set_hwdec,
            crate::player_commands::player_get_hwdec,
            crate::player_commands::player_set_buffer_size,
            crate::player_commands::player_set_viewport,
            crate::player_commands::player_destroy,
            crate::torrent_commands::torrent_add,
            crate::torrent_commands::torrent_list_files,
            crate::torrent_commands::torrent_stream_url,
            crate::torrent_commands::torrent_stats,
            crate::torrent_commands::torrent_remove,
            crate::torrent_commands::torrent_file_path,
            crate::store_commands::get_settings,
            crate::store_commands::set_cache_dir,
            crate::store_commands::set_cache_enabled,
            crate::store_commands::set_hwdec,
            crate::store_commands::set_default_volume,
            crate::store_commands::set_default_speed,
            crate::store_commands::set_buffer_size,
            crate::store_commands::set_auto_next,
            crate::store_commands::cache_lookup,
            crate::store_commands::cache_register,
            crate::store_commands::cache_remove,
            crate::store_commands::cache_list,
            crate::store_commands::cache_total_size,
            crate::store_commands::cache_clear_all,
            crate::store_commands::cache_organize,
            crate::store_commands::cache_migrate_dir,
            crate::store_commands::watchlist_add,
            crate::store_commands::watchlist_remove,
            crate::store_commands::watchlist_get,
            crate::store_commands::watchlist_set_status,
            crate::store_commands::watchlist_list,
            crate::store_commands::history_upsert,
            crate::store_commands::history_list,
            crate::store_commands::history_remove,
            crate::store_commands::history_clear,
        ])
        .setup(|app| {
            // Clean up orphaned torrent temp files from previous sessions.
            if let Ok(data_dir) = app.path().app_data_dir() {
                let temp_dir = data_dir.join("torrents");
                if temp_dir.exists() {
                    let _ = std::fs::remove_dir_all(&temp_dir);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
