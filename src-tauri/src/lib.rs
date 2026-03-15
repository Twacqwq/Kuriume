use crate::commands::{MikanState, ProviderState};
use crate::player_commands::PlayerState;
use crate::torrent_commands::TorrentState;
use kuriume_provider::Bangumi;
use std::sync::Arc;

mod commands;
mod player_commands;
mod torrent_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bangumi_provider = Bangumi::new();

    let mut state = ProviderState::new();
    state.register(Arc::new(bangumi_provider));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .manage(PlayerState::new())
        .manage(MikanState::new())
        .manage(TorrentState::new())
        .invoke_handler(tauri::generate_handler![
            crate::commands::get_list,
            crate::commands::get_detail,
            crate::commands::get_episodes,
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
            crate::player_commands::player_destroy,
            crate::torrent_commands::torrent_add,
            crate::torrent_commands::torrent_list_files,
            crate::torrent_commands::torrent_stream_url,
            crate::torrent_commands::torrent_stats,
            crate::torrent_commands::torrent_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
