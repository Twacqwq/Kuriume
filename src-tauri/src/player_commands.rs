use kuriume_mpv::{MpvPlayer, PlayerEvent};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::UnboundedReceiver;

/// Shared player state managed by Tauri.
pub struct PlayerState {
    player: Mutex<Option<MpvPlayer>>,
    /// Address of mpv's NSWindow (child of Tauri's window on macOS).
    #[cfg(target_os = "macos")]
    mpv_win_addr: Mutex<usize>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            player: Mutex::new(None),
            #[cfg(target_os = "macos")]
            mpv_win_addr: Mutex::new(0),
        }
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize the mpv player.
///
/// On macOS, mpv creates its own window (macvk backend ignores wid).
/// After init we find that window, make it a borderless child of
/// Tauri's window (ordered behind), and make the webview transparent
/// so the video shows through CSS-transparent areas.
#[command]
pub(crate) async fn player_init(
    state: State<'_, PlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut guard = state.player.lock().map_err(|e| e.to_string())?;
        let mut player = MpvPlayer::new().map_err(|e| e.to_string())?;
        let rx = player.start_event_loop().map_err(|e| e.to_string())?;
        spawn_event_forwarder(app.clone(), rx);
        *guard = Some(player);
    }

    #[cfg(target_os = "macos")]
    {
        attach_mpv_window(&app, &state).await?;
    }

    Ok(())
}

/// Resize the mpv NSView to match the frontend player container.
#[command]
pub(crate) fn player_set_geometry(
    #[allow(unused_variables)] state: State<'_, PlayerState>,
    #[allow(unused_variables)] app: AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        update_mpv_window_frame(&app, &state, _x, _y, _width, _height)?;
    }
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
pub(crate) async fn player_destroy(
    state: State<'_, PlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    let player = {
        let mut guard = state.player.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    // Drop on a blocking thread so the event-thread join doesn't block Tokio.
    if let Some(p) = player {
        tokio::task::spawn_blocking(move || drop(p))
            .await
            .map_err(|e| e.to_string())?;
    }

    // On macOS: detach mpv's child window and restore Tauri's state
    #[cfg(target_os = "macos")]
    {
        detach_mpv_window(&app, &state).await?;
    }

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

// ── macOS child-window helpers ──────────────────────────────────

/// Find mpv's NSWindow (created by macvk with force-window=immediate),
/// make it a borderless child of Tauri's window ordered behind it,
/// and make the webview transparent so video shows through.
#[cfg(target_os = "macos")]
async fn attach_mpv_window(
    app: &AppHandle,
    state: &State<'_, PlayerState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let tauri_ns_addr = window.ns_window().map_err(|e| e.to_string())? as usize;

    // mpv dispatches window creation to the main thread during
    // mpv_initialize(); retry until it appears in NSApp.windows().
    for attempt in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        eprintln!("[mpv-attach] attempt {attempt}/30");

        let (tx, rx) = tokio::sync::oneshot::channel::<Result<usize, String>>();
        let ta = tauri_ns_addr;

        window
            .run_on_main_thread(move || {
                use objc2::{msg_send, sel, MainThreadMarker};
                use objc2_app_kit::{
                    NSApplication, NSColor, NSWindow,
                    NSWindowOrderingMode, NSWindowStyleMask,
                };

                let mtm = MainThreadMarker::new()
                    .expect("run_on_main_thread guarantees main thread");
                let nsapp = NSApplication::sharedApplication(mtm);

                unsafe {
                    let tauri_win = &*(ta as *const NSWindow);

                    let all_windows = nsapp.windows();
                    let count = all_windows.count();
                    let mut found_addr = 0usize;
                    eprintln!("[mpv-attach] windows count = {count}, tauri addr = {ta:#x}");

                    for i in 0..count {
                        let win = all_windows.objectAtIndex(i);
                        let addr = (&*win) as *const NSWindow as usize;
                        eprintln!("[mpv-attach]   window[{i}] addr={addr:#x} has_content_view={}", win.contentView().is_some());
                        if addr == ta {
                            continue;
                        }
                        if win.contentView().is_none() {
                            continue;
                        }

                        // Make borderless & no shadow
                        win.setStyleMask(NSWindowStyleMask::Borderless);
                        win.setHasShadow(false);

                        // Attach as child behind Tauri
                        tauri_win.addChildWindow_ordered(
                            &win,
                            NSWindowOrderingMode::Below,
                        );

                        found_addr = addr;
                        eprintln!("[mpv-attach] ✅ attached mpv window {addr:#x} as child of Tauri window");
                        break;
                    }

                    if found_addr == 0 {
                        let _ = tx.send(Err(format!(
                            "not found ({count} windows)"
                        )));
                        return;
                    }

                    // Make Tauri window see-through where webview is transparent
                    tauri_win.setOpaque(false);
                    tauri_win.setBackgroundColor(Some(&NSColor::clearColor()));

                    // Make WKWebView transparent
                    if let Some(content_view) = tauri_win.contentView() {
                        let subviews = content_view.subviews();
                        let sv_count = subviews.count();
                        if sv_count > 0 {
                            let webview = subviews.objectAtIndex(sv_count - 1);
                            let sel = sel!(_setDrawsBackground:);
                            let responds: bool =
                                msg_send![&*webview, respondsToSelector: sel];
                            if responds {
                                let _: () =
                                    msg_send![&*webview, _setDrawsBackground: false];
                            }
                        }
                    }

                    let _ = tx.send(Ok(found_addr));
                }
            })
            .map_err(|e| e.to_string())?;

        match rx.await.map_err(|_| "channel closed")? {
            Ok(addr) => {
                eprintln!("[mpv-attach] ✅ success! mpv window at {addr:#x}");
                *state.mpv_win_addr.lock().map_err(|e| e.to_string())? = addr;
                return Ok(());
            }
            Err(_) if attempt < 29 => continue,
            Err(e) => return Err(format!("mpv window {e}")),
        }
    }

    unreachable!()
}

/// Reposition mpv's child window to match the frontend player container.
/// CSS coords (top-left origin) are converted to screen coordinates.
#[cfg(target_os = "macos")]
fn update_mpv_window_frame(
    app: &AppHandle,
    state: &State<'_, PlayerState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let mpv_addr = *state.mpv_win_addr.lock().map_err(|e| e.to_string())?;
    if mpv_addr == 0 {
        return Ok(());
    }

    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let ns_window_addr = window.ns_window().map_err(|e| e.to_string())? as usize;

    window
        .run_on_main_thread(move || {
            use objc2_app_kit::NSWindow;
            use objc2_core_foundation::{CGPoint, CGRect, CGSize};

            unsafe {
                let tauri_win = &*(ns_window_addr as *const NSWindow);
                let mpv_win = &*(mpv_addr as *const NSWindow);

                let Some(content_view) = tauri_win.contentView() else {
                    return;
                };

                // CSS top-left → NSWindow bottom-left coords
                let content_height = content_view.bounds().size.height;
                let local_y = content_height - y - height;

                // Convert content-area rect to screen coordinates
                let local_rect = CGRect::new(
                    CGPoint::new(x, local_y),
                    CGSize::new(width, height),
                );
                let screen_rect = tauri_win.convertRectToScreen(local_rect);

                mpv_win.setFrame_display(screen_rect, true);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove mpv's child window, close it, and restore Tauri's window.
#[cfg(target_os = "macos")]
async fn detach_mpv_window(
    app: &AppHandle,
    state: &State<'_, PlayerState>,
) -> Result<(), String> {
    let mpv_addr = {
        let mut guard = state.mpv_win_addr.lock().map_err(|e| e.to_string())?;
        let addr = *guard;
        *guard = 0;
        addr
    };

    if mpv_addr == 0 {
        return Ok(());
    }

    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let ns_window_addr = window.ns_window().map_err(|e| e.to_string())? as usize;

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();

    window
        .run_on_main_thread(move || {
            use objc2::{msg_send, sel};
            use objc2_app_kit::{NSColor, NSWindow};

            unsafe {
                let tauri_win = &*(ns_window_addr as *const NSWindow);
                let mpv_win = &*(mpv_addr as *const NSWindow);

                tauri_win.removeChildWindow(mpv_win);
                mpv_win.close();

                // Restore Tauri window
                tauri_win.setOpaque(true);
                tauri_win.setBackgroundColor(Some(
                    &NSColor::windowBackgroundColor(),
                ));

                // Restore webview background
                if let Some(content_view) = tauri_win.contentView() {
                    let subviews = content_view.subviews();
                    let count = subviews.count();
                    if count > 0 {
                        let webview = subviews.objectAtIndex(count - 1);
                        let sel = sel!(_setDrawsBackground:);
                        let responds: bool =
                            msg_send![&*webview, respondsToSelector: sel];
                        if responds {
                            let _: () =
                                msg_send![&*webview, _setDrawsBackground: true];
                        }
                    }
                }
            }
            let _ = tx.send(());
        })
        .map_err(|e| e.to_string())?;

    let _ = rx.await;
    Ok(())
}
