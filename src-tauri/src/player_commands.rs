use crate::frame_server::FrameServer;
use kuriume_mpv::{MpvPlayer, OffscreenRenderer, PlayerEvent};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::Notify;

/// All resources associated with an active player session.
///
/// Bundled together so that cleanup order is explicit and guaranteed.
struct ActivePlayer {
    /// Frame server (holds Arc<OffscreenRenderer>).  Must be shut down
    /// first so the broadcast task releases its Arc clone.
    frame_server: FrameServer,
    /// Offscreen renderer.  Must be dropped (mpv_render_context_free)
    /// before the player (mpv_destroy).
    renderer: Arc<OffscreenRenderer>,
    /// The mpv player instance.  Dropped last.
    player: MpvPlayer,
}

/// Shared player state managed by Tauri.
///
/// Uses a `tokio::sync::Mutex` so the lock can be held across await
/// points, preventing concurrent init/destroy races.
pub struct PlayerState {
    inner: tokio::sync::Mutex<Option<ActivePlayer>>,
    frame_notify: Arc<Notify>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: tokio::sync::Mutex::new(None),
            frame_notify: Arc::new(Notify::new()),
        }
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for PlayerState {
    fn drop(&mut self) {
        // Synchronous cleanup for when Tauri drops managed state on app close.
        // We get &mut self here, so we can bypass the async mutex.
        let inner = self.inner.get_mut();
        if let Some(active) = inner.take() {
            // 1. Drop frame_server — abort tasks (sync), releasing Arc clone.
            drop(active.frame_server);
            // 2. Drop renderer — triggers OffscreenRenderer::drop
            //    (stops render thread, calls mpv_render_context_free).
            drop(active.renderer);
            // 3. Drop player — calls mpv_destroy (now safe).
            drop(active.player);
        }
    }
}

/// Default offscreen render resolution (can be resized by the frontend).
const DEFAULT_WIDTH: u32 = 1280;
const DEFAULT_HEIGHT: u32 = 720;

/// Initialize the mpv player for offscreen rendering.
///
/// Creates the player with `vo=libmpv`, sets up the software renderer,
/// and starts a WebSocket frame server to deliver frames to the frontend.
/// Returns the port of the frame server.
#[command]
pub(crate) async fn player_init(
    state: State<'_, PlayerState>,
    app: AppHandle,
) -> Result<u16, String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Err("Player already initialized".into());
    }

    // Create player in offscreen mode.
    let player = MpvPlayer::new_offscreen().map_err(|e| e.to_string())?;
    let handle = player.raw_handle();

    // Create renderer BEFORE starting event loop to avoid
    // race between mpv_wait_event and mpv_render_context_create.
    let renderer = OffscreenRenderer::new(handle, DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .map_err(|e| e.to_string())?;
    let renderer = Arc::new(renderer);

    // Start the render loop — signals frame_notify on each new frame.
    let notify_for_render = state.frame_notify.clone();
    renderer
        .start(move || {
            notify_for_render.notify_one();
        })
        .map_err(|e| e.to_string())?;

    // Start the frame server.
    let server = FrameServer::start(renderer.clone(), state.frame_notify.clone())
        .await
        .map_err(|e| e.to_string())?;
    let port = server.port;

    // Store everything together — player is stored last to keep the
    // Mutex locked for the entire init, preventing concurrent destroy.
    // Need to start event loop before storing because start_event_loop
    // takes &mut self.
    //
    // We create a temporary mutable binding for the player to call
    // start_event_loop, then move it into ActivePlayer.
    let mut player = player;
    let rx = player.start_event_loop().map_err(|e| e.to_string())?;

    *guard = Some(ActivePlayer {
        frame_server: server,
        renderer,
        player,
    });

    // Drop the lock before spawning the event forwarder.
    drop(guard);
    spawn_event_forwarder(app, rx);

    Ok(port)
}

/// Set the offscreen render resolution to match the frontend canvas.
#[command]
pub(crate) async fn player_set_render_size(
    state: State<'_, PlayerState>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let guard = state.inner.lock().await;
    if let Some(active) = guard.as_ref() {
        active.renderer.set_size(width, height);
    }
    Ok(())
}

/// Load and play a media URL or file path.
#[command]
pub(crate) async fn player_play(state: State<'_, PlayerState>, url: &str) -> Result<(), String> {
    with_player(&state, |p| p.play(url)).await
}

/// Set pause state.
#[command]
pub(crate) async fn player_set_paused(
    state: State<'_, PlayerState>,
    paused: bool,
) -> Result<(), String> {
    with_player(&state, |p| p.set_paused(paused)).await
}

/// Seek to an absolute position in seconds.
#[command]
pub(crate) async fn player_seek(state: State<'_, PlayerState>, seconds: f64) -> Result<(), String> {
    with_player(&state, |p| p.seek(seconds)).await
}

/// Stop playback.
#[command]
pub(crate) async fn player_stop(state: State<'_, PlayerState>) -> Result<(), String> {
    with_player(&state, |p| p.stop()).await
}

/// Set volume (0-100).
#[command]
pub(crate) async fn player_set_volume(state: State<'_, PlayerState>, volume: i64) -> Result<(), String> {
    with_player(&state, |p| p.set_volume(volume)).await
}

/// Get current volume.
#[command]
pub(crate) async fn player_get_volume(state: State<'_, PlayerState>) -> Result<i64, String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    Ok(active.player.volume())
}

/// Set playback speed.
#[command]
pub(crate) async fn player_set_speed(state: State<'_, PlayerState>, speed: f64) -> Result<(), String> {
    with_player(&state, |p| p.set_speed(speed)).await
}

/// Get current playback position and duration.
#[command]
pub(crate) async fn player_get_state(
    state: State<'_, PlayerState>,
) -> Result<PlayerStateInfo, String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    Ok(PlayerStateInfo {
        position: active.player.position(),
        duration: active.player.duration(),
        paused: active.player.is_paused(),
        volume: active.player.volume(),
        speed: active.player.speed(),
    })
}

/// Set audio track by ID. Use 0 to disable.
#[command]
pub(crate) async fn player_set_audio_track(
    state: State<'_, PlayerState>,
    id: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_audio_track(id)).await
}

/// Set subtitle track by ID. Use 0 to disable.
#[command]
pub(crate) async fn player_set_subtitle_track(
    state: State<'_, PlayerState>,
    id: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_subtitle_track(id)).await
}

/// Destroy the player and free all resources.
#[command]
pub(crate) async fn player_destroy(state: State<'_, PlayerState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let Some(active) = guard.take() else {
        return Ok(()); // nothing to destroy
    };
    // Release the lock before doing blocking cleanup.
    drop(guard);

    // 1. Shutdown frame server — awaits spawned tasks so the broadcast
    //    task's Arc<OffscreenRenderer> clone is dropped.
    active.frame_server.shutdown().await;

    // 2. Drop renderer then player on a blocking thread so that
    //    thread-joins don't block the Tokio runtime.
    //    Order matters: renderer (mpv_render_context_free) before
    //    player (mpv_destroy).
    tokio::task::spawn_blocking(move || {
        drop(active.renderer);
        drop(active.player);
    })
    .await
    .map_err(|e| e.to_string())?;

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

async fn with_player(
    state: &State<'_, PlayerState>,
    f: impl FnOnce(&MpvPlayer) -> kuriume_mpv::Result<()>,
) -> Result<(), String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    f(&active.player).map_err(|e| e.to_string())
}

fn spawn_event_forwarder(app: AppHandle, mut rx: UnboundedReceiver<PlayerEvent>) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = app.emit("player-event", &event);
        }
    });
}
