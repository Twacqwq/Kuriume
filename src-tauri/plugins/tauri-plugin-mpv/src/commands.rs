//! Tauri commands for the mpv plugin.
//!
//! Migrated from the main crate's `player_commands.rs`, adapted for the
//! Tauri v2 plugin system. Uses `NativeVideoView` (IOSurface + CALayer)
//! instead of the old `NativeGlView` (NSOpenGLContext).

use crate::platform::NativeVideoView;
use kuriume_mpv::{MpvPlayer, PlayerEvent};
use tauri::{command, AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tokio::sync::mpsc::UnboundedReceiver;

// ── macOS display-sleep prevention via IOPMAssertion ─────────────
#[cfg(target_os = "macos")]
mod power {
    use std::ffi::c_void;

    type IOPMAssertionID = u32;
    type CFStringRef = *const c_void;
    type CFStringEncoding = u32;

    const K_CF_STRING_ENCODING_UTF8: CFStringEncoding = 0x0800_0100;
    const K_IOPM_ASSERTION_LEVEL_ON: u32 = 255;

    extern "C" {
        fn CFStringCreateWithBytes(
            alloc: *const c_void,
            bytes: *const u8,
            num_bytes: i64,
            encoding: CFStringEncoding,
            is_external: u8,
        ) -> CFStringRef;
        fn CFRelease(cf: *const c_void);
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: u32,
            reason: CFStringRef,
            assertion_id: *mut IOPMAssertionID,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> i32;
    }

    fn cfstr(s: &str) -> CFStringRef {
        unsafe {
            CFStringCreateWithBytes(
                std::ptr::null(),
                s.as_ptr(),
                s.len() as i64,
                K_CF_STRING_ENCODING_UTF8,
                0,
            )
        }
    }

    /// RAII guard that prevents the display from sleeping.
    pub struct DisplaySleepGuard {
        assertion_id: IOPMAssertionID,
    }

    unsafe impl Send for DisplaySleepGuard {}
    unsafe impl Sync for DisplaySleepGuard {}

    impl DisplaySleepGuard {
        pub fn new() -> Option<Self> {
            let assertion_type = cfstr("PreventUserIdleDisplaySleep");
            let reason = cfstr("Kuriume video playback");
            let mut assertion_id: IOPMAssertionID = 0;

            let ret = unsafe {
                IOPMAssertionCreateWithName(
                    assertion_type,
                    K_IOPM_ASSERTION_LEVEL_ON,
                    reason,
                    &mut assertion_id,
                )
            };

            unsafe {
                CFRelease(assertion_type);
                CFRelease(reason);
            }

            if ret == 0 {
                Some(Self { assertion_id })
            } else {
                None
            }
        }
    }

    impl Drop for DisplaySleepGuard {
        fn drop(&mut self) {
            unsafe {
                IOPMAssertionRelease(self.assertion_id);
            }
        }
    }
}

/// All resources associated with an active player session.
///
/// Field order matters: Rust drops fields in declaration order.
/// `native_view` MUST be dropped before `player` so that
/// `mpv_render_context_free` runs before `mpv_destroy`.
struct ActivePlayer {
    native_view: NativeVideoView,
    player: MpvPlayer,
    #[cfg(target_os = "macos")]
    _sleep_guard: Option<power::DisplaySleepGuard>,
}

/// Shared player state managed by the plugin.
pub struct PlayerState {
    inner: tokio::sync::Mutex<Option<ActivePlayer>>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: tokio::sync::Mutex::new(None),
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
        let inner = self.inner.get_mut();
        if let Some(mut active) = inner.take() {
            active.native_view.destroy();
            // Drop native_view first (mpv_render_context_free),
            // then player (mpv_destroy). Explicit order required.
            drop(active.native_view);
            drop(active.player);
        }
    }
}

/// Initialize the mpv player with IOSurface-backed rendering.
#[command]
pub(crate) async fn player_init<R: Runtime>(
    state: State<'_, PlayerState>,
    app: AppHandle<R>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Err("Player already initialized".into());
    }

    let window: WebviewWindow<R> = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    let mut player = tokio::task::spawn_blocking(MpvPlayer::new_for_render)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let mpv_handle = player.raw_handle() as usize;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<NativeVideoView, String>>();

    let win = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                #[cfg(target_os = "macos")]
                {
                    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                    let handle = win
                        .window_handle()
                        .map_err(|e| format!("window handle: {e}"))?;
                    match handle.as_raw() {
                        RawWindowHandle::AppKit(h) => {
                            let ns_view = h.ns_view.as_ptr();
                            unsafe {
                                NativeVideoView::new(
                                    ns_view,
                                    mpv_handle as *mut std::ffi::c_void,
                                )
                            }
                        }
                        _ => Err("unexpected window handle type".into()),
                    }
                }
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    let native_view = rx.await.map_err(|_| "main thread channel closed")??;

    let event_rx = player.start_event_loop().map_err(|e| e.to_string())?;

    *guard = Some(ActivePlayer {
        native_view,
        player,
        #[cfg(target_os = "macos")]
        _sleep_guard: power::DisplaySleepGuard::new(),
    });

    drop(guard);
    spawn_event_forwarder(app, event_rx);

    Ok(())
}

#[command]
pub(crate) async fn player_play(state: State<'_, PlayerState>, url: &str) -> Result<(), String> {
    with_player(&state, |p| p.play(url)).await
}

#[command]
pub(crate) async fn player_set_paused(
    state: State<'_, PlayerState>,
    paused: bool,
) -> Result<(), String> {
    with_player(&state, |p| p.set_paused(paused)).await
}

#[command]
pub(crate) async fn player_seek(
    state: State<'_, PlayerState>,
    seconds: f64,
) -> Result<(), String> {
    with_player(&state, |p| p.seek(seconds)).await
}

#[command]
pub(crate) async fn player_stop(state: State<'_, PlayerState>) -> Result<(), String> {
    with_player(&state, |p| p.stop()).await
}

#[command]
pub(crate) async fn player_set_volume(
    state: State<'_, PlayerState>,
    volume: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_volume(volume)).await
}

#[command]
pub(crate) async fn player_get_volume(state: State<'_, PlayerState>) -> Result<i64, String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    Ok(active.player.volume())
}

#[command]
pub(crate) async fn player_set_speed(
    state: State<'_, PlayerState>,
    speed: f64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_speed(speed)).await
}

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

#[command]
pub(crate) async fn player_set_audio_track(
    state: State<'_, PlayerState>,
    id: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_audio_track(id)).await
}

#[command]
pub(crate) async fn player_set_subtitle_track(
    state: State<'_, PlayerState>,
    id: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_subtitle_track(id)).await
}

#[command]
pub(crate) async fn player_set_hwdec(
    state: State<'_, PlayerState>,
    mode: &str,
) -> Result<(), String> {
    with_player(&state, |p| p.set_hwdec(mode)).await
}

#[command]
pub(crate) async fn player_get_hwdec(state: State<'_, PlayerState>) -> Result<String, String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    Ok(active.player.hwdec())
}

#[command]
pub(crate) async fn player_set_buffer_size(
    state: State<'_, PlayerState>,
    size_mib: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_demuxer_max_bytes(size_mib * 1024 * 1024)).await
}

/// Set the viewport (position and size) of the player's native view.
///
/// Coordinates are in CSS pixels, origin at top-left of the window.
/// Converted internally to NSView coordinates (bottom-left origin).
#[command]
pub(crate) async fn player_set_viewport(
    state: State<'_, PlayerState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window_height: f64,
) -> Result<(), String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    let ns_y = window_height - y - height;
    active.native_view.set_frame(x, ns_y, width, height);
    Ok(())
}

/// Destroy the player and free all resources.
#[command]
pub(crate) async fn player_destroy(state: State<'_, PlayerState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let Some(mut active) = guard.take() else {
        return Ok(());
    };
    drop(guard);

    // GpuRenderer (inside native_view) holds mpv_render_context
    // which MUST be freed before the mpv handle (inside player).
    active.native_view.destroy();
    drop(active.native_view);
    drop(active.player);

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────

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

fn spawn_event_forwarder<R: Runtime>(app: AppHandle<R>, mut rx: UnboundedReceiver<PlayerEvent>) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = app.emit("player-event", &event);
        }
    });
}
