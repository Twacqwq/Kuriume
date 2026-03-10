use kuriume_mpv::{MpvPlayer, PlayerEvent};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::mpsc::UnboundedReceiver;

/// Shared player state managed by Tauri.
pub struct PlayerState {
    player: Mutex<Option<MpvPlayer>>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            player: Mutex::new(None),
        }
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize the mpv player, optionally embedded in a native window.
#[command]
pub(crate) fn player_init(
    state: State<'_, PlayerState>,
    app: AppHandle,
    wid: Option<i64>,
) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|e| e.to_string())?;

    let mut player = MpvPlayer::new(wid).map_err(|e| e.to_string())?;

    // Start event loop and forward events to frontend
    let rx = player.start_event_loop().map_err(|e| e.to_string())?;
    spawn_event_forwarder(app, rx);

    *guard = Some(player);
    Ok(())
}

/// Load and play a media URL or file path.
#[command]
pub(crate) fn player_play(state: State<'_, PlayerState>, url: &str) -> Result<(), String> {
    with_player(&state, |p| p.play(url))
}

/// Set pause state.
#[command]
pub(crate) fn player_set_paused(
    state: State<'_, PlayerState>,
    paused: bool,
) -> Result<(), String> {
    with_player(&state, |p| p.set_paused(paused))
}

/// Seek to an absolute position in seconds.
#[command]
pub(crate) fn player_seek(state: State<'_, PlayerState>, seconds: f64) -> Result<(), String> {
    with_player(&state, |p| p.seek(seconds))
}

/// Stop playback.
#[command]
pub(crate) fn player_stop(state: State<'_, PlayerState>) -> Result<(), String> {
    with_player(&state, |p| p.stop())
}

/// Set volume (0-100).
#[command]
pub(crate) fn player_set_volume(state: State<'_, PlayerState>, volume: i64) -> Result<(), String> {
    with_player(&state, |p| p.set_volume(volume))
}

/// Get current volume.
#[command]
pub(crate) fn player_get_volume(state: State<'_, PlayerState>) -> Result<i64, String> {
    let guard = state.player.lock().map_err(|e| e.to_string())?;
    let player = guard.as_ref().ok_or("Player not initialized")?;
    Ok(player.volume())
}

/// Set playback speed.
#[command]
pub(crate) fn player_set_speed(state: State<'_, PlayerState>, speed: f64) -> Result<(), String> {
    with_player(&state, |p| p.set_speed(speed))
}

/// Get current playback position and duration.
#[command]
pub(crate) fn player_get_state(
    state: State<'_, PlayerState>,
) -> Result<PlayerStateInfo, String> {
    let guard = state.player.lock().map_err(|e| e.to_string())?;
    let player = guard.as_ref().ok_or("Player not initialized")?;
    Ok(PlayerStateInfo {
        position: player.position(),
        duration: player.duration(),
        paused: player.is_paused(),
        volume: player.volume(),
        speed: player.speed(),
    })
}

/// Set audio track by ID. Use 0 to disable.
#[command]
pub(crate) fn player_set_audio_track(
    state: State<'_, PlayerState>,
    id: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_audio_track(id))
}

/// Set subtitle track by ID. Use 0 to disable.
#[command]
pub(crate) fn player_set_subtitle_track(
    state: State<'_, PlayerState>,
    id: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_subtitle_track(id))
}

/// Destroy the player and free resources.
#[command]
pub(crate) fn player_destroy(state: State<'_, PlayerState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct PlayerStateInfo {
    pub position: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: i64,
    pub speed: f64,
}

fn with_player(
    state: &State<'_, PlayerState>,
    f: impl FnOnce(&MpvPlayer) -> kuriume_mpv::Result<()>,
) -> Result<(), String> {
    let guard = state.player.lock().map_err(|e| e.to_string())?;
    let player = guard.as_ref().ok_or("Player not initialized")?;
    f(player).map_err(|e| e.to_string())
}

fn spawn_event_forwarder(app: AppHandle, mut rx: UnboundedReceiver<PlayerEvent>) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = app.emit("player-event", &event);
        }
    });
}
