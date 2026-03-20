use crate::native_view::NativeGlView;
use kuriume_mpv::{MpvPlayer, PlayerEvent};
use tauri::{command, AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::mpsc::UnboundedReceiver;

// ── macOS display-sleep prevention via IOPMAssertion ─────────────
#[cfg(target_os = "macos")]
mod power {
    use std::ffi::c_void;

    // IOKit types
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

    // The assertion ID is just a u32 token — safe to move across threads.
    unsafe impl Send for DisplaySleepGuard {}
    unsafe impl Sync for DisplaySleepGuard {}

    impl DisplaySleepGuard {
        /// Create an IOPMAssertion of type `PreventUserIdleDisplaySleep`.
        /// Returns `None` if the system call fails (non-fatal).
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
struct ActivePlayer {
    player: MpvPlayer,
    /// The native GL view mpv renders into (dropped → removed from superview).
    native_view: NativeGlView,
    /// Prevents display sleep while video is playing (macOS).
    #[cfg(target_os = "macos")]
    _sleep_guard: Option<power::DisplaySleepGuard>,
}

/// Shared player state managed by Tauri.
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
            active.native_view.destroy(); // free render context first
            drop(active.player);
        }
    }
}

/// Initialize the mpv player with GPU rendering via the OpenGL render API.
///
/// 1. Creates `MpvPlayer` (vo=libmpv, hwdec=auto).
/// 2. On the main thread: creates an NSView + NSOpenGLContext below the
///    webview, then creates a `GpuRenderer` using the current GL context.
/// 3. Starts the mpv event loop for property/playback notifications.
///
/// The render loop is driven by mpv's update callback → GCD dispatch_async
/// to the main thread → render into the default FBO → flush.
#[command]
pub(crate) async fn player_init(
    state: State<'_, PlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Err("Player already initialized".into());
    }

    let window: WebviewWindow = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    // Create mpv player (vo=libmpv, doesn't touch any window).
    let mut player = tokio::task::spawn_blocking(MpvPlayer::new_for_render)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    // Convert raw pointer to usize for Send across thread boundary.
    // Safe: the mpv handle outlives this scope (player stays alive).
    let mpv_handle = player.raw_handle() as usize;

    // On the main thread: create NativeGlView + GpuRenderer,
    // wire up the render loop, and return the view.
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<NativeGlView, String>>();

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
                                NativeGlView::new(
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

    // Start mpv event loop.
    let event_rx = player.start_event_loop().map_err(|e| e.to_string())?;

    *guard = Some(ActivePlayer {
        player,
        native_view,
        #[cfg(target_os = "macos")]
        _sleep_guard: power::DisplaySleepGuard::new(),
    });

    drop(guard);
    spawn_event_forwarder(app, event_rx);

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
pub(crate) async fn player_seek(
    state: State<'_, PlayerState>,
    seconds: f64,
) -> Result<(), String> {
    with_player(&state, |p| p.seek(seconds)).await
}

/// Stop playback.
#[command]
pub(crate) async fn player_stop(state: State<'_, PlayerState>) -> Result<(), String> {
    with_player(&state, |p| p.stop()).await
}

/// Set volume (0-100).
#[command]
pub(crate) async fn player_set_volume(
    state: State<'_, PlayerState>,
    volume: i64,
) -> Result<(), String> {
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
pub(crate) async fn player_set_speed(
    state: State<'_, PlayerState>,
    speed: f64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_speed(speed)).await
}

/// Get current playback state.
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

/// Set hardware decoding mode at runtime.
///
/// - `"auto"` — automatic hardware decoding (VideoToolbox on macOS)
/// - `"no"`   — software decoding only
#[command]
pub(crate) async fn player_set_hwdec(
    state: State<'_, PlayerState>,
    mode: &str,
) -> Result<(), String> {
    with_player(&state, |p| p.set_hwdec(mode)).await
}

/// Get current hardware decoding mode.
#[command]
pub(crate) async fn player_get_hwdec(state: State<'_, PlayerState>) -> Result<String, String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    Ok(active.player.hwdec())
}

/// Set demuxer forward buffer size in MiB.
#[command]
pub(crate) async fn player_set_buffer_size(
    state: State<'_, PlayerState>,
    size_mib: i64,
) -> Result<(), String> {
    with_player(&state, |p| p.set_demuxer_max_bytes(size_mib * 1024 * 1024)).await
}

/// Set the viewport (position and size) of the player's native GL view.
///
/// Coordinates are in CSS pixels, origin at top-left of the window.
/// `window_height` is the window's inner height in CSS pixels (passed from JS).
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

    // Convert from CSS (top-left origin) to NSView (bottom-left origin).
    let ns_y = window_height - y - height;

    active.native_view.set_frame(x, ns_y, width, height);
    Ok(())
}

/// Suspend GL rendering (freeze on last frame during fullscreen transitions).
#[command]
pub(crate) async fn player_suspend_render(state: State<'_, PlayerState>) -> Result<(), String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    active.native_view.suspend_rendering();
    Ok(())
}

/// Resume GL rendering after a fullscreen transition.
#[command]
pub(crate) async fn player_resume_render(state: State<'_, PlayerState>) -> Result<(), String> {
    let guard = state.inner.lock().await;
    let active = guard.as_ref().ok_or("Player not initialized")?;
    active.native_view.resume_rendering();
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

    // IMPORTANT: GpuRenderer (inside native_view) holds mpv_render_context
    // which MUST be freed before the mpv handle (inside player) is destroyed.
    // `destroy()` dispatches cleanup to the main queue synchronously,
    // so it's safe to call from any thread.
    active.native_view.destroy(); // frees mpv_render_context on main thread
    drop(active.player);          // frees mpv handle

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

fn spawn_event_forwarder(app: AppHandle, mut rx: UnboundedReceiver<PlayerEvent>) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = app.emit("player-event", &event);
        }
    });
}
