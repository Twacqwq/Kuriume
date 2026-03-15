//! Offscreen software renderer for mpv.
//!
//! Uses `mpv_render_context` with `MPV_RENDER_API_TYPE_SW` to render
//! video frames into a CPU buffer without creating any window.  A
//! callback notifies the owner whenever a new frame is ready.
//!
//! Frame data is delivered as raw RGBA (8-bit per channel, 4 bytes per
//! pixel).

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use crate::error::{MpvError, Result};

/// Pixel format string for mpv SW renderer — 4 bytes per pixel (RGB + unused byte).
/// Byte order at increasing addresses: R, G, B, X.
/// This maps directly to WebGL's RGBA with alpha = 0/garbage.
const SW_FORMAT: &[u8] = b"rgb0\0";

/// A rendered video frame.
#[derive(Clone)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    /// Raw pixel data in RGBA byte order (4 bytes per pixel).
    /// Length = width * height * 4.
    pub data: Vec<u8>,
}

/// Manages the mpv render context for offscreen software rendering.
///
/// Typical usage:
/// 1. Call [`OffscreenRenderer::new`] right after creating the `MpvPlayer`.
/// 2. Call [`OffscreenRenderer::start`] to begin the render loop.
/// 3. Poll [`OffscreenRenderer::take_frame`] or wait for the `on_frame`
///    callback to get the most recent frame.
/// 4. Drop to clean up.
pub struct OffscreenRenderer {
    ctx: *mut libmpv2_sys::mpv_render_context,
    /// Signalled by mpv when a new frame should be rendered.
    needs_render: Arc<(Mutex<bool>, Condvar)>,
    /// Latest rendered frame available for consumption.
    current_frame: Arc<Mutex<Option<VideoFrame>>>,
    /// Desired render resolution.
    width: Arc<Mutex<u32>>,
    height: Arc<Mutex<u32>>,
    /// Controls the render thread.
    running: Arc<AtomicBool>,
    render_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

// SAFETY: The mpv render context is thread-safe when accessed from
// only the render thread (for render calls) and set_update_callback
// can be called from any thread per mpv docs.
unsafe impl Send for OffscreenRenderer {}
unsafe impl Sync for OffscreenRenderer {}

impl OffscreenRenderer {
    /// Create a new offscreen renderer attached to the given mpv handle.
    ///
    /// The `mpv` handle must have been initialised with `vo=libmpv`.
    /// This creates a `mpv_render_context` using the software API.
    pub fn new(mpv: *mut libmpv2_sys::mpv_handle, width: u32, height: u32) -> Result<Self> {
        let mut ctx: *mut libmpv2_sys::mpv_render_context = std::ptr::null_mut();

        let sw_api = libmpv2_sys::MPV_RENDER_API_TYPE_SW;
        let params = [
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                data: sw_api.as_ptr() as *mut c_void,
            },
            // Sentinel
            libmpv2_sys::mpv_render_param {
                type_: 0,
                data: std::ptr::null_mut(),
            },
        ];

        let err = unsafe {
            libmpv2_sys::mpv_render_context_create(
                &mut ctx,
                mpv,
                params.as_ptr() as *mut libmpv2_sys::mpv_render_param,
            )
        };

        if err < 0 {
            return Err(MpvError::Mpv(format!(
                "mpv_render_context_create failed: {}",
                libmpv2_sys::mpv_error_str(err)
            )));
        }

        Ok(Self {
            ctx,
            needs_render: Arc::new((Mutex::new(false), Condvar::new())),
            current_frame: Arc::new(Mutex::new(None)),
            width: Arc::new(Mutex::new(width)),
            height: Arc::new(Mutex::new(height)),
            running: Arc::new(AtomicBool::new(false)),
            render_thread: Mutex::new(None),
        })
    }

    /// Set the render resolution.  Takes effect on the next rendered frame.
    pub fn set_size(&self, width: u32, height: u32) {
        *self.width.lock().unwrap() = width;
        *self.height.lock().unwrap() = height;
    }

    /// Get a clone of the latest rendered frame, if any.
    pub fn take_frame(&self) -> Option<VideoFrame> {
        self.current_frame.lock().unwrap().take()
    }

    /// Start the render loop on a dedicated thread.
    ///
    /// `on_frame` is called (from the render thread) each time a new
    /// frame has been rendered and stored.  Typically used to signal
    /// a WebSocket broadcast.
    pub fn start<F>(&self, on_frame: F) -> Result<()>
    where
        F: Fn() + Send + 'static,
    {
        if self.running.load(Ordering::SeqCst) {
            return Ok(()); // already running
        }
        self.running.store(true, Ordering::SeqCst);

        // Register the mpv update callback — fires when a new frame is
        // available.  We signal the condvar to wake the render thread.
        let needs_render_for_cb = self.needs_render.clone();

        // Store the closure on the heap with a stable address.
        let callback: Box<Box<dyn Fn() + Send>> = Box::new(Box::new(move || {
            let (lock, cvar) = &*needs_render_for_cb;
            if let Ok(mut pending) = lock.lock() {
                *pending = true;
                cvar.notify_one();
            }
        }));
        let cb_ptr = Box::into_raw(callback);

        unsafe extern "C" fn update_cb(ctx: *mut c_void) {
            if ctx.is_null() {
                return;
            }
            let cb = unsafe { &*(ctx as *const Box<dyn Fn() + Send>) };
            cb();
        }

        unsafe {
            libmpv2_sys::mpv_render_context_set_update_callback(
                self.ctx,
                Some(update_cb),
                cb_ptr as *mut c_void,
            );
        }

        // Spawn the render thread.
        let ctx_addr = self.ctx as usize;
        let running = self.running.clone();
        let needs_render = self.needs_render.clone();
        let current_frame = self.current_frame.clone();
        let width = self.width.clone();
        let height = self.height.clone();

        let handle = std::thread::Builder::new()
            .name("mpv-render-loop".into())
            .spawn(move || {
                let ctx = ctx_addr as *mut libmpv2_sys::mpv_render_context;

                while running.load(Ordering::SeqCst) {
                    // Wait for mpv to signal that a frame is ready
                    {
                        let (lock, cvar) = &*needs_render;
                        let mut pending = lock.lock().unwrap();
                        if !*pending {
                            let result = cvar
                                .wait_timeout(pending, std::time::Duration::from_millis(100))
                                .unwrap();
                            pending = result.0;
                        }
                        *pending = false;
                    }

                    if !running.load(Ordering::SeqCst) {
                        break;
                    }

                    // Check if mpv actually wants us to render
                    let flags = unsafe {
                        libmpv2_sys::mpv_render_context_update(ctx)
                    };
                    if flags
                        & (libmpv2_sys::mpv_render_update_flag_MPV_RENDER_UPDATE_FRAME as u64)
                        == 0
                    {
                        continue;
                    }

                    let w = *width.lock().unwrap();
                    let h = *height.lock().unwrap();
                    if w == 0 || h == 0 {
                        continue;
                    }

                    let stride = w as usize * 4; // RGBA, 4 bytes per pixel
                    let buf_size = stride * h as usize;
                    let mut buf = vec![0u8; buf_size];

                    let mut sw_size = [w as i32, h as i32];
                    let mut sw_stride = stride;

                    let params = [
                        libmpv2_sys::mpv_render_param {
                            type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_SIZE,
                            data: sw_size.as_mut_ptr() as *mut c_void,
                        },
                        libmpv2_sys::mpv_render_param {
                            type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_FORMAT,
                            data: SW_FORMAT.as_ptr() as *mut c_void,
                        },
                        libmpv2_sys::mpv_render_param {
                            type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_STRIDE,
                            data: &mut sw_stride as *mut usize as *mut c_void,
                        },
                        libmpv2_sys::mpv_render_param {
                            type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_POINTER,
                            data: buf.as_mut_ptr() as *mut c_void,
                        },
                        // Sentinel
                        libmpv2_sys::mpv_render_param {
                            type_: 0,
                            data: std::ptr::null_mut(),
                        },
                    ];

                    let err = unsafe {
                        libmpv2_sys::mpv_render_context_render(
                            ctx,
                            params.as_ptr() as *mut libmpv2_sys::mpv_render_param,
                        )
                    };

                    if err >= 0 {
                        let frame = VideoFrame {
                            width: w,
                            height: h,
                            data: buf,
                        };
                        *current_frame.lock().unwrap() = Some(frame);
                        on_frame();

                        unsafe {
                            libmpv2_sys::mpv_render_context_report_swap(ctx);
                        }
                    }
                }
            })
            .map_err(|e| MpvError::Mpv(format!("Failed to spawn render thread: {e}")))?;

        *self.render_thread.lock().unwrap() = Some(handle);
        Ok(())
    }

    /// Stop the render loop.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        let (lock, cvar) = &*self.needs_render;
        if let Ok(mut pending) = lock.lock() {
            *pending = true;
            cvar.notify_one();
        }
        if let Some(handle) = self.render_thread.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}

impl Drop for OffscreenRenderer {
    fn drop(&mut self) {
        // Stop render thread first
        self.running.store(false, Ordering::SeqCst);
        {
            let (lock, cvar) = &*self.needs_render;
            if let Ok(mut pending) = lock.lock() {
                *pending = true;
                cvar.notify_one();
            }
        }
        if let Some(handle) = self.render_thread.lock().unwrap().take() {
            let _ = handle.join();
        }

        // Clear the mpv update callback before freeing context
        unsafe {
            libmpv2_sys::mpv_render_context_set_update_callback(
                self.ctx,
                None,
                std::ptr::null_mut(),
            );
        }

        // Free the render context
        unsafe {
            libmpv2_sys::mpv_render_context_free(self.ctx);
        }
    }
}
