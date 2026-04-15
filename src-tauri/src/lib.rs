use crate::commands::{ProviderState, TorrentProviderState};
use crate::online_commands::OnlineSourceState;
use crate::store_commands::StoreState;
use crate::torrent_commands::TorrentState;
use kuriume_provider::{Bangumi, Dmhy, Mikan, Nyaa};
use std::sync::Arc;
#[cfg(desktop)]
use tauri::menu::Menu;
use tauri::Manager;

mod commands;
mod online_commands;
mod store_commands;
mod torrent_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bangumi_provider = Bangumi::new();

    let mut state = ProviderState::new();
    state.register(Arc::new(bangumi_provider));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_mpv::init());

    #[cfg(desktop)]
    let builder = builder.menu(Menu::new);

    builder
        .manage(state)
        .manage(TorrentState::new())
        .manage(StoreState::new())
        .manage(OnlineSourceState::new())
        .invoke_handler(tauri::generate_handler![
            crate::commands::get_list,
            crate::commands::search,
            crate::commands::get_detail,
            crate::commands::get_episodes,
            crate::commands::get_calendar,
            crate::commands::get_characters,
            crate::commands::torrent_source_resolve,
            crate::commands::torrent_source_get_groups,
            crate::commands::torrent_source_get_group_torrents,
            crate::commands::torrent_source_get_all_torrents,
            crate::commands::torrent_source_list_providers,
            crate::online_commands::online_source_list,
            crate::online_commands::online_source_list_rules,
            crate::online_commands::online_source_add_rule,
            crate::online_commands::online_source_remove_rule,
            crate::online_commands::online_source_search,
            crate::online_commands::online_source_echo,
            crate::online_commands::online_source_episodes,
            crate::online_commands::sniff_video_url,
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
            crate::store_commands::set_tracker_list,
            crate::store_commands::set_anime4k_mode,
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
            // Read tracker list from settings and init Mikan with it
            let tracker_list = {
                let store_state = app.state::<StoreState>();
                let handle = app.handle().clone();
                store_state
                    .with_store(&handle, |store| {
                        let default_dir = app
                            .path()
                            .download_dir()
                            .map(|p| p.join("Kuriume"))
                            .unwrap_or_else(|_| std::path::PathBuf::from("~/Downloads/Kuriume"))
                            .to_string_lossy()
                            .into_owned();
                        let settings = store
                            .get_settings(&default_dir)
                            .map_err(|e| e.to_string())?;
                        Ok(settings.tracker_list)
                    })
                    .unwrap_or_default()
            };

            let mut torrent_providers = TorrentProviderState::new();
            torrent_providers.register(Arc::new(Mikan::new(tracker_list.clone())));
            torrent_providers.register(Arc::new(Nyaa::new(tracker_list)));
            torrent_providers.register(Arc::new(Dmhy::new()));
            app.manage(torrent_providers);

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
