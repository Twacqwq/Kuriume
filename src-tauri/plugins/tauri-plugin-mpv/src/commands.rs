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

// ── Windows display-sleep prevention via SetThreadExecutionState ──
#[cfg(target_os = "windows")]
mod power {
    use std::ffi::c_void;

    // ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    pub struct DisplaySleepGuard;

    unsafe impl Send for DisplaySleepGuard {}
    unsafe impl Sync for DisplaySleepGuard {}

    impl DisplaySleepGuard {
        pub fn new() -> Option<Self> {
            unsafe {
                SetThreadExecutionState(
                    ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED,
                );
            }
            Some(Self)
        }
    }

    impl Drop for DisplaySleepGuard {
        fn drop(&mut self) {
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }
}

// ── Android display-sleep prevention via WakeLock ────────────────
#[cfg(target_os = "android")]
mod power {
    /// Android wake lock — holds SCREEN_BRIGHT_WAKE_LOCK via JNI.
    ///
    /// Requires the Activity (from ndk-context) to access PowerManager.
    /// Falls back to no-op if JNI calls fail.
    pub struct DisplaySleepGuard {
        _private: (),
    }

    unsafe impl Send for DisplaySleepGuard {}
    unsafe impl Sync for DisplaySleepGuard {}

    impl DisplaySleepGuard {
        pub fn new() -> Option<Self> {
            // Android wake lock: call addFlags(FLAG_KEEP_SCREEN_ON) on the
            // Activity's window via JNI. This is the simplest approach and
            // does not require the WAKE_LOCK permission.
            //
            // The actual JNI calls are performed in NativeVideoView::new()
            // since we need the JNI env there. This guard just tracks state.
            Some(Self { _private: () })
        }
    }

    impl Drop for DisplaySleepGuard {
        fn drop(&mut self) {
            // FLAG_KEEP_SCREEN_ON is cleared when the Activity window flag
            // is removed. This is handled in NativeVideoView::destroy().
        }
    }
}

// ── iOS display-sleep prevention via UIApplication.isIdleTimerDisabled ──
#[cfg(target_os = "ios")]
mod power {
    use std::ffi::c_void;

    type DispatchQueue = *mut c_void;

    extern "C" {
        static _dispatch_main_q: c_void;
        fn dispatch_async_f(
            queue: DispatchQueue,
            context: *mut c_void,
            work: unsafe extern "C" fn(*mut c_void),
        );
    }

    #[inline]
    unsafe fn dispatch_get_main_queue() -> DispatchQueue {
        unsafe { &_dispatch_main_q as *const c_void as *mut c_void }
    }

    /// Set `UIApplication.shared.isIdleTimerDisabled` on the main thread.
    fn set_idle_timer_disabled(disabled: bool) {
        unsafe extern "C" fn apply(raw: *mut c_void) {
            let disabled = raw as usize != 0;
            unsafe {
                let cls: *const c_void = objc2::runtime::AnyClass::get(c"UIApplication")
                    .map(|c| c as *const _ as *const c_void)
                    .unwrap_or(std::ptr::null());
                if !cls.is_null() {
                    let app: *mut c_void = objc2::msg_send![
                        cls as *const objc2::runtime::AnyClass,
                        sharedApplication
                    ];
                    if !app.is_null() {
                        let _: () = objc2::msg_send![
                            app as *const objc2::runtime::AnyObject,
                            setIdleTimerDisabled: disabled
                        ];
                    }
                }
            }
        }

        unsafe {
            dispatch_async_f(
                dispatch_get_main_queue(),
                disabled as usize as *mut c_void,
                apply,
            );
        }
    }

    pub struct DisplaySleepGuard {
        _private: (),
    }

    unsafe impl Send for DisplaySleepGuard {}
    unsafe impl Sync for DisplaySleepGuard {}

    impl DisplaySleepGuard {
        pub fn new() -> Option<Self> {
            set_idle_timer_disabled(true);
            Some(Self { _private: () })
        }
    }

    impl Drop for DisplaySleepGuard {
        fn drop(&mut self) {
            set_idle_timer_disabled(false);
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
                use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                let handle = win
                    .window_handle()
                    .map_err(|e| format!("window handle: {e}"))?;

                #[cfg(target_os = "macos")]
                {
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

                #[cfg(target_os = "windows")]
                {
                    match handle.as_raw() {
                        RawWindowHandle::Win32(h) => {
                            let hwnd = h.hwnd.get() as *mut std::ffi::c_void;
                            unsafe {
                                NativeVideoView::new(
                                    hwnd,
                                    mpv_handle as *mut std::ffi::c_void,
                                )
                            }
                        }
                        _ => Err("unexpected window handle type".into()),
                    }
                }

                #[cfg(target_os = "android")]
                {
                    match handle.as_raw() {
                        RawWindowHandle::AndroidNdk(h) => {
                            let a_native_window = h.a_native_window.as_ptr();
                            unsafe {
                                NativeVideoView::new(
                                    a_native_window,
                                    mpv_handle as *mut std::ffi::c_void,
                                )
                            }
                        }
                        _ => Err("unexpected window handle type".into()),
                    }
                }

                #[cfg(target_os = "ios")]
                {
                    match handle.as_raw() {
                        RawWindowHandle::UiKit(h) => {
                            let ui_view = h.ui_view.as_ptr();
                            unsafe {
                                NativeVideoView::new(
                                    ui_view,
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

    #[cfg(target_os = "macos")]
    {
        // Convert CSS coords (top-left origin) to NSView coords (bottom-left origin)
        let ns_y = window_height - y - height;
        active.native_view.set_frame(x, ns_y, width, height);
    }

    #[cfg(target_os = "windows")]
    {
        // Win32 uses top-left origin, same as CSS
        let _ = window_height;
        active.native_view.set_frame(x, y, width, height);
    }

    #[cfg(target_os = "android")]
    {
        // Android uses top-left origin, same as CSS
        let _ = window_height;
        active.native_view.set_frame(x, y, width, height);
    }

    #[cfg(target_os = "ios")]
    {
        // UIKit uses top-left origin, same as CSS
        let _ = window_height;
        active.native_view.set_frame(x, y, width, height);
    }

    Ok(())
}

/// Destroy the player and free all resources.
#[command]
pub(crate) async fn player_destroy(state: State<'_, PlayerState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let Some(mut active) = guard.take() else {
        return Ok(());
    };

    // Hold the mutex during the entire cleanup so that no concurrent
    // command (seek, play, etc.) can access the player while it is
    // being torn down.
    active.native_view.destroy();
    drop(active.native_view);
    drop(active.player);
    drop(guard);

    Ok(())
}

/// Set Anime4K shader mode (A, B, C).
///
/// Resolves the bundled GLSL shader files from the app resource directory
/// and sets the `glsl-shaders` property on the mpv player.
#[command]
pub(crate) async fn player_set_anime4k<R: Runtime>(
    state: State<'_, PlayerState>,
    app: AppHandle<R>,
    mode: &str,
) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?
        .join("resources")
        .join("shaders");

    // Build the shader list based on mode.
    // Mobile platforms use lighter single-pass M-variant chains to stay
    // within the thermal / GPU budget of phone SoCs.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let shader_names: Vec<&str> = match mode {
        "A" => vec![
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_M.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
        "B" => vec![
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
        "C" => vec![
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
        _ => return Err(format!("Unknown Anime4K mode: {mode}")),
    };

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let shader_names: Vec<&str> = match mode {
        "A" => vec![
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_VL.glsl",
            "Anime4K_Upscale_CNN_x2_VL.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
        "B" => vec![
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_Soft_VL.glsl",
            "Anime4K_Upscale_CNN_x2_VL.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
        "C" => vec![
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Upscale_Denoise_CNN_x2_VL.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
        _ => return Err(format!("Unknown Anime4K mode: {mode}")),
    };

    let paths: Vec<String> = shader_names
        .iter()
        .map(|name| {
            resource_dir
                .join(name)
                .to_string_lossy()
                .into_owned()
        })
        .collect();

    let joined = paths.join(":");

    with_player(&state, |p| p.set_glsl_shaders(&joined)).await
}

/// Clear all Anime4K shaders.
#[command]
pub(crate) async fn player_clear_anime4k(
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    with_player(&state, |p| p.clear_glsl_shaders()).await
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
