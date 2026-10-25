//! macOS animation completion, isolated from the cross-platform player state.
use block2::RcBlock;
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
};
use objc2_foundation::{ns_string, NSNotification, NSNotificationCenter, NSObjectProtocol};
use std::{cell::RefCell, ptr::NonNull};
use tauri::{Emitter, WebviewWindow};

struct Observer(Retained<ProtocolObject<dyn NSObjectProtocol>>);

impl Drop for Observer {
    fn drop(&mut self) {
        // The token came from this center and stays on the main thread.
        unsafe { NSNotificationCenter::defaultCenter().removeObserver((*self.0).as_ref()) };
    }
}

thread_local! {
    static OBSERVERS: RefCell<Vec<Observer>> = const { RefCell::new(Vec::new()) };
}

#[derive(Clone, serde::Serialize)]
struct Transition {
    fullscreen: bool,
    pending: bool,
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    // Setup runs on the main thread. Filter notifications to this NSWindow;
    // never replace Tao's delegate or alter other windows' fullscreen behavior.
    let native = unsafe { &*window.ns_window()?.cast::<AnyObject>() };
    let center = NSNotificationCenter::defaultCenter();
    for (name, fullscreen, pending) in [
        (
            ns_string!("NSWindowWillEnterFullScreenNotification"),
            true,
            true,
        ),
        (
            ns_string!("NSWindowDidEnterFullScreenNotification"),
            true,
            false,
        ),
        (
            ns_string!("NSWindowWillExitFullScreenNotification"),
            false,
            true,
        ),
        (
            ns_string!("NSWindowDidExitFullScreenNotification"),
            false,
            false,
        ),
    ] {
        let window = window.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            let _ = window.emit(
                "player-fullscreen-transition",
                Transition {
                    fullscreen,
                    pending,
                },
            );
        });
        // AppKit posts these on the main thread; the captured Tauri handle is
        // Send + Sync and the center copies the block for the observer lifetime.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(name),
                Some(native),
                None,
                &block,
            )
        };
        OBSERVERS.with(|observers| observers.borrow_mut().push(Observer(token)));
    }
    Ok(())
}

/// Hides or shows the close, minimize and zoom buttons (NSWindowButton 0–2).
pub fn set_window_buttons_hidden(window: &WebviewWindow, hidden: bool) -> tauri::Result<()> {
    // The pointer crosses to the main thread as an address; AppKit is only
    // touched there, and the window outlives this call.
    let native = window.ns_window()? as usize;
    window.run_on_main_thread(move || {
        let native = native as *mut AnyObject;
        for kind in 0usize..3 {
            unsafe {
                let button: *mut AnyObject = msg_send![native, standardWindowButton: kind];
                if !button.is_null() {
                    let _: () = msg_send![button, setHidden: hidden];
                }
            }
        }
    })
}

pub fn clear() {
    OBSERVERS.with(|observers| observers.borrow_mut().clear());
}
