const COMMANDS: &[&str] = &[
    "player_init",
    "player_play",
    "player_set_paused",
    "player_seek",
    "player_stop",
    "player_set_volume",
    "player_get_volume",
    "player_set_speed",
    "player_get_state",
    "player_set_audio_track",
    "player_set_subtitle_track",
    "player_set_hwdec",
    "player_get_hwdec",
    "player_set_buffer_size",
    "player_set_viewport",
    "player_destroy",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
