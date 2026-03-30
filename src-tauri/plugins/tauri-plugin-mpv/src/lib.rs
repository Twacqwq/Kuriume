//! tauri-plugin-mpv — Tauri v2 plugin for mpv video playback.
//!
//! Provides a native GPU-rendered video player using mpv's render API.
//! - macOS: OpenGL → IOSurface → Metal blit → CAMetalLayer
//! - Windows: OpenGL → PBO readback → D3D11 → DXGI SwapChain

mod commands;
mod platform;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use commands::PlayerState;

/// Initialize the mpv plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mpv")
        .invoke_handler(tauri::generate_handler![
            commands::player_init,
            commands::player_play,
            commands::player_set_paused,
            commands::player_seek,
            commands::player_stop,
            commands::player_set_volume,
            commands::player_get_volume,
            commands::player_set_speed,
            commands::player_get_state,
            commands::player_set_audio_track,
            commands::player_set_subtitle_track,
            commands::player_set_hwdec,
            commands::player_get_hwdec,
            commands::player_set_buffer_size,
            commands::player_set_viewport,
            commands::player_destroy,
            commands::player_set_anime4k,
            commands::player_clear_anime4k,
        ])
        .setup(|app, _api| {
            app.manage(PlayerState::new());
            Ok(())
        })
        .build()
}
